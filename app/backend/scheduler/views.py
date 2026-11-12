"""API views for the scheduler app."""

import logging
from datetime import timezone as dt_timezone

from asgiref.sync import async_to_sync
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from channels.layers import get_channel_layer
from rest_framework import filters, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import RequireAccountMembershipMixin, RequireCalendarEventOwnershipMixin, _staff_sees_all
from core.pagination import ClientPageSizePagination
from core.query_params import csv_int_params
from realtime.sync import publish_activity_event
from .event_log import changed_labels, record_event_change, snapshot as event_snapshot

from . import reminder_calendar, reminder_links, reminder_recipients, reminder_snooze
from .models import ActionItem, CalendarEvent, MeetingNote, Reminder, Task
from .serializers import ActionItemSerializer, CalendarEventSerializer, MeetingNoteSerializer, ReminderSerializer, TaskSerializer

logger = logging.getLogger(__name__)

# Fields the `details` action lets an owner edit on their own event.
#
# `agentpm_airtable_id` is here so "convert this event to an action item" can record the
# link it creates. It is safe to expose: `_sync_google_calendar` only overwrites it when
# Google actually carries a value, so a locally-written link survives the next sync.
DETAILS_EDITABLE_FIELDS = frozenset({
    "title",
    "description",
    "location",
    "start_datetime",
    "end_datetime",
    "all_day",
    "event_category",
    "agentpm_airtable_id",
    "artifact_ids",
})

# The fields Google owns — i.e. the ones `_sync_google_calendar` puts in its
# `update_or_create` defaults and therefore rewrites on every sync, and the ones
# `_update_in_google` sends back. A local edit to any of them must be pushed or it is
# silently reverted. Deliberately excludes `event_category` (no Google equivalent, and
# the sync already preserves it) and `agentpm_airtable_id` (carried in extendedProperties,
# which `_update_in_google` does not send).
GOOGLE_OWNED_EVENT_FIELDS = (
    "title",
    "description",
    "location",
    "start_datetime",
    "end_datetime",
    "all_day",
    "status",
    "attendees",
)


# What CreateEventModal sends for "Google Meet": a placeholder, replaced by a real
# conference link that Google creates on insert.
MEET_PLACEHOLDER_URL = "https://meet.google.com/new"


def _guest_emails(event) -> list[str]:
    """Attendee emails on `event`, skipping the owner's own address and blanks."""
    own = (getattr(event.owner, "email", "") or "").lower()
    seen, out = set(), []
    for a in event.attendees or []:
        email = (a.get("email") or "").strip() if isinstance(a, dict) else ""
        if email and email.lower() != own and email.lower() not in seen:
            seen.add(email.lower())
            out.append(email)
    return out


def _send_invites_flag(data, event) -> bool:
    """
    Did the caller explicitly approve emailing the guests? **Absent means no.**

    This used to be the opposite — "an API caller that adds attendees expects them to hear
    about it" — so any API or voice caller that added guests emailed them with no approval at
    all. After a customer received 2,000+ invitations from one meeting move, approval is
    never assumed: it must be a deliberate, explicit yes in the request.
    """
    raw = data.get("send_invites") if hasattr(data, "get") else None
    if raw is None:
        return False
    if isinstance(raw, str):
        return raw.strip().lower() in ("1", "true", "yes")
    return bool(raw)


def _google_owned_snapshot(event):
    """Comparable tuple of the Google-owned fields, or None for no instance."""
    if event is None:
        return None
    return tuple(str(getattr(event, field, "")) for field in GOOGLE_OWNED_EVENT_FIELDS)


class CalendarEventViewSet(RequireAccountMembershipMixin, viewsets.ModelViewSet):
    """List, create, update, and delete calendar events."""

    serializer_class = CalendarEventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    # `?search=` backs the calendar search box; account name so "Acme" finds Acme meetings.
    search_fields = ["title", "description", "location", "account__company_name"]
    ordering_fields = ["start_datetime", "end_datetime", "created_at"]
    ordering = ["start_datetime"]
    pagination_class = None  # Calendar events are always fetched for a bounded range — never paginate
    account_field_name = "account"

    def get_queryset(self):
        qs = CalendarEvent.objects.filter(owner=self.request.user)
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        calendar_id = self.request.query_params.get("calendar_id")
        title = self.request.query_params.get("title")
        # Overlap check: event overlaps [start, end) if it ends after start AND starts before end
        if start:
            qs = qs.filter(end_datetime__gte=start)
        if end:
            qs = qs.filter(start_datetime__lt=end)
        if calendar_id:
            qs = qs.filter(calendar_id=calendar_id)
        if title:
            qs = qs.filter(title=title)
        agentpm_airtable_id = self.request.query_params.get("agentpm_airtable_id")
        if agentpm_airtable_id:
            qs = qs.filter(agentpm_airtable_id=agentpm_airtable_id)
        return qs

    @action(detail=True, methods=["patch"], url_path="attendance")
    def attendance(self, request, pk=None):
        """PATCH /scheduler/events/<pk>/attendance/ — record whether the owner attended.

        Body: {"attended": true | false | null}. Tri-state: null clears the record.

        A dedicated action rather than the generic PATCH because attendance is the
        owner's private annotation of their own event. The generic update path runs
        RequireAccountMembershipMixin, which would 403 a user marking their own
        meeting when that meeting is linked to an account they aren't a member of.
        `get_object()` is already scoped to `owner=request.user`, so another user's
        event 404s here.
        """
        event = self.get_object()

        if "attended" not in request.data:
            return Response({"attended": "This field is required."}, status=400)
        value = request.data["attended"]
        # isinstance, not `in (True, False, None)` — Python treats 1 == True and
        # 0 == False, so a membership test would silently accept integers.
        if not (value is None or isinstance(value, bool)):
            return Response(
                {"attended": "Must be true, false, or null."}, status=400
            )

        event.attended = value
        event.save(update_fields=["attended", "updated_at"])
        if value is not None:
            record_event_change(
                request.user, "attendance", event,
                message=f'Marked {"attended" if value else "did not attend"}: "{event.title}"',
                extra={"attended": value},
            )
        return Response(CalendarEventSerializer(event, context={"request": request}).data)

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        result = getattr(self, "_google_sync_result", None)
        if result is not None and isinstance(response.data, dict):
            # Additive key, present only for primary-calendar creates.
            response.data["google_sync"] = result
        return response

    def perform_create(self, serializer):
        self._autolink_account_from_action_item(serializer)
        # RequireAccountMembershipMixin.perform_create would run this too, but this
        # viewset overrides perform_create to inject owner=user and Google sync, so
        # the subclass wins the MRO. Call the mixin's helper explicitly so account
        # re-parenting is still gated on team membership.
        self._check_account_membership(self._resolve_target_account(serializer))
        # origin="agentpm": the model default is "google" (fail closed), so an event is only
        # ever eligible to email guests because this code path said it was created here.
        event = serializer.save(owner=self.request.user, origin="agentpm")
        self._store_source_links(event)

        # Push primary-calendar events straight to Google Calendar. The outcome is kept on
        # the view so `create` can report it: a meeting saved locally but never sent to
        # Google means the guests got no invite, and that must not look like success.
        self._google_sync_result = None
        if event.calendar_id == "primary":
            send_invites = _send_invites_flag(self.request.data, event)
            try:
                pushed = self._push_to_google(event, send_invites=send_invites)
                self._google_sync_result = {
                    "status": "ok" if pushed else "not_connected",
                    # What the gateway actually did, not what was asked for: the invite gate
                    # can refuse an approved send (switch off, past event, hourly budget), and
                    # a caller must never be told guests were emailed when they were not.
                    "invites_sent": bool(pushed and event.invite_sent),
                }
            except Exception:
                logger.exception("Failed to push new event '%s' to Google Calendar", event.title)
                self._google_sync_result = {"status": "failed", "invites_sent": False}

        record_event_change(
            self.request.user, "created", event,
            message=f'Event created: "{event.title}"',
        )

    def _store_source_links(self, event):
        """Persist `agentpm_airtable_id` / `reminder` from the raw request body onto a new row.

        Both are `read_only` on the serializer (the Airtable and Google syncs own them on an
        existing row), so they never reach `validated_data` and handing them to the serializer
        would be silently dropped while still returning 201 — the same trap the `details`
        action documents for `agentpm_airtable_id`. Assign them on the model instead.

        This is what makes "drop an action item / reminder on the calendar" durable: the row
        records what it is a scheduled occurrence *of*, so the calendar can render it, the
        Google sync can recognise it as AgentPM-owned, and the rest of the app can find it.
        """
        update_fields = []

        airtable_id = self.request.data.get("agentpm_airtable_id")
        if isinstance(airtable_id, str) and airtable_id:
            event.agentpm_airtable_id = airtable_id
            update_fields.append("agentpm_airtable_id")

        reminder_id = self.request.data.get("reminder")
        if reminder_id not in (None, ""):
            # Scoped to the caller's own reminders. A blind assignment would let anyone
            # attach their calendar block to a stranger's reminder, and `Reminder` has no
            # object-permission check of its own on this path.
            reminder = Reminder.objects.filter(
                pk=reminder_id, created_by=self.request.user
            ).first()
            if reminder is not None:
                event.reminder = reminder
                update_fields.append("reminder")
            else:
                logger.warning(
                    "Ignoring reminder=%r on new calendar event for %s: not found or not theirs",
                    reminder_id, self.request.user,
                )

        # Project carry-over: an item filed under a project (or under a goal whose parent is a
        # project) hands that project to the calendar block it is scheduled as. An explicit
        # `project` in the body wins, but only if the caller can already see that project.
        from accounts.project_links import project_for_record, visible_projects
        project = None
        explicit = self.request.data.get("project")
        if explicit not in (None, ""):
            try:
                project = visible_projects(self.request.user).filter(pk=explicit).first()
            except (ValueError, TypeError):
                project = None
        if project is None:
            project = project_for_record(self.request.user, event.agentpm_airtable_id)
        if project is not None:
            event.project = project
            update_fields.append("project")

        if update_fields:
            event.save(update_fields=[*update_fields, "updated_at"])

    def _autolink_account_from_action_item(self, serializer):
        """Attach the source action item's own account when the caller omitted one.

        Work-tracking events (starting a timer / dragging an item into "Currently
        Tracking") are created with only `agentpm_airtable_id` — no `account` — so
        `account_name` came back null and the calendar grid's work_tracking fallback
        displayed the current user's own username instead of the account the action
        item is actually linked to. This reuses the same AirtableAccount->Account
        bridge `_resolve_scheduler_account` already uses for the Airtable sync path.
        """
        if serializer.validated_data.get("account") is not None:
            return  # caller already set one explicitly — don't override
        # `agentpm_airtable_id` is read_only on the serializer (see the comment on
        # DETAILS_EDITABLE_FIELDS above), so it never survives into validated_data —
        # it must be read off the raw request body instead.
        airtable_id = self.request.data.get("agentpm_airtable_id")
        if not airtable_id:
            return

        from airtable_sync.models import AirtableActionItem
        from airtable_sync.sync import _resolve_scheduler_account

        air_item = AirtableActionItem.objects.filter(airtable_id=airtable_id).select_related("account").first()
        if air_item is None:
            return
        account = _resolve_scheduler_account(air_item)
        if account is None:
            return

        # Best-effort: an auto-link must never turn "start a timer" into a 403.
        # Only attach when the caller may actually attach records to this account —
        # the same rule _check_account_membership enforces below.
        user = self.request.user
        if not _staff_sees_all(user) and not (
            account.team_members.filter(user=user).exists() or account.admin_owner_id == user.id
        ):
            return
        serializer.validated_data["account"] = account

    def _push_to_google(self, event, send_invites=False):
        """Insert `event` into the owner's primary Google calendar.

        Returns False when the owner has no Google connection (nothing was sent), True
        once Google accepted the event. Raises on a Google error.
        """
        from django.conf import settings
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from integrations.models import OAuthCredential

        # Shared path: passes the stored expiry so a stale token refreshes before the
        # request, and lets the refreshed token be saved (integrations.google_api).
        from integrations.google_api import credentials_for, persist_refreshed
        google_owner = event.owner
        google_creds = credentials_for(google_owner)
        if google_creds is None:
            return False
        service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)

        def _fmt(dt):
            # `dt` is the real datetime.datetime from the model field, not a
            # string — it is never subscriptable and has no len(). RFC3339
            # needs a literal "T" separator, which only .isoformat() produces.
            return dt.isoformat()

        body = {
            "summary": event.title,
            "description": event.description or "",
            "location": event.location or "",
            "start": {"date": event.start_datetime.date().isoformat()} if event.all_day else {"dateTime": _fmt(event.start_datetime)},
            "end":   {"date": event.end_datetime.date().isoformat()}   if event.all_day else {"dateTime": _fmt(event.end_datetime)},
            "status": event.status,
        }
        guests = _guest_emails(event)
        if guests:
            body["attendees"] = [{"email": e} for e in guests]

        # `sendUpdates` is not chosen here. The gateway asks the invite gate, which says "all"
        # only for a fresh AgentPM event the user approved and that has not already been
        # announced; every other case is "none".
        insert_kwargs = {}
        if event.meet_link == MEET_PLACEHOLDER_URL:
            # The modal's "Google Meet" choice is a placeholder, not a meeting — ask Google
            # to create a real one. Without this the next sync blanks meet_link.
            body["conferenceData"] = {"createRequest": {
                "requestId": f"agentpm-{event.pk}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }}
            insert_kwargs["conferenceDataVersion"] = 1

        from django.utils import timezone as _tz
        from integrations.google_calendar_gateway import write_event

        result = write_event(
            service, "insert", event, body=body, source="calendar.create",
            approved=bool(send_invites), approved_at=_tz.now() if send_invites else None,
            extra=insert_kwargs,
        )
        persist_refreshed(google_owner, google_creds)
        google_event_id = result.get("id", "")
        if google_event_id:
            event.google_event_id = google_event_id
            event.is_synced = True
            update_fields = ["google_event_id", "is_synced"]
            meet = result.get("hangoutLink") or ""
            if event.meet_link == MEET_PLACEHOLDER_URL:
                event.meet_link = meet
                update_fields.append("meet_link")
            event.save(update_fields=update_fields)
        return True

    def _update_in_google(self, event, *, approved=False, approved_at=None, source="calendar.update"):
        """
        PATCH an already-synced event.

        Guests are emailed only if the caller passes ``approved`` and the invite gate agrees
        (fresh AgentPM edit, not already announced, switch on, within budget). This used to send
        ``sendUpdates="all"`` on *every* edit of an event with guests, so moving one meeting
        could email all of its guests every time anything touched it.
        """
        from django.conf import settings
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from integrations.models import OAuthCredential

        # Shared path: passes the stored expiry so a stale token refreshes before the
        # request, and lets the refreshed token be saved (integrations.google_api).
        from integrations.google_api import credentials_for, persist_refreshed
        google_owner = event.owner
        google_creds = credentials_for(google_owner)
        if google_creds is None:
            return
        service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)

        def _fmt(dt):
            # Same RFC3339 fix as _push_to_google above: .isoformat() on the
            # real datetime, not str(dt) (which uses a space, not "T", and
            # Google rejects with a generic 400 Bad Request).
            return dt.isoformat()

        body = {
            "summary": event.title,
            "description": event.description or "",
            "location": event.location or "",
            "start": {"date": event.start_datetime.date().isoformat()} if event.all_day else {"dateTime": _fmt(event.start_datetime)},
            "end":   {"date": event.end_datetime.date().isoformat()}   if event.all_day else {"dateTime": _fmt(event.end_datetime)},
            "status": event.status,
        }
        guests = _guest_emails(event)
        if guests:
            body["attendees"] = [{"email": e} for e in guests]
        from integrations.google_calendar_gateway import write_event

        write_event(
            service, "patch", event, body=body, source=source,
            approved=approved, approved_at=approved_at,
        )
        persist_refreshed(google_owner, google_creds)

    def perform_update(self, serializer):
        # Guard against re-parenting an event to an account the caller isn't on.
        self._check_account_membership(self._resolve_target_account(serializer))
        # Snapshot the Google-owned fields before save so we know whether to push.
        before = _google_owned_snapshot(serializer.instance)
        logged_before = event_snapshot(serializer.instance)

        event = serializer.save()

        self._log_update(event, logged_before)

        # Push to Google whenever any field Google owns changed — not just the times.
        # `_sync_google_calendar` rewrites title/description/location/times/status from
        # Google on every sync, so a local edit that is not pushed is silently reverted
        # the next time the sync runs.
        self._push_update_if_needed(event, before)

    def _log_update(self, event, logged_before):
        """Record an edit, naming what changed. A save that changed nothing logs nothing."""
        labels = changed_labels(logged_before, event)
        if not labels:
            return
        record_event_change(
            self.request.user, "updated", event,
            message=f'Event updated: "{event.title}" ({", ".join(labels)})',
            extra={"changes": labels},
        )

    def _push_update_if_needed(self, event, before):
        """Push to Google iff the event is synced and a Google-owned field changed.

        Failures are logged, never raised: the local row is authoritative and losing the
        edit because Google was unreachable would be worse than the row drifting.

        Guests are emailed only when this request *explicitly* carries ``send_invites: true``
        (and the invite gate then agrees). Moving or renaming a meeting is silent by default.
        """
        if not (event.is_synced and event.google_event_id):
            return
        if _google_owned_snapshot(event) == before:
            return
        approved = _send_invites_flag(getattr(self.request, "data", None), event)
        try:
            from django.utils import timezone as _tz

            self._update_in_google(
                event, approved=approved, approved_at=_tz.now() if approved else None,
                source="calendar.update",
            )
        except Exception:
            logger.exception("Failed to update event '%s' in Google Calendar", event.title)

    @action(detail=True, methods=["patch"], url_path="details")
    def details(self, request, pk=None):
        """PATCH /scheduler/events/<pk>/details/ — edit an event the caller owns.

        Body may contain any of DETAILS_EDITABLE_FIELDS; anything else is ignored.

        A dedicated action rather than the generic PATCH for the same reason `attendance`
        is one: the generic update path runs RequireAccountMembershipMixin, which resolves
        the account off `serializer.instance` when the patch omits it — so it would 403 a
        user editing *their own* meeting whenever that meeting happens to be linked to an
        account they are not a team member of. Google-synced meetings get auto-linked to
        accounts, so that is the common case, not the edge case. `get_queryset` is already
        scoped to `owner=request.user`, so another user's event 404s here.
        """
        event = self.get_object()

        patch = {k: v for k, v in request.data.items() if k in DETAILS_EDITABLE_FIELDS}
        if not patch:
            return Response(
                {"detail": f"Provide at least one of: {', '.join(sorted(DETAILS_EDITABLE_FIELDS))}."},
                status=400,
            )

        if "event_category" in patch:
            valid = dict(CalendarEvent.EVENT_CATEGORY_CHOICES)
            # Validated rather than trusted: an unrecognised category has no color and no
            # label anywhere in the UI, so it would render as an untyped blank forever.
            if patch["event_category"] not in valid:
                return Response(
                    {"event_category": f"Must be one of: {', '.join(valid)}."}, status=400
                )

        if "all_day" in patch and not isinstance(patch["all_day"], bool):
            # isinstance, not truthiness — Python treats 1 == True, so a membership or
            # bool() test would silently accept integers. Same trap `attendance` hit.
            return Response({"all_day": "Must be true or false."}, status=400)

        if "artifact_ids" in patch:
            ids = patch["artifact_ids"]
            if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
                return Response({"artifact_ids": "Must be a list of integers."}, status=400)

        # `agentpm_airtable_id` is read_only on the serializer (it is normally owned by the
        # Airtable/Google sync), so handing it to the serializer would be silently dropped
        # and return a misleading 200. Assign it on the model instead — the same thing
        # `attendance` does with the equally read-only `attended`.
        link_id = patch.pop("agentpm_airtable_id", None)
        if link_id is not None and not isinstance(link_id, str):
            return Response({"agentpm_airtable_id": "Must be a string."}, status=400)

        serializer = self.get_serializer(event, data=patch, partial=True)
        serializer.is_valid(raise_exception=True)

        # Compare against the values that will actually be stored, so a patch that only
        # touches one endpoint is still checked against the other's existing value.
        new_start = serializer.validated_data.get("start_datetime", event.start_datetime)
        new_end = serializer.validated_data.get("end_datetime", event.end_datetime)
        if new_start and new_end and new_start >= new_end:
            return Response({"end_datetime": "Must be after start_datetime."}, status=400)

        before = _google_owned_snapshot(event)
        logged_before = event_snapshot(event)
        updated = serializer.save()

        if link_id is not None:
            updated.agentpm_airtable_id = link_id
            updated.save(update_fields=["agentpm_airtable_id", "updated_at"])

        self._log_update(updated, logged_before)

        # `event_category` is deliberately absent from the snapshot: Google has no such
        # field, and `_sync_google_calendar` already preserves it across syncs, so a
        # type change alone must not fire a pointless Google write.
        self._push_update_if_needed(updated, before)

        return Response(self.get_serializer(updated).data)

    def perform_destroy(self, instance):
        title = instance.title
        google_event_id = instance.google_event_id
        is_synced = instance.is_synced
        airtable_id = instance.agentpm_airtable_id
        # Only *tracked* time comes off the item: a planned block (dragged onto the
        # calendar, never timed) contributed nothing, so deleting it must not subtract its
        # length. A Live Tracking block carries its sessions; their seconds are the truth.
        from django.db.models import Sum
        tracked_secs = instance.time_sessions.filter(ended_at__isnull=False).aggregate(t=Sum("seconds"))["t"] or 0
        running_ids = list(instance.time_sessions.filter(ended_at__isnull=True).values_list("pk", flat=True))

        deleted_start = instance.start_datetime
        pk = instance.pk
        instance.delete()
        # The row is gone, so the entry carries its own title and start (see event_log).
        record_event_change(
            self.request.user, "deleted", instance, title=title,
            message=f'Event deleted: "{title}"',
            extra={"resource": {"type": "calendar_event", "id": pk},
                   "event_start": deleted_start.isoformat() if deleted_start else None},
        )
        if running_ids:
            # Deleting the block of a running timer cancels that session (nothing logged yet).
            from airtable_sync.models import ActionItemTimeSession
            ActionItemTimeSession.objects.filter(pk__in=running_ids).delete()
        if airtable_id and tracked_secs > 0:
            try:
                from django.db.models import F
                from django.db.models.functions import Greatest
                from airtable_sync.models import AirtableActionItem
                from airtable_sync.live_tracking import _push_totals
                AirtableActionItem.objects.filter(airtable_id=airtable_id).update(
                    time_spent=Greatest(F("time_spent") - tracked_secs, 0),
                    tracked_time=Greatest(F("tracked_time") - tracked_secs, 0),
                )
                ai = AirtableActionItem.objects.filter(airtable_id=airtable_id).first()
                if ai:
                    _push_totals(ai)  # the subtraction used to stay local and be undone by the next pull
            except Exception:
                logger.exception("Failed to update time_spent for action item %s", airtable_id)
        # Also delete from Google Calendar so the event doesn't re-appear on the next sync
        if is_synced and google_event_id:
            try:
                self._delete_from_google(google_event_id)
            except Exception:
                logger.exception("Failed to delete event '%s' from Google Calendar", title)

    def _delete_from_google(self, google_event_id: str):
        from django.conf import settings
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from integrations.models import OAuthCredential

        # Shared path: passes the stored expiry so a stale token refreshes before the
        # request, and lets the refreshed token be saved (integrations.google_api).
        from integrations.google_api import credentials_for, persist_refreshed
        google_owner = self.request.user
        google_creds = credentials_for(google_owner)
        if google_creds is None:
            return
        service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)
        from integrations.google_calendar_gateway import delete_by_id

        delete_by_id(service, google_owner, google_event_id, source="calendar.delete")
        persist_refreshed(google_owner, google_creds)


def _shared_team_or_self(user, target_user) -> bool:
    """Return True if target_user is the caller, or shares any Team membership with the caller.

    Used to gate `assigned_to` writes: a user may only assign items/tasks to
    themselves or to teammates on a shared Team (a `TeamMembership` row that
    joins them on the same team_id).
    """
    if target_user is None:
        return True
    if getattr(user, "pk", None) == getattr(target_user, "pk", None):
        return True
    from team.models import TeamMembership
    caller_team_ids = TeamMembership.objects.filter(user=user).values_list("team_id", flat=True)
    return TeamMembership.objects.filter(
        user=target_user, team_id__in=list(caller_team_ids)
    ).exists()


def _user_belongs_to_account(user, account) -> bool:
    """True when the caller is a team member of `account` (via TeamMember.user)
    or its admin_owner. Mirrors the pattern in accounts/views.py."""
    if account is None:
        return True
    from django.db.models import Q
    from accounts.models import Account
    return Account.objects.filter(
        Q(pk=account.pk) & (Q(team_members__user=user) | Q(admin_owner=user))
    ).exists()


class ActionItemViewSet(viewsets.ModelViewSet):
    """List, create, update, and delete action items."""

    serializer_class = ActionItemSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["title", "notes"]
    ordering_fields = ["due_date", "priority", "status", "created_at"]

    def get_queryset(self):
        user = self.request.user
        user_team_ids = user.memberships.values_list("team_id", flat=True)
        view = self.request.query_params.get("view", "mine")
        if view == "team":
            qs = ActionItem.objects.filter(
                assigned_to__memberships__team_id__in=user_team_ids
            ).distinct()
        else:
            qs = ActionItem.objects.filter(assigned_to=user)
        status_filter = self.request.query_params.get("status")
        priority_filter = self.request.query_params.get("priority")
        if status_filter:
            qs = qs.filter(status=status_filter)
        if priority_filter:
            qs = qs.filter(priority=priority_filter)
        return qs

    def _validate_writable_fks(self, serializer):
        """Gate the three client-writable FKs (account, assigned_to, source_event)
        on caller membership/ownership. Staff bypass. Falls back to the persisted
        value on update when the field is absent from the payload."""
        from core.mixins import _staff_sees_all
        user = self.request.user
        if _staff_sees_all(user):
            return

        vd = serializer.validated_data
        instance = serializer.instance

        # account — caller must be on the account team (or admin_owner)
        if "account" in vd:
            target_account = vd.get("account")
            if target_account is not None and not _user_belongs_to_account(user, target_account):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You cannot attach action items to this account.")

        # assigned_to — must be self or share a Team with the caller
        if "assigned_to" in vd:
            target_user = vd.get("assigned_to")
            if target_user is not None and not _shared_team_or_self(user, target_user):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You cannot assign action items to a user outside your teams.")

        # source_event — must be owned by the caller (staff already bypassed)
        if "source_event" in vd:
            source_event = vd.get("source_event")
            if source_event is not None and getattr(source_event, "owner_id", None) != getattr(user, "pk", None):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You cannot link an action item to another user's calendar event.")

    def perform_create(self, serializer):
        self._validate_writable_fks(serializer)
        item = serializer.save(created_by=self.request.user)
        publish_activity_event(
            self.request.user, "action_item.created",
            "**Created** Action Item",
            detail=item.title,
        )

    def perform_update(self, serializer):
        self._validate_writable_fks(serializer)
        item = serializer.save()
        publish_activity_event(
            self.request.user, "action_item.updated",
            "**Updated** Action Item",
            detail=item.title,
        )

    def perform_destroy(self, instance):
        title = instance.title
        instance.delete()
        publish_activity_event(
            self.request.user, "action_item.deleted",
            "**Deleted** Action Item",
            detail=title,
        )


class TaskViewSet(viewsets.ModelViewSet):
    """List, create, update, and delete tasks."""

    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["title", "description"]
    ordering_fields = ["due_date", "priority", "status", "created_at"]

    def get_queryset(self):
        user = self.request.user
        user_team_ids = user.memberships.values_list("team_id", flat=True)
        view = self.request.query_params.get("view", "mine")
        if view == "team":
            # All tasks assigned to anyone on a shared team
            qs = Task.objects.filter(
                assigned_to__memberships__team_id__in=user_team_ids
            ).distinct()
        else:
            qs = Task.objects.filter(assigned_to=user)
        qs = qs.select_related("assigned_to", "created_by", "action_item")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def _validate_writable_fks(self, serializer):
        """Gate `assigned_to` (shared-team or self) and `action_item` (caller
        belongs to its account, or is its assignee) on writes. Staff bypass."""
        from core.mixins import _staff_sees_all
        user = self.request.user
        if _staff_sees_all(user):
            return

        vd = serializer.validated_data

        if "assigned_to" in vd:
            target_user = vd.get("assigned_to")
            if target_user is not None and not _shared_team_or_self(user, target_user):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You cannot assign tasks to a user outside your teams.")

        if "action_item" in vd:
            ai = vd.get("action_item")
            if ai is not None:
                allowed = False
                if ai.account_id and _user_belongs_to_account(user, ai.account):
                    allowed = True
                if getattr(ai, "assigned_to_id", None) == getattr(user, "pk", None):
                    allowed = True
                if not allowed:
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("You cannot link a task to this action item.")

    def perform_create(self, serializer):
        self._validate_writable_fks(serializer)
        task = serializer.save(created_by=self.request.user)
        publish_activity_event(
            self.request.user, "task.created",
            "**Created** Task",
            detail=task.title,
        )

    def perform_update(self, serializer):
        self._validate_writable_fks(serializer)
        task = serializer.save()
        publish_activity_event(
            self.request.user, "task.updated",
            "**Updated** Task",
            detail=task.title,
        )

    def perform_destroy(self, instance):
        title = instance.title
        instance.delete()
        publish_activity_event(
            self.request.user, "task.deleted",
            "**Deleted** Task",
            detail=title,
        )


class ReminderViewSet(viewsets.ModelViewSet):
    """CRUD for reminders."""

    serializer_class = ReminderSerializer
    permission_classes = [IsAuthenticated]
    # Honour `?page_size=` (the project default ignores it): the sidebar and the Reminders page
    # list every reminder, and a fixed 50 would cut the newest off.
    pagination_class = ClientPageSizePagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["title", "body", "resource_label"]
    ordering_fields = ["due_at", "status", "created_at"]
    ordering = ["due_at"]

    def get_queryset(self):
        qs = Reminder.objects.filter(created_by=self.request.user)
        status_filter = self.request.query_params.get("status")
        resource_type = self.request.query_params.get("resource_type")
        resource_id = self.request.query_params.get("resource_id")
        if status_filter:
            qs = qs.filter(status=status_filter)
        if resource_type:
            qs = qs.filter(resource_type=resource_type)
        if resource_id:
            qs = qs.filter(resource_id=resource_id)
        # Optional window on when the reminder is due. A value that is present but not a date
        # narrows to nothing rather than silently returning everything.
        for param, lookup in (("due_after", "due_at__gte"), ("due_before", "due_at__lte")):
            raw = self.request.query_params.get(param)
            if raw:
                parsed = parse_datetime(raw.replace(" ", "+")) if raw else None  # a raw "+" in a URL arrives as " "
                qs = qs.filter(**{lookup: parsed}) if parsed else qs.none()
        return qs

    def perform_create(self, serializer):
        reminder = serializer.save(created_by=self.request.user)
        reminder_calendar.sync_reminder_block(reminder, created=True)
        publish_activity_event(
            self.request.user, "reminder.created",
            "**Created** Reminder",
            detail=reminder.title,
            metadata={
                "due_at": reminder.due_at.isoformat() if reminder.due_at else None,
                # Who else will be notified — the audit trail for "why did X get this?".
                "recipient_ids": list(reminder.recipients.values_list("pk", flat=True)),
            },
        )

    def perform_update(self, serializer):
        previous_due_at = serializer.instance.due_at
        previous_status = serializer.instance.status
        reminder = serializer.save()
        if reminder.due_at != previous_due_at:
            reminder_calendar.rearm_if_future(reminder)  # a sent reminder moved to the future fires again
        reminder_calendar.sync_reminder_block(reminder, previous_due_at=previous_due_at, previous_status=previous_status)
        publish_activity_event(
            self.request.user, "reminder.updated",
            "**Updated** Reminder",
            detail=reminder.title,
            metadata={"recipient_ids": list(reminder.recipients.values_list("pk", flat=True))},
        )

    @action(detail=True, methods=["post"], url_path="occurrences")
    def add_occurrence(self, request, pk=None):
        """
        Put the reminder on the calendar at another time (`{"start": <ISO instant>}`).

        A reminder can be on the calendar any number of times; each is a 15-minute block and
        each notifies at its own start. Asking for a minute it is already at returns that
        occurrence (200) instead of stacking a second block (201 when new).
        """
        reminder = self.get_object()
        start = parse_datetime(str(request.data.get("start") or ""))
        if start is None:
            return Response({"start": "Provide a start time (ISO 8601, with an offset)."}, status=400)
        if timezone.is_naive(start):
            start = timezone.make_aware(start, dt_timezone.utc)
        if reminder.status not in reminder_calendar.VISIBLE_STATUSES:
            return Response({"detail": "A dismissed reminder can't be added to the calendar."}, status=400)
        occ, created = reminder_calendar.add_occurrence(reminder, start)
        if created and start <= timezone.now():
            # Added to a moment that has already passed: nothing to remind about.
            CalendarEvent.objects.filter(pk=occ.pk).update(reminder_notified_at=timezone.now())
        return Response(self.get_serializer(reminder).data, status=201 if created else 200)

    @action(detail=True, methods=["patch", "delete"], url_path=r"occurrences/(?P<event_pk>\d+)")
    def occurrence(self, request, pk=None, event_pk=None):
        """Move (`PATCH {"start"}`) or remove (`DELETE`) one of the reminder's calendar blocks."""
        reminder = self.get_object()
        occ = reminder_calendar.occurrences(reminder).filter(pk=event_pk).first()
        if occ is None:
            return Response({"detail": "Not found."}, status=404)
        if request.method == "DELETE":
            occ.delete()
            return Response(self.get_serializer(reminder).data)
        start = parse_datetime(str(request.data.get("start") or ""))
        if start is None:
            return Response({"start": "Provide a start time (ISO 8601, with an offset)."}, status=400)
        if timezone.is_naive(start):
            start = timezone.make_aware(start, dt_timezone.utc)
        if reminder_calendar.move_occurrence(reminder, occ, start) is None:
            return Response({"start": "The reminder is already on the calendar at that time."}, status=400)
        reminder.refresh_from_db()
        return Response(self.get_serializer(reminder).data)

    @action(detail=False, methods=["get"], url_path="link-options")
    def link_options(self, request):
        """
        Records a reminder can be linked to, for the picker: `?type=account|action_item|calendar_event|task`
        and an optional `?q=` to filter. Only records the caller can already see in the app.
        """
        link_type = request.query_params.get("type")
        if link_type not in reminder_links.LINK_TYPES:
            return Response({"type": f"Choose one of: {', '.join(reminder_links.LINK_TYPES)}."}, status=400)
        return Response({"results": reminder_links.search(request.user, link_type, request.query_params.get("q", ""))})

    @action(detail=False, methods=["get"], url_path="recipients")
    def recipients(self, request):
        """
        People who could be notified by a reminder with these links, with availability: the teams of the
        linked accounts, your manager, and — for a reminder about your Admin workspace — your colleagues.

        Pass `?link=<type>:<id>` once per link (e.g. `link=account:3&link=action_item:11`), or the
        older `?account=<id>`. The teammates are those on the accounts the links lead to that the
        caller is on — an action item or meeting counts through the account it is filed under.
        Links the caller cannot see are an error (404, so it does not reveal what exists). People
        who have turned off being notified by others are **listed** with `available: false` and a
        reason, so the UI can show them disabled rather than hide them.
        """
        raw = request.query_params.getlist("link")
        legacy = request.query_params.get("account")
        if legacy:
            raw.append(f"account:{legacy}")
        links = []
        for item in raw:
            kind, _, pk = item.partition(":")
            links.append({"resource_type": kind, "resource_id": pk})
        try:
            clean = reminder_links.normalize_links(request.user, links)
        except serializers.ValidationError:
            return Response({"detail": "Not found."}, status=404)
        people, sources = reminder_recipients.pool(request.user, clean)
        return Response({
            "results": [c.as_dict() for c in people],
            # Where the people come from — linked accounts, "Your colleagues", "Your manager" — so the
            # picker can say so (or why it is empty). `accounts` is kept for older callers.
            "sources": sources,
            "accounts": [x for x in sources if x not in (reminder_recipients.MANAGER_LABEL, reminder_recipients.COLLEAGUES_LABEL)],
        })

    def perform_destroy(self, instance):
        title = instance.title
        # Its calendar blocks go with it. The FK is SET_NULL (so unlinking never erases a block
        # on purpose), which on a delete would leave an orphan "reminders" block on the grid —
        # and, if it was mirrored to Google, an orphan event there too.
        blocks = list(instance.calendar_events.filter(calendar_id="reminders", owner=self.request.user))
        instance.delete()
        for block in blocks:
            google_event_id, synced = block.google_event_id, block.is_synced
            block.delete()
            if synced and google_event_id:
                try:
                    calendar_view = CalendarEventViewSet()
                    calendar_view.request = self.request
                    calendar_view._delete_from_google(google_event_id)
                except Exception:
                    logger.exception("Failed to delete reminder block '%s' from Google Calendar", title)
        publish_activity_event(
            self.request.user, "reminder.deleted",
            "**Deleted** Reminder",
            detail=title,
        )

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        reminder = self.get_object()
        reminder.status = "dismissed"
        reminder.save(update_fields=["status", "updated_at"])
        reminder_calendar.sync_reminder_block(reminder)  # a dismissed reminder leaves the grid
        self._acknowledge_alerts(request.user, reminder)
        publish_activity_event(
            request.user, "reminder.dismissed",
            "**Dismissed** Reminder",
            detail=reminder.title,
        )
        return Response(self.get_serializer(reminder).data)

    @staticmethod
    def _acknowledge_alerts(user, reminder) -> None:
        """Snoozing or dismissing answers any alert still on screen for this reminder."""
        from team.models import Notification

        Notification.objects.filter(
            user=user, reminder=reminder, kind="reminder", read_at__isnull=True,
        ).update(read_at=timezone.now())

    @action(detail=True, methods=["post"])
    def snooze(self, request, pk=None):
        """
        Reschedule the reminder: it fires again at the chosen time, and its calendar block moves.

        Body: `{"until": <ISO instant>}` or `{"preset": "next_account_meeting"}` (15 minutes before
        the next meeting on the reminder's account), plus optionally `"from": <ISO instant>` — the
        time the user is looking at (the block the card sits under). That block moves to the new
        time; if it is the one at the due time the due time moves with it and the reminder is
        re-armed. Without `from`, the block at the due time moves. Past or invalid times are 400
        and change nothing. Used to also mark the reminder "snoozed" without touching any time,
        which stopped it ever firing.
        """
        reminder = self.get_object()
        until, error = reminder_snooze.resolve_until(reminder, request.data)
        if error:
            return Response({"until": error}, status=400)

        from_start = parse_datetime(str(request.data.get("from") or ""))
        if from_start is not None and timezone.is_naive(from_start):
            from_start = timezone.make_aware(from_start, dt_timezone.utc)
        block = reminder_calendar.occurrence_at(reminder, from_start) if from_start else None

        if block is not None and reminder.status in reminder_calendar.VISIBLE_STATUSES:
            if reminder_calendar.move_occurrence(reminder, block, until) is None:
                return Response({"until": "The reminder is already on the calendar at that time."}, status=400)
            reminder.refresh_from_db()
        else:
            previous_due_at, previous_status = reminder.due_at, reminder.status
            reminder.due_at = until
            reminder.status = "pending"
            reminder.save(update_fields=["due_at", "status", "updated_at"])
            reminder_calendar.sync_reminder_block(
                reminder, previous_due_at=previous_due_at, previous_status=previous_status
            )
        self._acknowledge_alerts(request.user, reminder)
        publish_activity_event(
            request.user, "reminder.snoozed",
            "**Snoozed** Reminder",
            detail=reminder.title,
            metadata={"until": until.isoformat()},
        )
        return Response(self.get_serializer(reminder).data)


def _broadcast_note(event_id: int, action: str, note_data: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            f"meeting_notes_{event_id}",
            {"type": "note.update", "action": action, "note": note_data},
        )
    except Exception:
        logger.exception("Failed to broadcast meeting note for event %s", event_id)


class MeetingNoteViewSet(RequireCalendarEventOwnershipMixin, viewsets.ModelViewSet):
    """CRUD for meeting notes; writes broadcast via WebSocket to all viewers."""

    serializer_class = MeetingNoteSerializer
    permission_classes = [IsAuthenticated]
    event_field_name = "event"
    # Batched ?event=1,2,3 requests cover many events at once and would be silently
    # truncated by the project-default PAGE_SIZE of 50. This also makes the ?page_size=
    # that callers already send take effect. Response shape is unchanged.
    pagination_class = ClientPageSizePagination

    def get_queryset(self):
        # Notes are scoped to the calendar event's owner (mirroring CalendarEventViewSet).
        # Staff bypass, so admins can still audit any thread.
        # PATCH/DELETE are additionally scoped to the note's author via check_object_permissions.
        qs = MeetingNote.objects.select_related("author", "event", "author__profile")
        user = self.request.user

        # ?action_item=<airtable_id>: every note on any calendar block of that action item —
        # what its modal shows as "Calendar notes". Derived on read rather than copied into
        # the item, so editing or deleting a note can never leave a stale duplicate behind.
        # A shared item's notes are visible to anyone who can see the item, across owners.
        action_item = (self.request.query_params.get("action_item") or "").strip()
        if action_item and self.action == "list":
            from airtable_sync.models import AirtableActionItem
            from airtable_sync.views import _exclude_private_admin_items
            visible = _exclude_private_admin_items(
                AirtableActionItem.objects.filter(airtable_id=action_item), user
            ).exists()
            if not visible:
                return qs.none()
            return qs.filter(event__agentpm_airtable_id=action_item).order_by("event__start_datetime", "position", "created_at")

        if not (getattr(user, "is_staff", False)):
            qs = qs.filter(event__owner=user)
        # ?event= accepts a single PK or a comma-separated batch ("5" or "5,6,7") so a
        # caller rendering many events fetches their notes in one request instead of
        # one per event. The owner scoping above still applies to every ID in the batch.
        event_param = self.request.query_params.get("event")
        if event_param:
            event_ids = csv_int_params(event_param)
            # A present-but-unparseable filter narrows to nothing rather than falling
            # through and returning every note the caller can see.
            qs = qs.filter(event_id__in=event_ids) if event_ids else qs.none()
        return qs

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            if not request.user.is_staff and obj.author_id != request.user.pk:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You can only edit your own meeting notes.")

    def perform_create(self, serializer):
        # RequireCalendarEventOwnershipMixin.perform_create would run this, but
        # this viewset overrides perform_create to inject author=user, so the
        # subclass wins the MRO. Call the mixin's helper explicitly so a caller
        # can't POST notes onto another user's calendar event at create time.
        self._check_event_ownership(self._resolve_target_event(serializer))
        note = serializer.save(author=self.request.user)
        data = MeetingNoteSerializer(note).data
        _broadcast_note(note.event_id, "created", data)

    def perform_update(self, serializer):
        # Guard against re-parenting a note to a different calendar event via PATCH.
        self._check_event_ownership(self._resolve_target_event(serializer))
        note = serializer.save()
        data = MeetingNoteSerializer(note).data
        _broadcast_note(note.event_id, "updated", data)

    def perform_destroy(self, instance):
        event_id = instance.event_id
        note_id = instance.id
        instance.delete()
        _broadcast_note(event_id, "deleted", {"id": note_id})
