"""
Reusable DRF permission classes for account-scoped RBAC.

Role hierarchy (highest → lowest):
  staff (is_staff + staff_view_override) — sees everything, all accounts
  account_owner — can review feed, approve/reject delete requests on assigned accounts
  sync_reviewer — can add to feed, request deletions on assigned accounts
"""

from rest_framework.permissions import BasePermission

from core.mixins import _staff_sees_all


def _account_from_obj(obj):
    """Extract the Account instance from an object that has a direct or nested FK."""
    from accounts.models import Account
    if isinstance(obj, Account):
        return obj
    return getattr(obj, "account", None)


class IsAccountSyncReviewer(BasePermission):
    """
    List-level: authenticated.
    Object-level: staff OR user has sync_reviewer / account_owner role on the object's account.
    """

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        user = request.user
        if _staff_sees_all(user):
            return True
        account = _account_from_obj(obj)
        if account is None:
            return False
        from accounts.models import AccountRole
        return AccountRole.objects.filter(
            user=user,
            account=account,
            role__in=["sync_reviewer", "account_owner"],
        ).exists()


class IsAccountOwner(BasePermission):
    """
    Object-level: staff OR user has account_owner role on the object's account.
    Used for destructive operations (approve delete requests, remove feed links).
    """

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        user = request.user
        if _staff_sees_all(user):
            return True
        account = _account_from_obj(obj)
        if account is None:
            return False
        from accounts.models import AccountRole
        return AccountRole.objects.filter(
            user=user,
            account=account,
            role="account_owner",
        ).exists()


class CanAssignAccountRole(BasePermission):
    """Only staff can assign or revoke AccountRole records."""

    def has_permission(self, request, view):
        return _staff_sees_all(request.user)
