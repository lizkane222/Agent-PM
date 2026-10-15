"""
Shared DRF mixins used across multiple apps.

Import from here to avoid duplicating security-critical code.
"""

import logging

from django.conf import settings
from django.http import HttpResponse
from twilio.request_validator import RequestValidator

logger = logging.getLogger(__name__)


ACCESS_RANK = {"basic": 1, "pm": 2, "admin": 3}


def access_level(user) -> str:
    """The user's tier: "basic" | "pm" | "admin" (team.UserProfile.access_level).

    Profiles are created lazily, so a user without one falls back to their Django flag —
    is_staff → admin, else basic. Anonymous users are always basic.
    """
    if not getattr(user, "is_authenticated", False):
        return "basic"
    try:
        profile = user.profile
    except Exception:  # RelatedObjectDoesNotExist
        profile = None
    level = getattr(profile, "access_level", None)
    if level in ACCESS_RANK:
        return level
    return "admin" if getattr(user, "is_staff", False) else "basic"


def is_admin(user) -> bool:
    return access_level(user) == "admin"


def is_pm_or_above(user) -> bool:
    return ACCESS_RANK[access_level(user)] >= ACCESS_RANK["pm"]


def admin_wants_all(request) -> bool:
    """`?scope=all` from an Admin: the Admin Data page's unscoped view of a shared table.

    Deliberately opt-in per request (not `_staff_sees_all`), so endpoints that also feed
    pickers and @mention lists keep their normal scoping everywhere else.
    """
    return request.query_params.get("scope") == "all" and is_admin(request.user)


def _staff_sees_all(user) -> bool:
    """True when the user sees all records: an Admin with the staff data view enabled.

    Import from here — this is the single canonical implementation. Do NOT re-define
    this helper in individual app views; use `from core.mixins import _staff_sees_all`.
    """
    if not is_admin(user):
        return False
    profile = getattr(user, "profile", None)
    if profile is None:
        return True
    return profile.staff_view_override


class RequireAccountMembershipMixin:
    """
    ViewSet mixin that validates the caller has team membership on any Account
    FK present in the serializer's validated_data. Applies on create AND update.
    Staff bypass. Null / missing FK is allowed (defer to serializer validation).

    The FK on the model must point at `accounts.Account`. For viewsets whose FK
    points at an intermediate model (e.g. `AirtableAccount`), keep using the
    bespoke per-viewset helper — this mixin resolves membership by primary key.
    """

    account_field_name = "account"  # override in subclass if the FK has a different name

    def _resolve_target_account(self, serializer):
        target = serializer.validated_data.get(self.account_field_name)
        if target is None and serializer.instance is not None:
            target = getattr(serializer.instance, self.account_field_name, None)
        return target

    def _check_account_membership(self, target_account):
        """Raise PermissionDenied unless the caller can attach records to this account."""
        if target_account is None:
            return
        user = self.request.user
        if _staff_sees_all(user):
            return
        from django.db.models import Q
        from accounts.models import Account
        allowed = Account.objects.filter(
            Q(pk=target_account.pk) & (
                Q(team_members__user=user) | Q(admin_owner=user)
            )
        ).exists()
        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You cannot attach records to this account.")

    def perform_create(self, serializer):
        self._check_account_membership(self._resolve_target_account(serializer))
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._check_account_membership(self._resolve_target_account(serializer))
        super().perform_update(serializer)


class RequireCalendarEventOwnershipMixin:
    """
    ViewSet mixin that validates the caller owns any CalendarEvent FK present
    in the serializer's validated_data. Applies on create AND update.
    Staff bypass. Mirrors update_meeting_gong_notes_by_pk (Pass 1 fix): the caller
    must own the event OR belong to the event's linked account's team.
    """

    event_field_name = "event"

    def _resolve_target_event(self, serializer):
        target = serializer.validated_data.get(self.event_field_name)
        if target is None and serializer.instance is not None:
            target = getattr(serializer.instance, self.event_field_name, None)
        return target

    def _check_event_ownership(self, event):
        if event is None:
            return
        user = self.request.user
        if _staff_sees_all(user):
            return
        if getattr(event, "owner_id", None) == getattr(user, "pk", None):
            return
        account_id = getattr(event, "account_id", None)
        if account_id:
            from accounts.models import Account
            if Account.objects.filter(
                pk=account_id, team_members__user=user
            ).exists():
                return
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("You cannot attach records to this calendar event.")

    def perform_create(self, serializer):
        self._check_event_ownership(self._resolve_target_event(serializer))
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._check_event_ownership(self._resolve_target_event(serializer))
        super().perform_update(serializer)


class TwilioSignatureRequiredMixin:
    """
    Validates X-Twilio-Signature on every request. Returns 403 on failure.

    Twilio sends webhooks as application/x-www-form-urlencoded, so the
    signature is computed over request.POST. If the content-type is wrong
    or the body has been consumed, the signature check will fail safely
    (the validator will reject an empty post_data against the real signature).
    """

    def dispatch(self, request, *args, **kwargs):
        if not settings.TWILIO_AUTH_TOKEN:
            logger.error("TWILIO_AUTH_TOKEN not configured — rejecting webhook")
            return HttpResponse("Service Unavailable", status=503)
        validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)
        url = request.build_absolute_uri()
        sig = request.META.get("HTTP_X_TWILIO_SIGNATURE", "")
        post_data = request.POST.dict() if request.method == "POST" else {}
        if not validator.validate(url, post_data, sig):
            logger.warning("Invalid Twilio signature from %s", request.META.get("REMOTE_ADDR"))
            return HttpResponse("Forbidden", status=403)
        return super().dispatch(request, *args, **kwargs)
