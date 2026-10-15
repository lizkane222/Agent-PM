"""API views for the accounts app."""

import logging
from pathlib import Path

from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


from core.html_sanitize import is_html_filename, sanitize_html
from core.mixins import _staff_sees_all
from core.pagination import ClientPageSizePagination
from core.query_params import csv_int_params
from realtime.sync import publish_activity_event

from scheduler.models import Reminder
from scheduler.serializers import ActionItemSerializer, CalendarEventSerializer, ReminderSerializer

from .artifact_links import used_in_map
from .models import Account, AccountArtifact, AccountNote, AccountProject, AccountQuickLink, AccountRole, CustomerContact, CustomerContactNote, ProjectMember
from .serializers import AccountArtifactSerializer, AccountNoteSerializer, AccountProjectSerializer, AccountQuickLinkSerializer, AccountRoleSerializer, AccountSerializer, CustomerContactNoteSerializer, CustomerContactSerializer, ProjectMemberSerializer

logger = logging.getLogger(__name__)


def _sanitized_html_upload(file_obj):
    """
    Replace an uploaded HTML file with a sanitized copy of itself.

    Returns a new in-memory file to store, or None when the bytes are not
    decodable as text (which is not a valid HTML document, so it is rejected
    rather than stored unexamined).

    Sanitizing at upload rather than at render is deliberate: MEDIA_ROOT files
    are also reachable directly under /media/, a path that carries none of the
    response headers `artifact_file` sets, so the bytes on disk have to be safe
    on their own.
    """
    from django.core.files.uploadedfile import SimpleUploadedFile

    raw = file_obj.read()
    file_obj.seek(0)
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            markup = raw.decode(encoding)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:
        return None

    cleaned = sanitize_html(markup).encode("utf-8")
    if len(cleaned) != len(raw):
        logger.info(
            "Sanitized HTML upload '%s': %d bytes in, %d bytes out",
            file_obj.name, len(raw), len(cleaned),
        )
    return SimpleUploadedFile(file_obj.name, cleaned, content_type="text/html")


def _assert_account_membership(user, account):
    """Raise PermissionDenied unless `user` may attach records to `account`."""
    if account is None or _staff_sees_all(user):
        return
    from django.db.models import Q
    allowed = Account.objects.filter(
        Q(pk=account.pk) & (Q(team_members__user=user) | Q(admin_owner=user))
    ).exists()
    if not allowed:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("You do not have access to this account.")


class AccountViewSet(viewsets.ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ClientPageSizePagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["company_name", "industry", "website"]
    ordering_fields = ["company_name", "arr", "status", "created_at"]
    ordering = ["company_name"]

    def get_queryset(self):
        from django.db.models import Q
        user = self.request.user
        qs = Account.objects.select_related("owner", "primary_contact").prefetch_related("notes", "team_members")
        if not _staff_sees_all(user):
            # Regular visibility: accounts the user is a team member of, plus their
            # personal admin account (which may not have a TeamMember row yet).
            qs = qs.filter(
                Q(team_members__user=user) | Q(admin_owner=user)
            ).distinct()
        else:
            # Staff sees all non-admin accounts plus only their own admin account.
            # Use Q so we can still chain .filter() after this.
            qs = qs.filter(
                Q(is_admin_account=False) | Q(admin_owner=user)
            ).distinct()
        # "Admin" is a reserved per-user workspace name (matched case-insensitively,
        # the same way AirtableAccountViewSet reserves it). A row carrying that name
        # without is_admin_account=True is a stale shared mirror — never list it, or
        # it shows up as a second Admin alongside the caller's own.
        from .models import ADMIN_ACCOUNT_NAME
        qs = qs.exclude(
            Q(company_name__iexact=ADMIN_ACCOUNT_NAME) & Q(is_admin_account=False)
        )
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def _require_account_owner(self, instance):
        """Delete is limited to the account's owner / creator / admin_owner, or PM and above.
        Field edits are open to every member (see accounts/access.py)."""
        from .access import assert_can_delete
        assert_can_delete(self.request.user, instance)

    def _validate_account_write_fks(self, serializer):
        """Block non-staff from writing owner/primary_contact/team_member_ids to
        values outside their trust boundary. Staff bypass. Only checks fields
        that are present in validated_data — leaves the rest untouched."""
        user = self.request.user
        if _staff_sees_all(user):
            return

        vd = serializer.validated_data
        from rest_framework.exceptions import PermissionDenied
        from django.db.models import Q

        # owner — non-staff can only assign an account to themselves.
        if "owner" in vd:
            target_owner = vd.get("owner")
            if target_owner is not None and getattr(target_owner, "pk", None) != getattr(user, "pk", None):
                raise PermissionDenied("You cannot transfer ownership of an account to another user.")

        # primary_contact — must be a TeamMember on some Account the caller
        # belongs to. Chained `.filter()` calls yield SEPARATE joins on
        # `team_members`, which is what we need: an Account where BOTH the
        # candidate contact AND the caller are team members.
        if "primary_contact" in vd:
            pc = vd.get("primary_contact")
            if pc is not None:
                allowed = (
                    Account.objects.filter(team_members=pc)
                    .filter(Q(team_members__user=user) | Q(admin_owner=user))
                    .exists()
                )
                if not allowed:
                    raise PermissionDenied("You cannot assign a primary contact from an account you don't belong to.")

        # team_member_ids (source=`team_members`) — non-staff may only include
        # TeamMember rows that (a) already belong to a team-shared account, OR
        # (b) correspond to the caller's own TeamMember row. This blocks a
        # non-staff caller from grafting arbitrary teammates onto an account.
        # Concretely: everything not in the allowlist must be empty.
        if "team_members" in vd:
            # Membership: Basic may add/remove only themselves; PM and Admin anyone.
            from .access import assert_can_change_members
            incoming = {m.pk for m in (vd.get("team_members") or [])}
            current = (
                set(serializer.instance.team_members.values_list("pk", flat=True))
                if serializer.instance is not None else set()
            )
            assert_can_change_members(user, incoming - current, current - incoming)

    def perform_create(self, serializer):
        self._validate_account_write_fks(serializer)
        account = serializer.save(created_by=self.request.user)
        try:
            from airtable_sync.write_back import push_account_create
            airtable_id = push_account_create(account)
            if airtable_id:
                account.airtable_id = airtable_id
                account.save(update_fields=["airtable_id"])
        except Exception:
            logger.exception("Airtable write-through failed for new account '%s'", account.company_name)
        self._ensure_airtable_mirror(account)
        publish_activity_event(
            self.request.user, "account.created",
            "**Created** Account",
            detail=account.company_name,
        )

    def perform_update(self, serializer):
        from .access import assert_can_edit_fields, log_field_changes, snapshot
        assert_can_edit_fields(self.request.user, serializer.instance)
        self._validate_account_write_fks(serializer)
        fields_before = snapshot(serializer.instance)
        # Captured before save so newly-added team members can be identified. Dragging a
        # member onto an account on the Accounts page arrives here as a `team_member_ids`
        # PATCH, and that is the trigger for the Cloud Coach push below.
        before_member_ids = set(
            serializer.instance.team_members.values_list("pk", flat=True)
        )
        account = serializer.save()
        # History of every account field: one Activity Log event per set/changed/cleared value.
        log_field_changes(self.request.user, account, fields_before, snapshot(account))
        try:
            from airtable_sync.write_back import push_account_update
            push_account_update(account)
        except Exception:
            logger.exception("Airtable write-through failed for account update '%s'", account.company_name)
        self._ensure_airtable_mirror(account)
        self._cloud_coach_pushes = self._push_new_members_to_cloud_coach(
            account, before_member_ids
        )
        publish_activity_event(
            self.request.user, "account.updated",
            "**Updated** Account",
            detail=account.company_name,
        )

    @staticmethod
    def _ensure_airtable_mirror(account):
        """Action items FK to AirtableAccount, which only the pull sync used to write —
        so a new account could not be linked until the next sync. Best effort."""
        try:
            from airtable_sync.account_mirror import ensure_airtable_account_mirror
            ensure_airtable_account_mirror(account)
        except Exception:
            logger.exception("Failed to mirror account '%s' to AirtableAccount", account.company_name)

    def _push_new_members_to_cloud_coach(self, account, before_member_ids: set) -> list[dict]:
        """
        Newly-linked team members get added to the account's Cloud Coach project.

        Only when the account has **exactly one** project carrying an `sf_project_id`.
        With several, there is no defensible guess about which one the person belongs to,
        so the link stays local and the user assigns them on the account page — which
        routes through ProjectMemberViewSet and pushes from there.

        An explicit call rather than an `m2m_changed` signal: this codebase uses no Django
        signals anywhere, and a signal firing Salesforce writes from any `.set()` — the
        admin, a data migration, a future importer — is a far worse surprise than a call
        you can read here.
        """
        added_ids = set(account.team_members.values_list("pk", flat=True)) - before_member_ids
        if not added_ids:
            return []

        linked = list(
            AccountProject.objects.filter(account=account, kind="project")
            .exclude(sf_project_id="")
        )
        if len(linked) != 1:
            return []
        project = linked[0]

        from salesforce_sync.project_members import push_member_to_project
        from team.models import TeamMember

        results = []
        for member in TeamMember.objects.filter(pk__in=added_ids):
            # Record the local per-project membership too, so the account page reflects it
            # and a later backfill does not re-push.
            ProjectMember.objects.get_or_create(
                project=project, team_member=member,
                defaults={"added_by": self.request.user},
            )
            try:
                results.append(push_member_to_project(self.request.user, project.sf_project_id, member))
            except Exception:
                # Best effort by design: the local link is valid whether or not Salesforce
                # accepted it, and losing it because a third party was unreachable would
                # be the wrong trade.
                logger.exception(
                    "Cloud Coach member push failed for %s on %s", member.email, project.name
                )
                results.append({
                    "status": "error",
                    "member_name": member.full_name,
                    "project_name": project.name,
                    "message": "Could not reach Salesforce to add them to the project.",
                })
        return results

    def update(self, request, *args, **kwargs):
        """Attach any Cloud Coach push outcomes to the response without changing its shape."""
        self._cloud_coach_pushes = []
        response = super().update(request, *args, **kwargs)
        # Only added when something was actually pushed, so every existing consumer of this
        # endpoint sees a byte-identical body.
        if self._cloud_coach_pushes and isinstance(response.data, dict):
            response.data["cloud_coach_pushes"] = self._cloud_coach_pushes
        return response

    def perform_destroy(self, instance):
        self._require_account_owner(instance)
        name = instance.company_name
        airtable_id = instance.airtable_id
        instance.delete()
        try:
            from airtable_sync.write_back import push_account_delete
            push_account_delete(airtable_id)
        except Exception:
            logger.exception("Airtable write-through failed for account delete (airtable_id=%s)", airtable_id)
        publish_activity_event(
            self.request.user, "account.deleted",
            "**Deleted** Account",
            detail=name,
        )

    @action(detail=True, methods=["get"], url_path="calendar-events")
    def calendar_events(self, request, pk=None):
        """Return CalendarEvents linked to this account via CalendarEventAccountLink."""
        account = self.get_object()
        if not account.airtable_id:
            return Response([])

        try:
            from airtable_sync.models import AirtableAccount, CalendarEventAccountLink
            from scheduler.models import CalendarEvent
            from scheduler.serializers import CalendarEventSerializer

            at_acct = AirtableAccount.objects.filter(airtable_id=account.airtable_id).first()
            if not at_acct:
                return Response([])

            linked_uids = CalendarEventAccountLink.objects.filter(
                account=at_acct
            ).values_list("calendar_event_uid", flat=True)

            events = CalendarEvent.objects.filter(
                google_event_id__in=linked_uids
            ).order_by("start_datetime")

            serializer = CalendarEventSerializer(events, many=True)
            return Response(serializer.data)
        except Exception:
            logger.exception("Failed to fetch calendar events for account %s", pk)
            return Response([])

    @action(detail=True, methods=["get", "post"], url_path="notes")
    def notes(self, request, pk=None):
        account = self.get_object()
        if request.method == "POST":
            serializer = AccountNoteSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            note = serializer.save(account=account, author=request.user)
            publish_activity_event(
                request.user, "account_note.created",
                "**Created** Account Note",
                detail=f"{account.company_name} — {note.content[:80]}",
            )
            return Response(serializer.data, status=201)
        notes = account.notes.select_related("author__profile").all()
        serializer = AccountNoteSerializer(notes, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get", "post"], url_path="quick-links")
    def quick_links(self, request, pk=None):
        account = self.get_object()
        if request.method == "POST":
            serializer = AccountQuickLinkSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            link = serializer.save(account=account, created_by=request.user)
            publish_activity_event(
                request.user, "quick_link.created",
                "**Created** Quick Link",
                detail=f"{account.company_name} — {link.name}",
            )
            return Response(serializer.data, status=201)
        links = account.quick_links.all()
        return Response(AccountQuickLinkSerializer(links, many=True).data)

    @action(detail=True, methods=["get", "post"], url_path="artifacts")
    def artifacts(self, request, pk=None):
        account = self.get_object()
        if request.method == "POST":
            artifact_type = request.data.get("artifact_type", "link")
            name = request.data.get("name", "")
            url_val = request.data.get("url", "")
            file_obj = request.FILES.get("file")

            # .html / .htm / .xhtml are NOT here: they are accepted and sanitized below,
            # then served under a sandboxing CSP. The rest stay blocked — they are either
            # executable on a server or render as script-capable documents in the browser.
            _BLOCKED_EXTENSIONS = {
                ".py", ".sh", ".bash", ".exe", ".bat", ".cmd", ".ps1",
                ".php", ".rb", ".pl", ".js", ".jsx", ".ts", ".tsx",
                ".svg", ".xml",
            }
            _MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

            if file_obj:
                if file_obj.size > _MAX_UPLOAD_BYTES:
                    return Response({"error": "File too large (max 25 MB)."}, status=400)
                ext = Path(file_obj.name).suffix.lower()
                if ext in _BLOCKED_EXTENSIONS:
                    return Response({"error": f"File type '{ext}' is not permitted."}, status=400)
                if is_html_filename(file_obj.name):
                    file_obj = _sanitized_html_upload(file_obj)
                    if file_obj is None:
                        return Response(
                            {"error": "That HTML file could not be read as text."}, status=400
                        )

            kwargs = {
                "account": account,
                "uploaded_by": request.user,
                "artifact_type": artifact_type,
                "name": name,
                "icon_key": request.data.get("icon_key", ""),
                "secondary_url": request.data.get("secondary_url", ""),
                "description": request.data.get("description", ""),
                "references": request.data.get("references", []),
            }
            if file_obj:
                kwargs["file"] = file_obj
                kwargs["mime_type"] = file_obj.content_type or ""
                kwargs["file_size"] = file_obj.size
                if not name:
                    kwargs["name"] = file_obj.name
            else:
                kwargs["url"] = url_val

            artifact = AccountArtifact.objects.create(**kwargs)
            try:
                from airtable_sync.write_back import push_artifact_upsert
                push_artifact_upsert(artifact)
            except Exception:
                logger.exception("Airtable write-through failed for new artifact '%s'", artifact.name)
            publish_activity_event(
                request.user, "artifact.created",
                "**Created** Artifact",
                detail=f"{account.company_name} — {artifact.name}",
                metadata={"artifact_type": artifact.artifact_type},
            )
            return Response(AccountArtifactSerializer(artifact, context={"request": request}).data, status=201)

        artifacts = list(account.artifacts.select_related("uploaded_by").all())
        context = {
            "request": request,
            "used_in_map": used_in_map([a.id for a in artifacts], [account.id]),
        }
        return Response(AccountArtifactSerializer(artifacts, many=True, context=context).data)

    @action(detail=False, methods=["get"], url_path="artifacts-batch")
    def artifacts_batch(self, request):
        """GET /accounts/accounts/artifacts-batch/?ids=1,2,3 — artifacts across many accounts.

        The batched counterpart to the per-account `artifacts` GET above. Callers that
        render a list of accounts used to hit the detail route once per account, which
        burst past the DRF user throttle; this returns the same flat element shape for
        every requested account in a single request.

        Scoping goes through `self.get_queryset()`, so it inherits exactly the visibility
        `get_object()` gives the detail route — IDs the caller can't see are silently
        omitted rather than raising, since a batch is best-effort by nature.
        """
        account_ids = csv_int_params(request.query_params.get("ids"))
        if not account_ids:
            return Response([])
        visible = self.get_queryset().filter(pk__in=account_ids)
        artifacts = list(
            AccountArtifact.objects.filter(account__in=visible)
            .select_related("uploaded_by", "account")
            .order_by("account_id", "id")
        )
        context = {
            "request": request,
            "used_in_map": used_in_map(
                [a.id for a in artifacts], visible.values_list("id", flat=True)
            ),
        }
        return Response(
            AccountArtifactSerializer(artifacts, many=True, context=context).data
        )

    @action(detail=True, methods=["get", "post"], url_path="action-items")
    def action_items(self, request, pk=None):
        """List or create scheduler ActionItems linked to this account."""
        from scheduler.models import ActionItem
        account = self.get_object()
        if request.method == "POST":
            serializer = ActionItemSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            item = serializer.save(account=account, created_by=request.user)
            publish_activity_event(
                request.user, "action_item.created",
                "**Created** Action Item",
                detail=f"{account.company_name} — {item.title}",
            )
            return Response(ActionItemSerializer(item).data, status=201)
        items = ActionItem.objects.filter(account=account).select_related("assigned_to", "created_by")
        serializer = ActionItemSerializer(items, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get", "post"], url_path="reminders")
    def reminders(self, request, pk=None):
        """List or create Reminders linked to this account."""
        account = self.get_object()
        if request.method == "POST":
            data = request.data.copy()
            data["resource_type"] = "account"
            data["resource_id"] = account.id
            data.setdefault("resource_label", account.company_name)
            serializer = ReminderSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            reminder = serializer.save(created_by=request.user)
            publish_activity_event(
                request.user, "reminder.created",
                "**Created** Reminder",
                detail=f"{account.company_name} — {reminder.title}",
            )
            return Response(ReminderSerializer(reminder).data, status=201)
        reminders = Reminder.objects.filter(
            created_by=request.user,
            resource_type="account",
            resource_id=account.id,
        ).order_by("due_at")
        return Response(ReminderSerializer(reminders, many=True).data)

    @action(detail=True, methods=["get"], url_path="meetings")
    def meetings(self, request, pk=None):
        """Return all CalendarEvents directly linked to this account."""
        account = self.get_object()
        from scheduler.models import CalendarEvent
        events = CalendarEvent.objects.filter(account=account).order_by("start_datetime")
        serializer = CalendarEventSerializer(events, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="team-members/add")
    def add_team_member(self, request, pk=None):
        """
        POST /accounts/<id>/team-members/add/
        Body: { "member_id": <int> }  — link an existing TeamMember to this account.
        """
        from team.models import TeamMember
        account = self.get_object()
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"error": "member_id required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            member = TeamMember.objects.get(pk=int(member_id))
        except (TeamMember.DoesNotExist, ValueError):
            return Response({"error": "TeamMember not found"}, status=status.HTTP_404_NOT_FOUND)
        from .access import assert_can_change_members
        assert_can_change_members(request.user, {member.pk}, set())
        account.team_members.add(member)
        return Response(AccountSerializer(account).data)

    @action(detail=True, methods=["post"], url_path="team-members/remove")
    def remove_team_member(self, request, pk=None):
        """
        POST /accounts/<id>/team-members/remove/
        Body: { "member_id": <int> }
        """
        from team.models import TeamMember
        account = self.get_object()
        member_id = request.data.get("member_id")
        if not member_id:
            return Response({"error": "member_id required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            member = TeamMember.objects.get(pk=int(member_id))
        except (TeamMember.DoesNotExist, ValueError):
            return Response({"error": "TeamMember not found"}, status=status.HTTP_404_NOT_FOUND)
        from .access import assert_can_change_members
        assert_can_change_members(request.user, set(), {member.pk})
        account.team_members.remove(member)
        return Response(AccountSerializer(account).data)


class AccountNoteViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = AccountNoteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return AccountNote.objects.filter(author=self.request.user).select_related("author__profile", "account")

    def perform_update(self, serializer):
        note = serializer.save()
        publish_activity_event(
            self.request.user, "account_note.updated",
            "**Updated** Account Note",
            detail=f"{note.account.company_name} — {note.content[:80]}",
        )

    def perform_destroy(self, instance):
        detail = f"{instance.account.company_name} — {instance.content[:80]}"
        instance.delete()
        publish_activity_event(
            self.request.user, "account_note.deleted",
            "**Deleted** Account Note",
            detail=detail,
        )


class AccountArtifactViewSet(
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AccountArtifactSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if _staff_sees_all(self.request.user):
            return AccountArtifact.objects.select_related("account").all()
        return AccountArtifact.objects.filter(
            uploaded_by=self.request.user
        ).select_related("account")

    def get_serializer_context(self):
        # Only meaningful on update: the pk in the URL already identifies an
        # existing artifact, so its `used_in` can be computed for the response.
        # On create there is no instance yet — nothing could reference it, so
        # the map is left absent and the serializer's `.get(..., [])` covers it.
        context = super().get_serializer_context()
        pk = self.kwargs.get("pk")
        if pk:
            account_id = (
                AccountArtifact.objects.filter(pk=pk)
                .values_list("account_id", flat=True)
                .first()
            )
            context["used_in_map"] = used_in_map([pk], [account_id] if account_id else [])
        return context

    def perform_create(self, serializer):
        artifact_type = self.request.data.get("artifact_type", "link")
        file_obj = self.request.FILES.get("file")
        # Validate account membership so a caller can't attach an artifact to
        # an account they aren't on. Staff bypass this check.
        target_account = serializer.validated_data.get("account")
        user = self.request.user
        if target_account is not None and not _staff_sees_all(user):
            from django.db.models import Q
            allowed = Account.objects.filter(
                Q(pk=target_account.pk) & (
                    Q(team_members__user=user) | Q(admin_owner=user)
                )
            ).exists()
            if not allowed:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You cannot attach artifacts to this account.")
        extra = {
            "uploaded_by": self.request.user,
            "artifact_type": artifact_type,
        }
        if file_obj:
            extra["file"] = file_obj
            extra["mime_type"] = file_obj.content_type or ""
            extra["file_size"] = file_obj.size
            if not self.request.data.get("name"):
                extra["name"] = file_obj.name
        instance = serializer.save(**extra)
        try:
            from airtable_sync.write_back import push_artifact_upsert
            push_artifact_upsert(instance)
        except Exception:
            logger.exception("Airtable write-through failed for new artifact '%s'", instance.name)
        account_label = instance.account.company_name if instance.account_id else "unassigned"
        publish_activity_event(
            self.request.user, "artifact.created",
            "**Created** Artifact",
            detail=f"{account_label} — {instance.name}",
            metadata={"artifact_type": instance.artifact_type},
        )

    def perform_update(self, serializer):
        # Guard against re-parenting an artifact onto an account the caller isn't on.
        target_account = serializer.validated_data.get("account") or serializer.instance.account
        user = self.request.user
        if target_account is not None and not _staff_sees_all(user):
            from django.db.models import Q
            allowed = Account.objects.filter(
                Q(pk=target_account.pk) & (
                    Q(team_members__user=user) | Q(admin_owner=user)
                )
            ).exists()
            if not allowed:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You cannot attach artifacts to this account.")
        instance = serializer.save()
        try:
            from airtable_sync.write_back import push_artifact_upsert
            push_artifact_upsert(instance)
        except Exception:
            logger.exception("Airtable write-through failed for artifact update '%s'", instance.name)

    def perform_destroy(self, instance):
        account_label = instance.account.company_name if instance.account_id else "unassigned"
        detail = f"{account_label} — {instance.name}"
        django_id = instance.id
        instance.delete()
        try:
            from airtable_sync.write_back import push_artifact_delete_by_django_id
            push_artifact_delete_by_django_id(django_id)
        except Exception:
            logger.exception("Airtable write-through failed for artifact delete (Django ID=%s)", django_id)
        publish_activity_event(
            self.request.user, "artifact.deleted",
            "**Deleted** Artifact",
            detail=detail,
        )


class CustomerContactViewSet(viewsets.ModelViewSet):
    """CRUD for customer-side contacts linked to an Account."""
    serializer_class = CustomerContactSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if _staff_sees_all(self.request.user):
            qs = CustomerContact.objects.select_related("account").prefetch_related("notes__author__profile")
        else:
            qs = CustomerContact.objects.select_related("account").prefetch_related("notes__author__profile").filter(
                account__team_members__user=self.request.user
            ).distinct()
        account_id = self.request.query_params.get("account")
        if account_id:
            qs = qs.filter(account_id=account_id)
        return qs

    def _require_account_membership(self, target_account):
        """Raise PermissionDenied unless the caller can attach records to this account."""
        if target_account is None:
            return
        user = self.request.user
        if _staff_sees_all(user):
            return
        from django.db.models import Q
        allowed = Account.objects.filter(
            Q(pk=target_account.pk) & (
                Q(team_members__user=user) | Q(admin_owner=user)
            )
        ).exists()
        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You cannot attach contacts to this account.")

    def perform_create(self, serializer):
        # Prevent attaching a contact to an account the caller isn't on.
        self._require_account_membership(serializer.validated_data.get("account"))
        contact = serializer.save()
        try:
            from airtable_sync.write_back import push_customer_contact_create
            push_customer_contact_create(contact)
        except Exception:
            logger.exception("Airtable write-through failed for contact '%s'", contact.name)

    def perform_update(self, serializer):
        # Guard against re-parenting a contact to an account the caller isn't on.
        target = serializer.validated_data.get("account") or serializer.instance.account
        self._require_account_membership(target)
        contact = serializer.save()
        try:
            from airtable_sync.write_back import push_customer_contact_update
            push_customer_contact_update(contact)
        except Exception:
            logger.exception("Airtable write-through failed for contact update '%s'", contact.name)

    def perform_destroy(self, instance):
        airtable_id = instance.airtable_id
        instance.delete()
        try:
            from airtable_sync.write_back import push_customer_contact_delete
            push_customer_contact_delete(airtable_id)
        except Exception:
            logger.exception("Airtable write-through failed for contact delete '%s'", airtable_id)

    @action(detail=True, methods=["get", "post"], url_path="notes")
    def notes(self, request, pk=None):
        contact = self.get_object()
        if request.method == "POST":
            serializer = CustomerContactNoteSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(contact=contact, author=request.user)
            return Response(serializer.data, status=201)
        notes = contact.notes.select_related("author__profile").all()
        return Response(CustomerContactNoteSerializer(notes, many=True).data)


class AccountQuickLinkViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = AccountQuickLinkSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if _staff_sees_all(self.request.user):
            return AccountQuickLink.objects.select_related("account")
        return AccountQuickLink.objects.select_related("account").filter(
            account__team_members__user=self.request.user
        ).distinct()

    def perform_update(self, serializer):
        link = serializer.save()
        publish_activity_event(
            self.request.user, "quick_link.updated",
            "**Updated** Quick Link",
            detail=f"{link.account.company_name} — {link.name}",
        )

    def perform_destroy(self, instance):
        detail = f"{instance.account.company_name} — {instance.name}"
        instance.delete()
        publish_activity_event(
            self.request.user, "quick_link.deleted",
            "**Deleted** Quick Link",
            detail=detail,
        )


class CustomerContactNoteViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = CustomerContactNoteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if _staff_sees_all(self.request.user):
            return CustomerContactNote.objects.select_related("contact", "author__profile")
        return CustomerContactNote.objects.select_related("contact", "author__profile").filter(
            contact__account__team_members__user=self.request.user
        ).distinct()


class AdminAccountView(APIView):
    """
    GET /accounts/admin-account/

    Returns the calling user's personal Admin account, creating it on first access.
    Admin accounts are personal workspaces — only visible to their owner — so they
    are excluded from the shared account list for all other users.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .models import get_or_create_admin_account

        account = get_or_create_admin_account(request.user)
        return Response(AccountSerializer(account, context={"request": request}).data)


class AccountProjectViewSet(viewsets.ModelViewSet):
    serializer_class = AccountProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        from django.db.models import Q
        user = self.request.user
        if _staff_sees_all(user):
            qs = AccountProject.objects.select_related("account")
        else:
            qs = AccountProject.objects.select_related("account").filter(
                Q(account__team_members__user=user) | Q(account__admin_owner=user)
            ).distinct()
        account_name = self.request.query_params.get("account_name")
        if account_name:
            qs = qs.filter(account__company_name__iexact=account_name)
        account_id = self.request.query_params.get("account")
        if account_id:
            qs = qs.filter(account__id=account_id)
        return qs

    def perform_create(self, serializer):
        # Prevent attaching a project to an account the caller isn't on.
        _assert_account_membership(self.request.user, serializer.validated_data.get("account"))
        serializer.save()

    def perform_update(self, serializer):
        # Guard against re-parenting a project to an account the caller isn't on.
        target = serializer.validated_data.get("account") or serializer.instance.account
        _assert_account_membership(self.request.user, target)
        serializer.save()

    @action(detail=True, methods=["post"], url_path="sync-members-to-salesforce")
    def sync_members_to_salesforce(self, request, pk=None):
        """
        POST {"dry_run": bool} — reconcile this project's members with Cloud Coach.

        The backfill for members linked before the auto-push existed. `dry_run: true`
        resolves the full plan per member without writing, which is also the only safe way
        to see which mechanism this org will actually use before letting it near real
        projects — the membership model here is unverified (see
        `salesforce_sync/project_members.py`).
        """
        project = self.get_object()
        _assert_account_membership(request.user, project.account)

        dry_run = bool(request.data.get("dry_run", False))
        from salesforce_sync.project_members import sync_project_members
        try:
            result = sync_project_members(request.user, project, dry_run=dry_run)
        except PermissionError:
            return Response(
                {"detail": "Salesforce is not connected for this user."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            logger.exception("Cloud Coach member sync failed for project %s", project.pk)
            return Response(
                {"detail": "An unexpected error occurred."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(result)

    @action(detail=False, methods=["post"], url_path="fetch-salesforce")
    def fetch_salesforce(self, request):
        """
        POST {"sf_project_id": "a0B..."}

        Stateless lookup — queries the connected org for a Cloud Coach project and
        returns `{name, sf_data, fields_skipped}`. Does not touch the database; the
        caller merges the result into an in-progress (possibly unsaved) project draft.
        """
        sf_project_id = (request.data.get("sf_project_id") or "").strip()
        if not sf_project_id:
            return Response({"detail": "sf_project_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        from salesforce_sync.client import get_client, discover_namespace
        from .sf_project_fields import SF_PROJECT_FIELD_MAP

        try:
            sf = get_client(request.user)
        except PermissionError:
            return Response({"detail": "Salesforce is not connected for this user."}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Salesforce client setup failed")
            return Response({"detail": "Could not reach Salesforce."}, status=status.HTTP_502_BAD_GATEWAY)

        ns = discover_namespace(sf)
        sobject = f"{ns}__Project__c"

        try:
            describe = sf.restful(f"sobjects/{sobject}/describe")
        except Exception:
            logger.exception("Salesforce describe failed for %s", sobject)
            return Response({"detail": "Could not read the Salesforce project object."}, status=status.HTTP_502_BAD_GATEWAY)

        available = {f["name"] for f in describe.get("fields", [])}

        def _qualify(api_name: str) -> str:
            return f"{ns}__{api_name}" if api_name.endswith("__c") else api_name

        soql_fields = ["Id", "Name"]
        key_by_soql_field = {}
        fields_skipped = []
        for key, (api_name, _dtype) in SF_PROJECT_FIELD_MAP.items():
            qualified = _qualify(api_name)
            bare_check = qualified.split(".")[0]  # relationship fields (CreatedBy.Name) describe under the base field
            if bare_check not in available and qualified not in available:
                fields_skipped.append(key)
                continue
            soql_fields.append(qualified)
            key_by_soql_field[qualified] = key

        query = (
            f"SELECT {', '.join(soql_fields)} FROM {sobject} "
            f"WHERE Id = '{sf_project_id}' LIMIT 1"
        )
        try:
            result = sf.query(query)
        except Exception:
            logger.exception("Salesforce project query failed")
            return Response({"detail": "Could not query Salesforce."}, status=status.HTTP_502_BAD_GATEWAY)

        records = result.get("records", [])
        if not records:
            return Response({"detail": "No matching Salesforce project found."}, status=status.HTTP_404_NOT_FOUND)

        rec = records[0]
        sf_data = {}
        for qualified, key in key_by_soql_field.items():
            value = rec
            for part in qualified.split("."):
                value = (value or {}).get(part) if isinstance(value, dict) else None
            if value is not None:
                # Frontend checkboxes read the literal strings "true"/"false"
                # (ProjectDetailsModal.renderFieldInput's checkbox case).
                sf_data[key] = ("true" if value else "false") if isinstance(value, bool) else str(value)

        return Response({
            "name": rec.get("Name") or "",
            "sf_data": sf_data,
            "fields_skipped": fields_skipped,
        })


class AccountRoleViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """CRUD for AccountRole — staff only for create/delete, all auth'd users can list their own."""
    serializer_class = AccountRoleSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if _staff_sees_all(user):
            return AccountRole.objects.select_related("user", "account", "assigned_by").all()
        return AccountRole.objects.select_related("user", "account", "assigned_by").filter(user=user)

    def perform_create(self, serializer):
        if not _staff_sees_all(self.request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only staff can assign account roles.")
        serializer.save(assigned_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        if not _staff_sees_all(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only staff can remove account roles.")
        return super().destroy(request, *args, **kwargs)


class ProjectMemberViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Per-project team membership — a TeamMember can be on several projects under one account."""

    serializer_class = ProjectMemberSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        from django.db.models import Q
        user = self.request.user
        if _staff_sees_all(user):
            qs = ProjectMember.objects.select_related("team_member", "project__account")
        else:
            qs = ProjectMember.objects.select_related("team_member", "project__account").filter(
                Q(project__account__team_members__user=user) | Q(project__account__admin_owner=user)
            ).distinct()

        project_ids = csv_int_params(self.request.query_params.get("project__in"))
        if project_ids:
            qs = qs.filter(project_id__in=project_ids)
        else:
            project_id = self.request.query_params.get("project")
            if project_id:
                qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        _assert_account_membership(self.request.user, project.account if project else None)
        from .access import assert_can_change_members
        target = serializer.validated_data.get("team_member")
        assert_can_change_members(self.request.user, {target.pk} if target else set(), set())
        member = serializer.save(added_by=self.request.user)
        self._cloud_coach = self._push_to_cloud_coach(member)

    def _push_to_cloud_coach(self, member) -> dict | None:
        """
        Add the person to the project in Cloud Coach, so they can log time against it.

        Best effort: a Salesforce failure never fails the local create. The local link is
        valid regardless, and discarding it because a third party was unreachable would
        cost the user work they just did.
        """
        sf_project_id = (member.project.sf_project_id or "").strip()
        if not sf_project_id:
            return None
        from salesforce_sync.project_members import push_member_to_project
        try:
            return push_member_to_project(
                self.request.user, sf_project_id, member.team_member
            )
        except Exception:
            logger.exception(
                "Cloud Coach member push failed for %s on %s",
                member.team_member.email, member.project.name,
            )
            return {
                "status": "error",
                "member_name": member.team_member.full_name,
                "project_name": member.project.name,
                "message": "Could not reach Salesforce to add them to the project.",
            }

    def create(self, request, *args, **kwargs):
        """Return the push outcome alongside the created row, leaving its shape intact."""
        self._cloud_coach = None
        response = super().create(request, *args, **kwargs)
        if self._cloud_coach and isinstance(response.data, dict):
            response.data["cloud_coach"] = self._cloud_coach
        return response

    def perform_destroy(self, instance):
        # Deliberately does NOT remove them in Cloud Coach. Clearing a named project role
        # or deleting a Resource Assignment is destructive and was not asked for; a local
        # un-link should not quietly rewrite a shared Salesforce record.
        _assert_account_membership(self.request.user, instance.project.account)
        from .access import assert_can_change_members
        assert_can_change_members(self.request.user, set(), {instance.team_member_id})
        instance.delete()
