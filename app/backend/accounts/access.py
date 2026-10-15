"""Who may change an account, and the audit trail for every field change.

Rules (team.UserProfile.access_level, via core.mixins):

* Account **fields** (name, website, industry, status, ARR, owner, primary contact): any
  member of the account may edit them, at any level. Every value that is set, changed or
  cleared is written to the Activity Log with its before/after value (`log_field_changes`),
  so the history of those fields survives the edit.
* Account **membership** (who is on the account): PM and Admin may add or remove anyone;
  Basic may add or remove only themselves (`assert_can_change_members`). Same rule for
  per-project membership.
* Deleting an account stays with its owner / creator / admin_owner, or PM and above.
"""

from __future__ import annotations

from decimal import Decimal

from rest_framework.exceptions import PermissionDenied

from core.mixins import _staff_sees_all, is_pm_or_above

# Fields recorded in the field-history log, with a human label.
AUDITED_FIELDS = {
    "company_name": "Name",
    "website": "Website",
    "industry": "Industry",
    "status": "Status",
    "arr": "ARR",
    "owner": "Owner",
    "primary_contact": "Primary contact",
}


def is_account_member(user, account) -> bool:
    if account is None:
        return False
    if _staff_sees_all(user) or account.admin_owner_id == getattr(user, "pk", None):
        return True
    return account.team_members.filter(user=user).exists()


def assert_can_edit_fields(user, account) -> None:
    if not is_account_member(user, account):
        raise PermissionDenied("Only members of this account can edit it.")


def assert_can_delete(user, account) -> None:
    uid = getattr(user, "pk", None)
    if is_pm_or_above(user) or uid in (account.owner_id, account.admin_owner_id, account.created_by_id):
        return
    raise PermissionDenied("Only the account owner or a PM can delete this account.")


def assert_can_change_members(user, added_ids, removed_ids) -> None:
    """Basic users may only add/remove their own TeamMember; PM and Admin anyone."""
    if is_pm_or_above(user):
        return
    from team.models import TeamMember

    own = set(TeamMember.objects.filter(user=user).values_list("pk", flat=True))
    others = (set(added_ids) | set(removed_ids)) - own
    if others:
        raise PermissionDenied("Only PMs and Admins can add or remove other people on an account.")


def _display(field: str, value) -> str:
    if value is None or value == "":
        return ""
    if field == "owner":
        return getattr(value, "username", "") or str(value)
    if field == "primary_contact":
        return getattr(value, "full_name", "") or str(value)
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    return str(value)


def snapshot(account) -> dict[str, str]:
    return {f: _display(f, getattr(account, f, None)) for f in AUDITED_FIELDS}


def log_field_changes(user, account, before: dict[str, str], after: dict[str, str]) -> list[dict]:
    """One Activity Log event per changed field, carrying the old and new values.

    `action` is "set" (was empty), "updated", or "cleared" (now empty). Tagged with the
    account as its resource so the shared for-resource feed shows teammates' edits.
    """
    from realtime.sync import publish_activity_event

    changes = []
    for field, label in AUDITED_FIELDS.items():
        old, new = before.get(field, ""), after.get(field, "")
        if old == new:
            continue
        action = "set" if not old else "cleared" if not new else "updated"
        change = {"field": field, "label": label, "action": action, "from": old, "to": new}
        changes.append(change)
        verb = {"set": "set to", "updated": "changed to", "cleared": "cleared (was"}[action]
        tail = f'"{new}"' if action != "cleared" else f'"{old}")'
        publish_activity_event(
            user,
            "account.field_changed",
            f"**{label}** {verb} {tail}",
            detail=account.company_name,
            metadata={
                **change,
                "account_id": account.pk,
                "resource": {"type": "account", "id": str(account.pk)},
            },
        )
    return changes
