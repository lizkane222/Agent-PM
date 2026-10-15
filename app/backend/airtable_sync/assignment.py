"""Who an action item may be assigned to.

The assignee value is either an Airtable collaborator id (`usr…`) or — what every in-app
picker sends — a TeamMember pk as a string. Rule:

* PM and Admin: anyone.
* Basic: themselves, or any TeamMember on the item's account, provided the caller is on
  that account too. An item with no account can only be self-assigned.

Applied on both write paths (the viewset serializer and the /fields/ endpoint), which used
to disagree: one allowed only yourself, the other allowed anyone with no check at all.
"""

from __future__ import annotations

from core.mixins import is_pm_or_above


def _resolve_member(value: str):
    from team.models import TeamMember, UserProfile

    if value.isdigit():
        return TeamMember.objects.filter(pk=int(value)).select_related("user").first()
    profile = UserProfile.objects.filter(airtable_collaborator_id=value).select_related("user").first()
    if profile is None:
        return None
    return TeamMember.objects.filter(user=profile.user).first()


def _is_self(user, value: str, member) -> bool:
    collab = getattr(getattr(user, "profile", None), "airtable_collaborator_id", "") or ""
    if collab and value == collab:
        return True
    return member is not None and member.user_id == getattr(user, "pk", None)


def _app_account_for(airtable_account):
    if airtable_account is None or not airtable_account.name:
        return None
    from accounts.models import Account

    return Account.objects.filter(company_name__iexact=airtable_account.name).first()


def can_assign(user, airtable_account, value) -> bool:
    if not value:
        return True  # clearing the assignee is always allowed
    value = str(value)
    if is_pm_or_above(user):
        return True
    member = _resolve_member(value)
    if _is_self(user, value, member):
        return True
    account = _app_account_for(airtable_account)
    if account is None or member is None:
        return False
    on_account = account.team_members.filter(user=user).exists() or account.admin_owner_id == user.pk
    return on_account and account.team_members.filter(pk=member.pk).exists()


ASSIGN_DENIED = "You can only assign action items to yourself or to teammates on this item's account."
