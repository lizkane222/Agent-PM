"""API views for the scheduler app."""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import RequireAccountMembershipMixin, RequireCalendarEventOwnershipMixin
from realtime.sync import publish_activity_event

from .models import ActionItem, CalendarEvent, MeetingNote, Reminder, Task
from .serializers import ActionItemSerializer, CalendarEventSerializer, MeetingNoteSerializer, ReminderSerializer, TaskSerializer

logger = logging.getLogger(__name__)


class CalendarEventViewSet(RequireAccountMembershipMixin, viewsets.ModelViewSet):
    """List, create, update, and delete calendar events."""

    serializer_class = CalendarEventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["title", "description", "location"]
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

    def perform_create(self, serializer):
        # RequireAccountMembershipMixin.perform_create would run this too, but this
        # viewset overrides perform_create to inject owner=user and Google sync, so
        # the subclass wins the MRO. Call the mixin's helper explicitly so account
        # re-parenting is still gated on team membership.
        self._check_account_membership(self._resolve_target_account(serializer))
        event = serializer.save(owner=self.request.user)

        # Push primary-calendar events straight to Google Calendar
        if event.calendar_id == "primary":
            try:
                self._push_to_google(event)
            except Exception:
                logger.exception("Failed to push new event '%s' to Google Calendar", event.title)

        publish_activity_event(
            self.request.user, "calendar_event.created",
            f"**Created** Calendar Event",
            detail=event.title,
        )

    def _push_to_google(self, event):
        from django.conf import settings
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from integrations.models import OAuthCredential

        try:
            cred = OAuthCredential.objects.get(user=event.owner, provider="google", is_active=True)
        except OAuthCredential.DoesNotExist:
            return

        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=cred.scopes.split(),
        )
        service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)

        def _fmt(dt_str):
            # Ensure RFC3339 — add Z if bare local string without offset
            if dt_str and len(dt_str) == 19:
                return dt_str + "Z"
            return dt_str

        body = {
            "summary": event.title,
            "description": event.description or "",
            "location": event.location or "",
            "start": {"date": event.start_datetime[:10]} if event.all_day else {"dateTime": _fmt(event.start_datetime)},
            "end":   {"date": event.end_datetime[:10]}   if event.all_day else {"dateTime": _fmt(event.end_datetime)},
            "status": event.status,
        }
        if event.attendees:
            body["attendees"] = [{"email": a["email"]} for a in event.attendees if a.get("email")]

        result = service.events().insert(calendarId="primary", body=body).execute()
        google_event_id = result.get("id", "")
        if google_event_id:
            event.google_event_id = google_event_id
            event.is_synced = True
            event.save(update_fields=["google_event_id", "is_synced"])

    def _update_in_google(self, event):
        """PATCH start/end (and optionally title/description) for an already-synced event."""
        from django.conf import settings
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from integrations.models import OAuthCredential

        try:
            cred = OAuthCredential.objects.get(user=event.owner, provider="google", is_active=True)
        except OAuthCredential.DoesNotExist:
            return

        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=cred.scopes.split(),
        )
        service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)

        def _fmt(dt_str):
            if dt_str and len(str(dt_str)) == 19:
                return str(dt_str) + "Z"
            return str(dt_str)

        body = {
            "summary": event.title,
            "description": event.description or "",
            "location": event.location or "",
            "start": {"date": str(event.start_datetime)[:10]} if event.all_day else {"dateTime": _fmt(str(event.start_datetime))},
            "end":   {"date": str(event.end_datetime)[:10]}   if event.all_day else {"dateTime": _fmt(str(event.end_datetime))},
            "status": event.status,
        }
        service.events().patch(
            calendarId="primary",
            eventId=event.google_event_id,
            body=body,
        ).execute()

    def perform_update(self, serializer):
        # Guard against re-parenting an event to an account the caller isn't on.
        self._check_account_membership(self._resolve_target_account(serializer))
        # Capture old datetimes before save so we know whether times changed
        instance = serializer.instance
        old_start = str(instance.start_datetime) if instance else None
        old_end = str(instance.end_datetime) if instance else None

        event = serializer.save()

        publish_activity_event(
            self.request.user, "calendar_event.updated",
            f"**Updated** Calendar Event",
            detail=event.title,
        )

        # Sync time changes to Google Calendar for any synced event
        times_changed = (
            old_start != str(event.start_datetime) or
            old_end != str(event.end_datetime)
        )
        if times_changed and event.is_synced and event.google_event_id:
            try:
                self._update_in_google(event)
            except Exception:
                logger.exception("Failed to update event '%s' in Google Calendar", event.title)

    def perform_destroy(self, instance):
        title = instance.title
        google_event_id = instance.google_event_id
        is_synced = instance.is_synced
        airtable_id = instance.agentpm_airtable_id
        duration_secs = int((instance.end_datetime - instance.start_datetime).total_seconds())

        instance.delete()
        publish_activity_event(
            self.request.user, "calendar_event.deleted",
            "**Deleted** Calendar Event",
            detail=title,
        )
        # Subtract duration from the linked action item's time_spent
        if airtable_id and duration_secs > 0:
            try:
                from airtable_sync.models import AirtableActionItem
                ai = AirtableActionItem.objects.filter(airtable_id=airtable_id).first()
                if ai:
                    ai.time_spent = max(0, ai.time_spent - duration_secs)
                    ai.save(update_fields=["time_spent"])
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

        try:
            cred = OAuthCredential.objects.get(user=self.request.user, provider="google", is_active=True)
        except OAuthCredential.DoesNotExist:
            return

        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=cred.scopes.split(),
        )
        service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)
        service.events().delete(calendarId="primary", eventId=google_event_id).execute()


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
        return qs

    def perform_create(self, serializer):
        reminder = serializer.save(created_by=self.request.user)
        publish_activity_event(
            self.request.user, "reminder.created",
            "**Created** Reminder",
            detail=reminder.title,
            metadata={"due_at": reminder.due_at.isoformat() if reminder.due_at else None},
        )

    def perform_update(self, serializer):
        reminder = serializer.save()
        publish_activity_event(
            self.request.user, "reminder.updated",
            "**Updated** Reminder",
            detail=reminder.title,
        )

    def perform_destroy(self, instance):
        title = instance.title
        instance.delete()
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
        publish_activity_event(
            request.user, "reminder.dismissed",
            "**Dismissed** Reminder",
            detail=reminder.title,
        )
        return Response(self.get_serializer(reminder).data)

    @action(detail=True, methods=["post"])
    def snooze(self, request, pk=None):
        reminder = self.get_object()
        reminder.status = "snoozed"
        reminder.save(update_fields=["status", "updated_at"])
        publish_activity_event(
            request.user, "reminder.snoozed",
            "**Snoozed** Reminder",
            detail=reminder.title,
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

    def get_queryset(self):
        # Notes are scoped to the calendar event's owner (mirroring CalendarEventViewSet).
        # Staff bypass, so admins can still audit any thread.
        # PATCH/DELETE are additionally scoped to the note's author via check_object_permissions.
        qs = MeetingNote.objects.select_related("author", "event")
        user = self.request.user
        if not (getattr(user, "is_staff", False)):
            qs = qs.filter(event__owner=user)
        event_id = self.request.query_params.get("event")
        if event_id:
            qs = qs.filter(event_id=event_id)
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
