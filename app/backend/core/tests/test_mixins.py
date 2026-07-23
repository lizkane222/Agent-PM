"""Tests for core.mixins: _staff_sees_all helper and the two permission mixins."""

from unittest.mock import MagicMock, PropertyMock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.exceptions import PermissionDenied

from accounts.models import Account
from core.mixins import (
    RequireAccountMembershipMixin,
    RequireCalendarEventOwnershipMixin,
    _staff_sees_all,
)
from scheduler.models import CalendarEvent
from team.models import TeamMember, UserProfile

User = get_user_model()


# ── _staff_sees_all ──────────────────────────────────────────────────────────

class StaffSeesAllTest(TestCase):

    def _make_user(self, is_staff=False, with_profile=True, override=True):
        user = User.objects.create_user(
            username=f"user_{User.objects.count()}",
            email=f"user{User.objects.count()}@example.com",
            password="x",
            is_staff=is_staff,
        )
        if with_profile:
            UserProfile.objects.create(user=user, staff_view_override=override)
        return user

    def test_staff_with_override_true_returns_true(self):
        user = self._make_user(is_staff=True, override=True)
        self.assertTrue(_staff_sees_all(user))

    def test_staff_with_override_false_returns_false(self):
        user = self._make_user(is_staff=True, override=False)
        self.assertFalse(_staff_sees_all(user))

    def test_non_staff_returns_false(self):
        user = self._make_user(is_staff=False)
        self.assertFalse(_staff_sees_all(user))

    def test_staff_without_profile_returns_true(self):
        # When there is no profile object, staff sees all by default.
        user = self._make_user(is_staff=True, with_profile=False)
        self.assertTrue(_staff_sees_all(user))


# ── RequireAccountMembershipMixin ────────────────────────────────────────────

def _build_viewset_with_user(user):
    """Return a minimal fake viewset that satisfies the mixin's self.request.user lookup."""
    request = MagicMock()
    request.user = user
    viewset = MagicMock()
    viewset.request = request
    viewset.perform_create = lambda serializer: None
    viewset.perform_update = lambda serializer: None
    return viewset


class RequireAccountMembershipMixinTest(TestCase):

    def setUp(self):
        # Create two ordinary users and one staff user
        self.staff = User.objects.create_user(
            username="staff", email="staff@example.com", password="x", is_staff=True
        )
        UserProfile.objects.create(user=self.staff, staff_view_override=True)

        self.member_user = User.objects.create_user(
            username="member", email="member@example.com", password="x"
        )
        self.other_user = User.objects.create_user(
            username="other", email="other@example.com", password="x"
        )

        # Create an account and add member_user via TeamMember
        self.account = Account.objects.create(company_name="Acme Inc")
        self.team_member = TeamMember.objects.create(
            user=self.member_user, full_name="Member User", email="member@example.com"
        )
        self.account.team_members.add(self.team_member)

    def _make_serializer(self, account):
        serializer = MagicMock()
        serializer.validated_data = {"account": account}
        serializer.instance = None
        return serializer

    def _call_perform_create(self, user, account):
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = user
        mixin.request = request
        mixin.perform_create = super(RequireAccountMembershipMixin, mixin).perform_create \
            if hasattr(super(RequireAccountMembershipMixin, mixin), "perform_create") \
            else lambda s: None
        serializer = self._make_serializer(account)
        # Call the mixin's perform_create — it should raise or not
        mixin.perform_create(serializer)

    def test_member_user_can_attach_to_their_account(self):
        """User who is a team member on the account passes the check."""
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = self.member_user
        mixin.request = request
        # Should not raise
        mixin._check_account_membership(self.account)

    def test_non_member_cannot_attach(self):
        """User with no team membership on the account raises PermissionDenied."""
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = self.other_user
        mixin.request = request
        with self.assertRaises(PermissionDenied):
            mixin._check_account_membership(self.account)

    def test_staff_user_bypasses_membership_check(self):
        """Staff users with staff_view_override=True skip the membership check."""
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = self.staff
        mixin.request = request
        # Should not raise
        mixin._check_account_membership(self.account)

    def test_null_account_is_allowed(self):
        """When no account is attached, the check passes (serializer validation handles it)."""
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = self.other_user
        mixin.request = request
        # Should not raise
        mixin._check_account_membership(None)

    def test_admin_owner_can_attach(self):
        """The admin_owner of an account can attach records to it."""
        admin_user = User.objects.create_user(
            username="adminown", email="adminown@example.com", password="x"
        )
        account = Account.objects.create(company_name="Admin Account", admin_owner=admin_user)
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = admin_user
        mixin.request = request
        # Should not raise
        mixin._check_account_membership(account)

    def test_perform_create_calls_check_and_super(self):
        """perform_create invokes the membership check before calling super."""
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = self.other_user
        mixin.request = request
        serializer = self._make_serializer(self.account)
        # super().perform_create is a MagicMock so it won't raise;
        # but the mixin check for other_user should raise before reaching super.
        with self.assertRaises(PermissionDenied):
            mixin.perform_create(serializer)

    def test_perform_update_calls_check_and_super(self):
        """perform_update invokes the membership check before calling super."""
        mixin = RequireAccountMembershipMixin()
        request = MagicMock()
        request.user = self.other_user
        mixin.request = request
        serializer = self._make_serializer(self.account)
        with self.assertRaises(PermissionDenied):
            mixin.perform_update(serializer)


# ── RequireCalendarEventOwnershipMixin ───────────────────────────────────────

class RequireCalendarEventOwnershipMixinTest(TestCase):

    def setUp(self):
        self.staff = User.objects.create_user(
            username="staff2", email="staff2@example.com", password="x", is_staff=True
        )
        UserProfile.objects.create(user=self.staff, staff_view_override=True)

        self.owner_user = User.objects.create_user(
            username="evowner", email="evowner@example.com", password="x"
        )
        self.account_member_user = User.objects.create_user(
            username="acctmember", email="acctmember@example.com", password="x"
        )
        self.unrelated_user = User.objects.create_user(
            username="unrelated", email="unrelated@example.com", password="x"
        )

        self.account = Account.objects.create(company_name="Event Co")
        self.account_team_member = TeamMember.objects.create(
            user=self.account_member_user,
            full_name="Account Member",
            email="acctmember@example.com",
        )
        self.account.team_members.add(self.account_team_member)

        self.event = CalendarEvent.objects.create(
            owner=self.owner_user,
            account=self.account,
            title="Planning Meeting",
            start_datetime="2026-08-01T09:00:00Z",
            end_datetime="2026-08-01T10:00:00Z",
        )

    def _mixin_for(self, user):
        mixin = RequireCalendarEventOwnershipMixin()
        request = MagicMock()
        request.user = user
        mixin.request = request
        return mixin

    def test_event_owner_is_allowed(self):
        mixin = self._mixin_for(self.owner_user)
        # Should not raise
        mixin._check_event_ownership(self.event)

    def test_account_team_member_is_allowed(self):
        mixin = self._mixin_for(self.account_member_user)
        mixin._check_event_ownership(self.event)

    def test_unrelated_user_is_denied(self):
        mixin = self._mixin_for(self.unrelated_user)
        with self.assertRaises(PermissionDenied):
            mixin._check_event_ownership(self.event)

    def test_staff_bypasses_event_ownership_check(self):
        mixin = self._mixin_for(self.staff)
        mixin._check_event_ownership(self.event)

    def test_null_event_is_allowed(self):
        mixin = self._mixin_for(self.unrelated_user)
        mixin._check_event_ownership(None)

    def test_perform_create_checks_ownership(self):
        mixin = self._mixin_for(self.unrelated_user)
        serializer = MagicMock()
        serializer.validated_data = {"event": self.event}
        serializer.instance = None
        with self.assertRaises(PermissionDenied):
            mixin.perform_create(serializer)

    def test_perform_update_checks_ownership(self):
        mixin = self._mixin_for(self.unrelated_user)
        serializer = MagicMock()
        serializer.validated_data = {"event": self.event}
        serializer.instance = None
        with self.assertRaises(PermissionDenied):
            mixin.perform_update(serializer)
