import logging
import uuid
from datetime import date
from pathlib import Path


from core.mixins import _staff_sees_all
from core.pagination import ClientPageSizePagination
from core.query_params import csv_int_params, csv_params
from django.db import transaction
from django.db.models import F, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response

from .models import AirtableAccount, AirtableActionItem, AirtableMeeting, ActionItemAttachment, ActionItemDependency, ActionItemStep, CalendarEventAccountLink
from .serializers import (
    AirtableAccountSerializer,
    AirtableActionItemSerializer,
    ActionItemAttachmentSerializer,
    ActionItemStepSerializer,
    AirtableMeetingSerializer,
    CalendarEventMatchSerializer,
    ManualCategorizationSerializer,
    EventContextSerializer,
)
from .matching import match_event_to_account, set_manual_categorization
from .sync import sync_all
from .airtable_client import get_table, TABLE_ACTION_ITEMS

logger = logging.getLogger(__name__)


def _can_reach(source_pk: int, target_pk: int, visited: set | None = None) -> bool:
    """Return True if target_pk is reachable from source_pk via waiting_on edges (DFS)."""
    if visited is None:
        visited = set()
    if source_pk in visited:
        return False
    visited.add(source_pk)
    deps = ActionItemDependency.objects.filter(blocked_item_id=source_pk).values_list("waiting_on_item_id", flat=True)
    for dep_pk in deps:
        if dep_pk == target_pk or _can_reach(dep_pk, target_pk, visited):
            return True
    return False


def _display_account_name(account) -> str:
    """Normalize the shared Airtable "ADMIN" row's name to "Admin" for display.

    CalendarEventAccountLink can only FK to AirtableAccount, so a calendar event dragged
    onto the sidebar's per-user "Admin" pill (an accounts.Account) still ends up stored
    against the shared AirtableAccount literally named "ADMIN" (set_manual_categorization's
    name__iexact fallback). Without this, the mismatched case broke the round-trip: the
    frontend's exact-string account-name filter never matched the sidebar's "Admin" label,
    so the event silently vanished from that account's view. Mirrors the same
    ADMIN_ACCOUNT_NAME comparison `_resolve_scheduler_account` already uses for action items.
    """
    from accounts.models import ADMIN_ACCOUNT_NAME
    if account and (account.name or "").strip().lower() == ADMIN_ACCOUNT_NAME.lower():
        return ADMIN_ACCOUNT_NAME
    return account.name if account else ""


ACTION_ITEM_WRITE_DENIED = "You can only modify action items assigned to you."


def _exclude_private_admin_items(qs, user):
    """Drop action items under an "Admin" account that belong to somebody else.

    Items under any account named "Admin" (case-insensitive) are private to their assignee.
    Items with a BLANK assignee have no owner, so they are shared and stay visible — the
    earlier three-way Q(...)|Q(...)|Q(...) form failed every branch for those and hid them
    from everyone, staff included.

    Deliberately NO _staff_sees_all bypass: staff must not see another user's private Admin
    items. Do not "fix" this by adding one.

    Shared by AirtableActionItemViewSet and ActionItemStepViewSet so step visibility can
    never drift from item visibility.
    """
    admin_account_ids = list(
        AirtableAccount.objects.filter(name__iexact="admin").values_list("id", flat=True)
    )
    if not admin_account_ids:
        return qs
    # assignee_airtable_id is a non-nullable CharField(default=""), so =="" is a complete
    # blank test.
    private_admin = Q(account_id__in=admin_account_ids) & ~Q(assignee_airtable_id="")
    user_collab_id = getattr(getattr(user, "profile", None), "airtable_collaborator_id", None)
    if user_collab_id:
        return qs.exclude(private_admin & ~Q(assignee_airtable_id=user_collab_id))
    return qs.exclude(private_admin)


def _can_write_action_item(user, item) -> bool:
    """True if `user` may modify `item` — including its steps and attachments.

    Single source of truth for the action item write rule. It previously lived inline in
    AirtableActionItemViewSet.check_object_permissions and, separately and differently, in
    update_action_item_fields; the divergence is what made file uploads 403 on unassigned
    items while field edits on the very same item succeeded.

    Allowed when the caller is staff (with staff data visibility), when the item has no
    assignee at all — nobody owns it — or when the caller *is* the assignee.
    """
    if _staff_sees_all(user):
        return True
    if not item.assignee_airtable_id:
        return True
    user_collab_id = getattr(getattr(user, "profile", None), "airtable_collaborator_id", None)
    return bool(user_collab_id) and item.assignee_airtable_id == user_collab_id


def _action_items_for_account(account, user):
    """Return action items for an account, filtering Admin items to the current user only."""
    if account is None:
        return []
    qs = AirtableActionItem.objects.filter(account=account)
    if account.name.lower() == "admin":
        user_collab_id = getattr(getattr(user, "profile", None), "airtable_collaborator_id", None)
        if user_collab_id:
            qs = qs.filter(assignee_airtable_id=user_collab_id)
        else:
            return []
    return qs


def _resolve_this_meeting(event_uid: str):
    """
    Return the AirtableMeeting stub linked to this specific CalendarEvent, or None.

    event_uid is google_event_id or the Django CalendarEvent PK (as string).
    Primary path: CalendarEvent.agentpm_airtable_id → AirtableMeeting row.
    Fallback: search for a stub whose airtable_id starts with "local-{event_pk}-"
    (handles the case where a sync wiped agentpm_airtable_id after stub creation).
    """
    from scheduler.models import CalendarEvent

    # Resolve the CalendarEvent
    event = CalendarEvent.objects.filter(google_event_id=event_uid).first()
    if not event and event_uid.isdigit():
        event = CalendarEvent.objects.filter(pk=int(event_uid)).first()

    if not event:
        return None

    # Primary: follow agentpm_airtable_id link
    if event.agentpm_airtable_id:
        meeting = AirtableMeeting.objects.filter(airtable_id=event.agentpm_airtable_id).first()
        if meeting:
            return meeting

    # Fallback: find stub by encoded event PK pattern and re-link
    stub = AirtableMeeting.objects.filter(airtable_id__startswith=f"local-{event.pk}-").first()
    if stub:
        # Repair the broken link so primary path works next time
        event.agentpm_airtable_id = stub.airtable_id
        event.save(update_fields=["agentpm_airtable_id"])
        return stub

    return None


class AirtableAccountViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AirtableAccountSerializer
    pagination_class = ClientPageSizePagination
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        # Limit to AirtableAccounts whose airtable_id matches an Account the user
        # is assigned to as a team member. Staff see all (unless they toggled off staff view).
        from accounts.models import Account
        if _staff_sees_all(self.request.user):
            qs = AirtableAccount.objects.all()
        else:
            allowed_ids = Account.objects.filter(
                team_members__user=self.request.user
            ).values_list("airtable_id", flat=True)
            qs = AirtableAccount.objects.filter(airtable_id__in=allowed_ids)
        # Always exclude AirtableAccounts whose name matches the user's personal admin
        # account. Admin accounts are per-user workspaces (accounts.Account with
        # is_admin_account=True) and must never appear as shared Airtable entries.
        user_admin = Account.objects.filter(
            admin_owner=self.request.user, is_admin_account=True
        ).values_list("company_name", flat=True).first()
        if user_admin:
            qs = qs.exclude(name__iexact=user_admin)
        airtable_id = self.request.query_params.get("airtable_id")
        if airtable_id:
            qs = qs.filter(airtable_id=airtable_id)
        return qs

    def partial_update(self, request, *args, **kwargs):
        """PATCH /airtable/accounts/<id>/ — update locally-editable fields."""
        EDITABLE = {"segment_workspaces"}
        instance = self.get_object()
        data = {k: v for k, v in request.data.items() if k in EDITABLE}
        serializer = self.get_serializer(instance, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ActionItemStepViewSet(viewsets.ModelViewSet):
    """Checklist steps on an action item. Local-only; never synced to Airtable.

    Scoped through the parent action item: you can only see steps on items you can see
    (so the Admin privacy rule applies transitively), and only write steps on items you
    could write yourself.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = ActionItemStepSerializer
    pagination_class = None  # A checklist is short and the UI renders all of it at once.

    def get_queryset(self):
        visible_items = _exclude_private_admin_items(AirtableActionItem.objects.all(), self.request.user)
        qs = ActionItemStep.objects.filter(action_item__in=visible_items)
        action_item_param = self.request.query_params.get("action_item")
        if action_item_param and action_item_param.isdigit():
            qs = qs.filter(action_item_id=action_item_param)
        return qs.select_related("action_item")

    def _require_writable_parent(self, item):
        if not _can_write_action_item(self.request.user, item):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(ACTION_ITEM_WRITE_DENIED)

    def perform_create(self, serializer):
        self._require_writable_parent(serializer.validated_data["action_item"])
        serializer.save()

    def perform_update(self, serializer):
        # Guard both the current parent and any reparenting attempt.
        self._require_writable_parent(serializer.instance.action_item)
        target = serializer.validated_data.get("action_item")
        if target is not None and target.pk != serializer.instance.action_item_id:
            self._require_writable_parent(target)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_writable_parent(instance.action_item)
        instance.delete()

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        """POST /airtable/steps/reorder/ — set the checklist order in one shot.

        Body: {"action_item": <pk>, "ids": [<step id>, ...]} in the desired order.

        One atomic call rather than a PATCH per row: a checklist reorder touches most of
        the list, and N sequential PATCHes would be chatty, non-atomic, and could leave
        duplicate `order` values visible if one failed midway.

        Ids not listed (e.g. a step another tab added since the page loaded) keep their
        relative order and are appended, so a concurrent insert degrades gracefully instead
        of 400ing the whole reorder.
        """
        action_item_id = request.data.get("action_item")
        ids = request.data.get("ids")

        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            return Response({"error": "`ids` must be a list of step ids."}, status=status.HTTP_400_BAD_REQUEST)
        if len(set(ids)) != len(ids):
            return Response({"error": "`ids` contains duplicates."}, status=status.HTTP_400_BAD_REQUEST)

        item = AirtableActionItem.objects.filter(pk=action_item_id).first()
        if not item:
            return Response({"error": "Unknown action item."}, status=status.HTTP_404_NOT_FOUND)
        # Visible to this caller? Reuse the queryset scoping rather than restating it.
        if not _exclude_private_admin_items(
            AirtableActionItem.objects.filter(pk=item.pk), request.user
        ).exists():
            return Response({"error": "Unknown action item."}, status=status.HTTP_404_NOT_FOUND)
        self._require_writable_parent(item)

        steps = list(ActionItemStep.objects.filter(action_item=item))
        by_id = {s.pk: s for s in steps}
        unknown = [i for i in ids if i not in by_id]
        if unknown:
            return Response(
                {"error": f"Steps {unknown} do not belong to this action item."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ordered = [by_id[i] for i in ids]
        ordered += [s for s in steps if s.pk not in set(ids)]
        for index, step in enumerate(ordered):
            step.order = index
        with transaction.atomic():
            ActionItemStep.objects.bulk_update(ordered, ["order"])

        return Response(ActionItemStepSerializer(ordered, many=True).data)


class AirtableMeetingViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AirtableMeetingSerializer
    # Batched ?account=/?calendar_event_id= requests cover many accounts or events at once
    # and would be silently truncated by the project-default PAGE_SIZE of 50. Response
    # shape is unchanged — still the DRF envelope.
    pagination_class = ClientPageSizePagination

    def get_queryset(self):
        qs = AirtableMeeting.objects.select_related("account").order_by("-date")
        # ?account= accepts a single value or a comma-separated batch, and mixes PKs with
        # Airtable string IDs ("12" / "recXXX" / "12,recXXX"). Batching lets a caller
        # showing many accounts fetch their meetings in one request instead of one each.
        account_param = self.request.query_params.get("account")
        if account_param:
            tokens = csv_params(account_param)
            pks = {int(t) for t in tokens if t.isdigit()}
            at_ids = [t for t in tokens if not t.isdigit()]
            if at_ids:
                # Airtable string IDs (e.g. "recXXX") — resolve to AirtableAccount PKs
                pks.update(
                    AirtableAccount.objects.filter(airtable_id__in=at_ids)
                    .values_list("pk", flat=True)
                )
            # Nothing resolved — narrow to empty rather than returning every meeting.
            qs = qs.filter(account_id__in=pks) if pks else qs.none()
        # Name fallback, mirroring AirtableActionItemViewSet. Needed for accounts.Account
        # rows with no airtable_id yet — notably per-user Admin accounts, which are never
        # linked to the shared Airtable "ADMIN" record.
        account_name_param = self.request.query_params.get("account_name")
        if account_name_param:
            qs = qs.filter(account__name__iexact=account_name_param)
        # Resolve CalendarEvent PKs to their linked AirtableMeetings via agentpm_airtable_id.
        # Accepts a single PK or a comma-separated batch ("5" or "5,6,7"). Callers map each
        # meeting back to its event by matching airtable_id against the event's
        # agentpm_airtable_id, which is already exposed by CalendarEventSerializer.
        cal_event_param = self.request.query_params.get("calendar_event_id")
        if cal_event_param:
            from scheduler.models import CalendarEvent
            event_ids = csv_int_params(cal_event_param)
            at_ids = [
                at_id
                for at_id in CalendarEvent.objects.filter(pk__in=event_ids)
                .values_list("agentpm_airtable_id", flat=True)
                if at_id
            ]
            # No event resolved to a linked Airtable record — return nothing, as before.
            qs = qs.filter(airtable_id__in=at_ids) if at_ids else qs.none()
        return qs


# Meeting summaries come from two providers. Both are stored, and the UI toggles
# between them, so the save path is identical apart from which column it writes and
# which write-back helper mirrors it to Airtable.
_MEETING_NOTES_SOURCES = {
    "gong": ("gong_notes", "push_meeting_gong_notes"),
    "zoom": ("zoom_notes", "push_meeting_zoom_notes"),
}


def _save_meeting_notes(meeting, source: str, notes: str):
    """Write `notes` to the column for `source` and mirror it to Airtable."""
    from . import write_back

    field, pusher = _MEETING_NOTES_SOURCES[source]
    setattr(meeting, field, notes)
    meeting.save(update_fields=[field])
    getattr(write_back, pusher)(meeting)


def _meeting_notes_by_pk(request, meeting_id: int, source: str):
    """Shared body for the by-PK notes endpoints."""
    notes = request.data.get(f"{source}_notes", "")

    try:
        meeting = AirtableMeeting.objects.select_related("account").get(pk=meeting_id)
    except AirtableMeeting.DoesNotExist:
        return Response({"detail": "Meeting not found."}, status=status.HTTP_404_NOT_FOUND)

    # Ownership check: staff see all; others must be a team member on the linked account.
    if not _staff_sees_all(request.user):
        if meeting.account is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        from accounts.models import Account
        allowed = Account.objects.filter(
            airtable_id=meeting.account.airtable_id,
            team_members__user=request.user,
        ).exists()
        if not allowed:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    _save_meeting_notes(meeting, source, notes)
    return Response(AirtableMeetingSerializer(meeting).data)


def _meeting_notes_by_event(request, event_id: int, source: str):
    """Shared body for the by-event notes endpoints (creates a stub meeting if needed)."""
    import uuid
    from scheduler.models import CalendarEvent

    notes = request.data.get(f"{source}_notes", "")

    try:
        event = CalendarEvent.objects.get(pk=event_id)
    except CalendarEvent.DoesNotExist:
        return Response({"detail": "Event not found."}, status=status.HTTP_404_NOT_FOUND)

    # Ownership check: staff bypass; otherwise the caller must own the event
    # OR be a team member on the linked account. Return 404 (not 403) to avoid
    # leaking event existence — mirrors the by-PK path.
    if not _staff_sees_all(request.user):
        allowed = event.owner_id == request.user.id
        if not allowed and event.account_id:
            from accounts.models import Account
            allowed = Account.objects.filter(
                pk=event.account_id,
                team_members__user=request.user,
            ).exists()
        if not allowed:
            return Response({"detail": "Event not found."}, status=status.HTTP_404_NOT_FOUND)

    # No Airtable-synced meeting yet ⇒ a local stub is created so notes are never lost.
    # Shared with the recap-email scanner via meeting_stubs so the two can't diverge.
    from .meeting_stubs import get_or_create_meeting_for_event

    meeting = get_or_create_meeting_for_event(event)

    _save_meeting_notes(meeting, source, notes)
    return Response(AirtableMeetingSerializer(meeting).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_meeting_gong_notes_by_pk(request, meeting_id: int):
    """PATCH /airtable/meetings/<meeting_id>/gong-notes/  — saves by Django PK."""
    return _meeting_notes_by_pk(request, meeting_id, "gong")


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_meeting_gong_notes(request, event_id: int):
    """
    PATCH /airtable/meetings/by-event/<event_id>/gong-notes/
    Body: { "gong_notes": "..." }

    Looks up the CalendarEvent by PK, finds (or creates) a linked AirtableMeeting,
    saves the new gong_notes to Django, and pushes to Airtable.
    """
    return _meeting_notes_by_event(request, event_id, "gong")


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_meeting_zoom_notes_by_pk(request, meeting_id: int):
    """PATCH /airtable/meetings/<meeting_id>/zoom-notes/  — saves by Django PK."""
    return _meeting_notes_by_pk(request, meeting_id, "zoom")


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_meeting_zoom_notes(request, event_id: int):
    """
    PATCH /airtable/meetings/by-event/<event_id>/zoom-notes/
    Body: { "zoom_notes": "..." }

    Zoom counterpart of update_meeting_gong_notes — same scoping and stub-creation
    behaviour, writing the Zoom column instead.
    """
    return _meeting_notes_by_event(request, event_id, "zoom")


class AirtableActionItemViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = AirtableActionItem.objects.all()
    serializer_class = AirtableActionItemSerializer
    pagination_class = None  # Always return all matching items — callers use ?account/status filters to scope

    def get_queryset(self):
        qs = super().get_queryset()
        account_param = self.request.query_params.get("account")
        if account_param:
            if account_param.isdigit():
                qs = qs.filter(account_id=account_param)
            else:
                # Airtable string ID (e.g. "recXXX") — resolve to AirtableAccount PK
                at_acct = AirtableAccount.objects.filter(airtable_id=account_param).first()
                qs = qs.filter(account=at_acct) if at_acct else qs.none()
        account_name_param = self.request.query_params.get("account_name")
        if account_name_param:
            qs = qs.filter(account__name__iexact=account_name_param)
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status__in=status_filter.split(","))
        return _exclude_private_admin_items(qs, self.request.user)

    def check_object_permissions(self, request, obj):
        """Non-safe methods require staff, the caller being the assignee, or no assignee."""
        super().check_object_permissions(request, obj)
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        if not _can_write_action_item(request.user, obj):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(ACTION_ITEM_WRITE_DENIED)

    def _require_account_membership(self, target_account):
        """Raise PermissionDenied unless the caller can attach action items to this account.

        `target_account` is an AirtableAccount instance (or None). Membership is
        resolved against accounts.Account rows sharing the same `airtable_id`.
        """
        if target_account is None:
            return
        user = self.request.user
        if _staff_sees_all(user):
            return
        from accounts.models import Account
        allowed = Account.objects.filter(
            Q(airtable_id=target_account.airtable_id) & (
                Q(team_members__user=user) | Q(admin_owner=user)
            )
        ).exists()
        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You cannot attach action items to this account.")

    def create(self, request, *args, **kwargs):
        # Resolve account FK from account_name if the integer id wasn't sent
        data = request.data.copy()
        if not data.get("account") and data.get("account_name"):
            acct = AirtableAccount.objects.filter(name__iexact=data["account_name"]).first()
            if acct:
                data["account"] = acct.pk
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        # Prevent attaching an action item to an account the caller isn't on.
        # `create()` bypasses DRF's default perform_create path, so the check
        # runs here (and again in perform_create as defence-in-depth).
        self._require_account_membership(serializer.validated_data.get("account"))

        from .write_back import push_action_item_create
        from django.utils import timezone as tz
        initial_status = data.get("status", "Open")
        extra = {"marked_done_at": tz.now()} if initial_status == "Done" else {}
        item = serializer.save(airtable_id=f"pending-{uuid.uuid4().hex}", **extra)
        airtable_id = push_action_item_create(item)
        if airtable_id:
            item.airtable_id = airtable_id
            item.save(update_fields=["airtable_id"])
            from .sync import mirror_action_item_to_scheduler
            mirror_action_item_to_scheduler(item)
        else:
            logger.warning(
                "Airtable write-through returned no ID for action item '%s'; deleting local record",
                item.task,
            )
            try:
                item.delete()
            except Exception:
                logger.exception("Failed to delete orphaned local action item '%s'", item.task)
            return Response(
                {"error": "Failed to create action item in Airtable. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        # Intentionally a no-op for the save — creation is handled in create()
        # above so we can return a proper error response when the Airtable write
        # fails. The membership check is still applied here as defence-in-depth
        # in case a future code path routes through DRF's default perform_create.
        self._require_account_membership(serializer.validated_data.get("account"))

    def perform_update(self, serializer):
        # Block re-parenting an action item to an AirtableAccount whose linked
        # accounts.Account the caller isn't a team member of. Falls back to the
        # existing instance.account when no new account FK is on the payload.
        target_account = serializer.validated_data.get("account")
        if target_account is None and serializer.instance is not None:
            target_account = getattr(serializer.instance, "account", None)
        self._require_account_membership(target_account)

        from django.utils import timezone as tz
        old_status = serializer.instance.status if serializer.instance else None
        new_status = serializer.validated_data.get("status", old_status)
        extra = {}
        if new_status == "Done" and old_status != "Done":
            extra["marked_done_at"] = tz.now()
        elif new_status != "Done" and old_status == "Done":
            extra["marked_done_at"] = None
        item = serializer.save(**extra)
        try:
            from .write_back import push_action_item_update
            push_action_item_update(item)
        except Exception:
            logger.exception("Airtable write-through failed for action item update '%s'", item.task)
        from .sync import mirror_action_item_to_scheduler
        mirror_action_item_to_scheduler(item)

    def perform_destroy(self, instance):
        airtable_id = instance.airtable_id
        instance.delete()
        try:
            from .write_back import push_action_item_delete
            push_action_item_delete(airtable_id)
        except Exception:
            logger.exception("Airtable write-through failed for action item delete (airtable_id=%s)", airtable_id)
        from .sync import unmirror_action_item
        unmirror_action_item(airtable_id)

    @action(detail=True, methods=["post"], url_path="set-reminder")
    def set_reminder(self, request, pk=None):
        """
        Create or replace the reminder linked to this action item.

        Body: { due_at: ISO datetime, title?: str, notify_in_app?: bool,
                notify_slack?: bool, notify_push?: bool, notify_sms?: bool }
        """
        from scheduler.models import Reminder

        item = self.get_object()
        due_at = request.data.get("due_at")
        if not due_at:
            return Response({"error": "due_at is required"}, status=status.HTTP_400_BAD_REQUEST)

        from django.utils.dateparse import parse_datetime
        due_at_dt = parse_datetime(str(due_at))
        if not due_at_dt:
            return Response({"error": "due_at must be a valid ISO 8601 datetime"}, status=status.HTTP_400_BAD_REQUEST)

        title = request.data.get("title") or f"Action item reminder: {item.task[:120]}"

        # Delete previous reminder if replacing
        old = item.reminder
        if old:
            old.delete()

        reminder = Reminder.objects.create(
            created_by=request.user,
            title=title,
            body=item.task_details or item.task,
            resource_type="action_item",
            resource_id=item.id,
            resource_label=item.task[:300],
            due_at=due_at_dt,
            notify_in_app=request.data.get("notify_in_app", True),
            notify_slack=request.data.get("notify_slack", False),
            notify_push=request.data.get("notify_push", False),
            notify_sms=request.data.get("notify_sms", False),
        )
        item.reminder = reminder
        item.save(update_fields=["reminder"])
        return Response(AirtableActionItemSerializer(item).data)

    @action(detail=True, methods=["delete"], url_path="clear-reminder")
    def clear_reminder(self, request, pk=None):
        """Remove the reminder linked to this action item."""
        item = self.get_object()
        if item.reminder:
            item.reminder.delete()
            item.reminder = None
            item.save(update_fields=["reminder"])
        return Response(AirtableActionItemSerializer(item).data)

    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, pk=None):
        """GET all attachments for an action item. POST to add a link or upload a file."""
        item = self.get_object()
        if request.method == "POST":
            artifact_type = request.data.get("artifact_type", "link")
            name = request.data.get("name", "")
            url_val = request.data.get("url", "")
            file_obj = request.FILES.get("file")

            _BLOCKED_EXTENSIONS = {
                ".py", ".sh", ".bash", ".exe", ".bat", ".cmd", ".ps1",
                ".php", ".rb", ".pl", ".js", ".jsx", ".ts", ".tsx",
                ".html", ".htm", ".svg", ".xml",
            }
            _MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

            if file_obj:
                if file_obj.size > _MAX_UPLOAD_BYTES:
                    return Response({"error": "File too large (max 25 MB)."}, status=400)
                ext = Path(file_obj.name).suffix.lower()
                if ext in _BLOCKED_EXTENSIONS:
                    return Response({"error": f"File type '{ext}' is not permitted."}, status=400)

            kwargs = {
                "action_item": item,
                "uploaded_by": request.user,
                "artifact_type": artifact_type,
                "name": name,
            }
            if file_obj:
                kwargs["file"] = file_obj
                kwargs["mime_type"] = file_obj.content_type or ""
                kwargs["file_size"] = file_obj.size
                if not name:
                    kwargs["name"] = file_obj.name
            else:
                kwargs["url"] = url_val

            attachment = ActionItemAttachment.objects.create(**kwargs)
            return Response(
                ActionItemAttachmentSerializer(attachment, context={"request": request}).data,
                status=status.HTTP_201_CREATED,
            )

        qs = item.attachments.select_related("uploaded_by").all()
        return Response(ActionItemAttachmentSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["delete"], url_path=r"attachments/(?P<attachment_id>\d+)")
    def delete_attachment(self, request, pk=None, attachment_id=None):
        """Delete a specific attachment from an action item."""
        item = self.get_object()
        try:
            attachment = item.attachments.get(pk=attachment_id)
        except ActionItemAttachment.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        attachment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="add-dependency")
    def add_dependency(self, request, pk=None):
        """Mark this item as waiting on another item.
        Body: { waiting_on_id: <AirtableActionItem pk> }
        """
        blocked = self.get_object()
        waiting_on_id = request.data.get("waiting_on_id")
        if not waiting_on_id:
            return Response({"error": "waiting_on_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            waiting_on = AirtableActionItem.objects.get(pk=waiting_on_id)
        except AirtableActionItem.DoesNotExist:
            return Response({"error": "Action item not found"}, status=status.HTTP_404_NOT_FOUND)
        if waiting_on.pk == blocked.pk:
            return Response({"error": "An item cannot wait on itself"}, status=status.HTTP_400_BAD_REQUEST)
        # Full DFS reachability check: prevent multi-hop cycles (A→B→C→A).
        # Adding A→B is safe only if B cannot reach A through existing edges.
        if _can_reach(waiting_on.pk, blocked.pk):
            return Response({"error": "This would create a circular dependency"}, status=status.HTTP_400_BAD_REQUEST)
        ActionItemDependency.objects.get_or_create(blocked_item=blocked, waiting_on_item=waiting_on)
        return Response(AirtableActionItemSerializer(blocked).data)

    @action(detail=True, methods=["delete"], url_path=r"remove-dependency/(?P<dep_item_id>\d+)")
    def remove_dependency(self, request, pk=None, dep_item_id=None):
        """Remove a 'waiting on' link between this item and another."""
        blocked = self.get_object()
        ActionItemDependency.objects.filter(
            blocked_item=blocked, waiting_on_item_id=dep_item_id
        ).delete()
        return Response(AirtableActionItemSerializer(blocked).data)

    @action(detail=False, methods=["get"], url_path="next-meeting-at")
    def next_meeting_at(self, request):
        """Return the start_datetime of the user's next upcoming calendar event."""
        from django.utils import timezone
        from scheduler.models import CalendarEvent

        now = timezone.now()
        event = (
            CalendarEvent.objects
            .filter(owner=request.user, start_datetime__gt=now, status__in=["confirmed", "tentative"])
            .order_by("start_datetime")
            .first()
        )
        if not event:
            return Response({"next_meeting_at": None})
        return Response({"next_meeting_at": event.start_datetime.isoformat()})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def match_event(request):
    """
    Match a calendar event to an Airtable account.
    Returns full context including action items and meetings.
    If no match, returns needs_categorization=True with available accounts list.
    """
    ser = CalendarEventMatchSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data

    link = match_event_to_account(
        event_uid=d["event_uid"],
        title=d["title"],
        description=d["description"],
        attendee_emails=d["attendee_emails"],
    )

    if link is None:
        # Needs user categorization
        accounts = AirtableAccountSerializer(AirtableAccount.objects.all(), many=True).data
        return Response({
            "needs_categorization": True,
            "accounts": accounts,
        })

    account = link.account
    action_items = _action_items_for_account(account, request.user)
    meetings = AirtableMeeting.objects.filter(account=account).order_by("-date")[:10] if account else []

    # Resolve the specific AirtableMeeting stub linked to this CalendarEvent (if any).
    # This is what the Meeting Summary panel should read/write — NOT meetings[0].
    this_meeting = _resolve_this_meeting(d["event_uid"])

    acct_data = AirtableAccountSerializer(account).data if account else None
    if acct_data:
        acct_data["name"] = _display_account_name(account)

    return Response({
        "needs_categorization": False,
        "match_method": link.match_method,
        "categorization": link.categorization,
        "account": acct_data,
        "action_items": AirtableActionItemSerializer(action_items, many=True).data,
        "meetings": AirtableMeetingSerializer(meetings, many=True).data,
        "this_meeting": AirtableMeetingSerializer(this_meeting).data if this_meeting else None,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def categorize_event(request):
    """Called when the user manually categorizes an event."""
    ser = ManualCategorizationSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data

    link = set_manual_categorization(
        event_uid=d["event_uid"],
        account_id=d.get("account_id"),
        categorization=d.get("categorization", ""),
        account_name=d.get("account_name", ""),
    )

    account = link.account
    action_items = _action_items_for_account(account, request.user)
    meetings = AirtableMeeting.objects.filter(account=account).order_by("-date")[:10] if account else []
    this_meeting = _resolve_this_meeting(d["event_uid"])

    acct_data = AirtableAccountSerializer(account).data if account else None
    if acct_data:
        acct_data["name"] = _display_account_name(account)

    return Response({
        "needs_categorization": False,
        "match_method": link.match_method,
        "categorization": link.categorization,
        "account": acct_data,
        "action_items": AirtableActionItemSerializer(action_items, many=True).data,
        "meetings": AirtableMeetingSerializer(meetings, many=True).data,
        "this_meeting": AirtableMeetingSerializer(this_meeting).data if this_meeting else None,
    })


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_action_item_status(request, airtable_id):
    """
    Update action item status — writes to local DB and Airtable immediately.
    Body: { "status": "Done" }
    """
    new_status = request.data.get("status")
    if not new_status:
        return Response({"error": "status is required"}, status=status.HTTP_400_BAD_REQUEST)

    item = AirtableActionItem.objects.filter(airtable_id=airtable_id).first()
    if not item:
        return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _can_write_action_item(request.user, item):
        return Response({"error": ACTION_ITEM_WRITE_DENIED}, status=status.HTTP_403_FORBIDDEN)

    STATUS_TO_AT = {
        "Open": "Not Started", "In Progress": "In Progress",
        "Done": "Done", "Blocked": "Blocked",
    }

    from django.utils import timezone as tz
    old_status = item.status
    item.status = new_status
    update_fields = ["status", "updated_at"]
    if new_status == "Done" and old_status != "Done":
        item.marked_done_at = tz.now()
        update_fields.append("marked_done_at")
    elif new_status != "Done" and old_status == "Done":
        item.marked_done_at = None
        update_fields.append("marked_done_at")
    item.save(update_fields=update_fields)

    # Push to Airtable best-effort — local save already committed above.
    try:
        table = get_table(TABLE_ACTION_ITEMS)
        table.update(airtable_id, {"Status": STATUS_TO_AT.get(new_status, new_status)})
    except Exception:
        logger.exception("Failed to sync action item status to Airtable: %s", airtable_id)

    from .sync import mirror_action_item_to_scheduler
    mirror_action_item_to_scheduler(item)

    return Response(AirtableActionItemSerializer(item).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_action_item_fields(request, airtable_id):
    """
    Update arbitrary fields on an action item — writes to local DB and Airtable.
    Body may include: task, status, priority, due_date, estimated_time, time_spent, notes
    """
    item = AirtableActionItem.objects.filter(airtable_id=airtable_id).first()
    if not item:
        return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _can_write_action_item(request.user, item):
        return Response({"error": ACTION_ITEM_WRITE_DENIED}, status=status.HTTP_403_FORBIDDEN)

    FIELD_MAP = {
        "task": "Task",
        "task_details": "Task Details",
        "status": "Status",
        "priority": "Priority",
        "due_date": "Due Date",
        "estimated_time": "Estimated Time",
        "time_spent": "Time Spent",
    }
    airtable_payload = {}
    local_fields = []
    old_status = item.status  # capture before any mutations

    VALID_PRIORITIES = {"Low", "Medium", "High", "Critical"}
    VALID_STATUSES = {"Open", "In Progress", "Done", "Blocked"}

    if "priority" in request.data and request.data["priority"] not in VALID_PRIORITIES:
        return Response(
            {"error": f"Invalid priority. Must be one of: {', '.join(sorted(VALID_PRIORITIES))}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if "status" in request.data and request.data["status"] not in VALID_STATUSES:
        return Response(
            {"error": f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    STATUS_TO_AT = {
        "Open": "Not Started", "In Progress": "In Progress",
        "Done": "Done", "Blocked": "Blocked",
    }
    PRIORITY_TO_AT = {"Critical": "Urgent", "High": "High", "Medium": "Medium", "Low": "Low"}

    for field, at_field in FIELD_MAP.items():
        if field in request.data:
            val = request.data[field]
            setattr(item, field, val)
            local_fields.append(field)
            if field == "status":
                airtable_payload[at_field] = STATUS_TO_AT.get(val, val)
            elif field == "priority":
                airtable_payload[at_field] = PRIORITY_TO_AT.get(val, val)
            else:
                airtable_payload[at_field] = val

    # Account FK — resolve by PK, then fall back to name lookup.
    if "account" in request.data:
        raw = request.data["account"]
        if raw in (None, "", "null"):
            item.account = None
            local_fields.append("account")
            airtable_payload["Account"] = []
        else:
            acct = None
            try:
                acct = AirtableAccount.objects.get(pk=int(raw))
            except (AirtableAccount.DoesNotExist, ValueError, TypeError):
                # PK lookup failed — try resolving via account_name as a fallback
                name_hint = request.data.get("account_name", "")
                if name_hint:
                    acct = AirtableAccount.objects.filter(name__iexact=name_hint).first()
                if acct is None:
                    logger.warning("update_action_item_fields: unknown account pk=%s name=%s", raw, name_hint)
            if acct is not None:
                item.account = acct
                local_fields.append("account")
                if acct.airtable_id:
                    airtable_payload["Account"] = [acct.airtable_id]
    elif "account_name" in request.data and "account" not in request.data:
        # account_name sent without an account PK — resolve by name
        name_hint = request.data.get("account_name", "")
        if name_hint:
            acct = AirtableAccount.objects.filter(name__iexact=name_hint).first()
            if acct is not None:
                item.account = acct
                local_fields.append("account")
                if acct.airtable_id:
                    airtable_payload["Account"] = [acct.airtable_id]
        else:
            item.account = None
            local_fields.append("account")
            airtable_payload["Account"] = []

    # Linked meeting FK — link a Done action item to a meeting for timeline pinning.
    if "linked_meeting" in request.data:
        raw = request.data["linked_meeting"]
        if raw in (None, "", "null"):
            item.linked_meeting = None
            local_fields.append("linked_meeting")
        else:
            try:
                meeting = AirtableMeeting.objects.get(pk=int(raw))
                item.linked_meeting = meeting
                local_fields.append("linked_meeting")
            except (AirtableMeeting.DoesNotExist, ValueError, TypeError):
                logger.warning("update_action_item_fields: unknown meeting pk=%s", raw)

    # Assignee is a collaborator field — send {"id": "usrXXX"} to Airtable.
    if "assignee_airtable_id" in request.data:
        collab_id = request.data["assignee_airtable_id"] or None
        item.assignee_airtable_id = collab_id or ""
        local_fields.append("assignee_airtable_id")
        if "assignee_name" in request.data:
            item.assignee_name = request.data["assignee_name"] or ""
            local_fields.append("assignee_name")
        airtable_payload["Assignee"] = [{"id": collab_id}] if collab_id else []

    if "status" in request.data:
        from django.utils import timezone as tz
        new_status = request.data["status"]
        if new_status == "Done" and old_status != "Done":
            item.marked_done_at = tz.now()
            local_fields.append("marked_done_at")
            airtable_payload["Marked Done At"] = item.marked_done_at.isoformat()
        elif new_status != "Done" and old_status == "Done":
            item.marked_done_at = None
            local_fields.append("marked_done_at")

    # Save to local DB first so the UI always reflects the change.
    if local_fields:
        item.save(update_fields=local_fields)

    # Push to Airtable best-effort — a failure doesn't roll back the local save.
    if airtable_payload:
        try:
            table = get_table(TABLE_ACTION_ITEMS)
            table.update(airtable_id, airtable_payload)
        except Exception:
            logger.exception("Failed to sync action item fields to Airtable: %s", airtable_id)

    from .sync import mirror_action_item_to_scheduler
    mirror_action_item_to_scheduler(item)

    return Response(AirtableActionItemSerializer(item).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def log_time(request):
    """
    Log time spent on an action item.
    Body: { airtable_id, account_name, task, seconds }
    Appends time_spent to the action item in Airtable and saves a local log entry.
    """
    airtable_id = request.data.get("airtable_id")
    raw_seconds = request.data.get("seconds", 0)

    try:
        seconds = int(raw_seconds)
    except (TypeError, ValueError):
        return Response({"error": "seconds must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

    if not (1 <= seconds <= 86400):
        return Response(
            {"error": "seconds must be between 1 and 86400"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    item = AirtableActionItem.objects.filter(airtable_id=airtable_id).first()
    if not item:
        return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _can_write_action_item(request.user, item):
        return Response({"error": ACTION_ITEM_WRITE_DENIED}, status=status.HTTP_403_FORBIDDEN)

    with transaction.atomic():
        AirtableActionItem.objects.filter(airtable_id=airtable_id).select_for_update().update(
            time_spent=F("time_spent") + seconds
        )
        item.refresh_from_db()

    try:
        table = get_table(TABLE_ACTION_ITEMS)
        table.update(airtable_id, {"Time Spent": item.time_spent})
    except Exception:
        logger.exception("Failed to log time in Airtable: %s", airtable_id)
        return Response({"error": "Airtable update failed"}, status=status.HTTP_502_BAD_GATEWAY)

    return Response(AirtableActionItemSerializer(item).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_event_link(request):
    """
    Return the current account link for a calendar event.
    Query param: event_uid (CalendarEvent.google_event_id)
    Returns: { account_id, account_name, airtable_id } or 404 if no link.
    """
    event_uid = request.query_params.get("event_uid")
    if not event_uid:
        return Response({"error": "event_uid is required"}, status=status.HTTP_400_BAD_REQUEST)
    link = CalendarEventAccountLink.objects.select_related("account").filter(
        calendar_event_uid=event_uid
    ).exclude(account__isnull=True).first()
    if not link or not link.account:
        return Response({"linked": False})
    return Response({
        "linked": True,
        "airtable_account_id": link.account.id,
        "airtable_id": link.account.airtable_id,
        "account_name": _display_account_name(link.account),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def batch_event_links(request):
    """
    Return account links for multiple calendar events in one DB query.
    Body: { "event_uids": ["uid1", "uid2", ...] }
    Returns: { "uid1": { linked, airtable_account_id, airtable_id, account_name }, ... }
    UIDs with no link return { "linked": false }.
    """
    event_uids = request.data.get("event_uids", [])
    if not isinstance(event_uids, list):
        return Response({"error": "event_uids must be a list"}, status=status.HTTP_400_BAD_REQUEST)
    event_uids = [u for u in event_uids if isinstance(u, str) and u]
    if not event_uids:
        return Response({})

    links = (
        CalendarEventAccountLink.objects
        .select_related("account")
        .filter(calendar_event_uid__in=event_uids)
        .exclude(account__isnull=True)
    )
    linked_by_uid = {
        lnk.calendar_event_uid: {
            "linked": True,
            "airtable_account_id": lnk.account.id,
            "airtable_id": lnk.account.airtable_id,
            "account_name": _display_account_name(lnk.account),
        }
        for lnk in links
    }
    result = {uid: linked_by_uid.get(uid, {"linked": False}) for uid in event_uids}
    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def action_item_field_options(request):
    """
    Return the live Status and Priority choices for action items, pulled from the
    Airtable Meta API and cached for 5 minutes.

    Response: { "status": ["Open", "In Progress", ...], "priority": ["Critical", ...] }
    """
    import requests as _requests
    from django.conf import settings
    from django.core.cache import cache

    CACHE_KEY = "airtable_action_item_field_options"
    cached = cache.get(CACHE_KEY)
    if cached:
        return Response(cached)

    # Internal ↔ Airtable name mappings (AT→internal for status, internal→AT for writing)
    AT_TO_STATUS = {
        "Not Started": "Open",
        "In Progress": "In Progress",
        "Completed": "Done",
        "Done": "Done",
        "Blocked": "Blocked",
    }
    AT_TO_PRIORITY = {
        "Urgent": "Critical",
        "High": "High",
        "Medium": "Medium",
        "Low": "Low",
    }
    FALLBACK_STATUS = ["Open", "In Progress", "Done", "Blocked"]
    FALLBACK_PRIORITY = ["Critical", "High", "Medium", "Low"]

    try:
        url = f"https://api.airtable.com/v0/meta/bases/{settings.AIRTABLE_BASE_ID}/tables"
        headers = {"Authorization": f"Bearer {settings.AIRTABLE_API_KEY}"}
        resp = _requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        tables = resp.json().get("tables", [])

        # Find the action items table by ID
        target_table_id = settings.AIRTABLE_TABLE_ACTION_ITEMS
        fields = []
        for tbl in tables:
            if tbl.get("id") == target_table_id:
                fields = tbl.get("fields", [])
                break

        status_options = FALLBACK_STATUS
        priority_options = FALLBACK_PRIORITY

        for field in fields:
            choices = [c["name"] for c in field.get("options", {}).get("choices", [])]
            if not choices:
                continue
            fname = field.get("name", "").lower()
            if fname == "status":
                # Map Airtable names → internal names, preserving any unmapped ones as-is
                mapped = [AT_TO_STATUS.get(c, c) for c in choices]
                # Deduplicate while preserving order
                seen = set()
                status_options = [x for x in mapped if not (x in seen or seen.add(x))]  # type: ignore[func-returns-value]
            elif fname == "priority":
                mapped = [AT_TO_PRIORITY.get(c, c) for c in choices]
                seen = set()
                priority_options = [x for x in mapped if not (x in seen or seen.add(x))]  # type: ignore[func-returns-value]

        result = {"status": status_options, "priority": priority_options}
        cache.set(CACHE_KEY, result, timeout=300)
        return Response(result)

    except Exception:
        logger.exception("Failed to fetch action item field options from Airtable")
        return Response({"status": FALLBACK_STATUS, "priority": FALLBACK_PRIORITY})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminUser])
def trigger_sync(request):
    """Manual sync trigger."""
    result = sync_all()
    from realtime.sync import publish_activity_event
    parts = []
    if result.get("accounts"):
        parts.append(f"{result['accounts']} accounts")
    if result.get("meetings"):
        parts.append(f"{result['meetings']} meetings")
    if result.get("action_items"):
        parts.append(f"{result['action_items']} action items")
    if result.get("artifacts"):
        parts.append(f"{result['artifacts']} artifacts")
    publish_activity_event(
        request.user, "sync.airtable",
        "**Synced** Airtable",
        detail=", ".join(parts) if parts else "No changes",
        metadata=result,
    )
    return Response(result)
