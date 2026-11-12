"""
What a reminder can be linked to, and what the user is allowed to link it to.

A reminder can link to several records at once, of different types (an account, an action item
and a calendar event, say). Each link is `{"resource_type", "resource_id", "label"}`.

The picker lists, and `normalize_links` accepts, **only records the user can already see in the
app** — never the whole table:

* account        — accounts the user is on (or owns), or all of them for an Admin with the staff view;
* action_item    — what the Action Items page lists for them (everything except other people's
                   private Admin items);
* calendar_event — the user's own calendar, meetings only (not reminder or work-tracking blocks);
* task           — tasks assigned to the user.

Labels are always read from the database, never trusted from the client, so a link cannot be
made to display text the record does not have.

`resource_type` / `resource_id` / `resource_label` on the reminder stay as the **primary** link
(the account if there is one, else the first) so everything that predates multiple links —
the recipients rules, snooze-before-meeting, the activity log — keeps working unchanged.
"""

from __future__ import annotations

from django.db.models import Q
from rest_framework import serializers

LINK_TYPES = ("account", "action_item", "calendar_event", "task")
MAX_LINKS = 10
RESULT_LIMIT = 25


def visible_queryset(user, link_type: str):
    """Every record of `link_type` the user may link to."""
    from core.mixins import _staff_sees_all

    if link_type == "account":
        from accounts.models import Account

        if _staff_sees_all(user):
            return Account.objects.all()
        return Account.objects.filter(Q(team_members__user=user) | Q(admin_owner=user)).distinct()

    if link_type == "action_item":
        from airtable_sync.models import AirtableActionItem
        from airtable_sync.views import _exclude_private_admin_items

        return _exclude_private_admin_items(AirtableActionItem.objects.select_related("account"), user)

    if link_type == "calendar_event":
        from .models import CalendarEvent

        return CalendarEvent.objects.filter(owner=user).exclude(calendar_id__in=("reminders", "work_tracking"))

    if link_type == "task":
        from .models import Task

        return Task.objects.filter(assigned_to=user)

    raise ValueError(f"Unknown link type {link_type!r}")


def _label(link_type: str, obj) -> str:
    if link_type == "account":
        return obj.company_name or "Untitled account"
    if link_type == "action_item":
        return obj.task or "Untitled action item"
    return getattr(obj, "title", "") or f"Untitled {link_type.replace('_', ' ')}"


def _detail(link_type: str, obj) -> str:
    if link_type == "action_item":
        bits = [getattr(obj.account, "name", "") if obj.account_id else "", obj.status or ""]
        return " · ".join(b for b in bits if b)
    if link_type == "task":
        return getattr(obj, "status", "") or ""
    return ""


def search(user, link_type: str, term: str = "", limit: int = RESULT_LIMIT) -> list[dict]:
    """Up to `limit` visible records of the type, filtered by `term`, as picker options."""
    qs = visible_queryset(user, link_type)
    term = (term or "").strip()
    field = {"account": "company_name", "action_item": "task"}.get(link_type, "title")
    if term:
        qs = qs.filter(**{f"{field}__icontains": term})
    order = {
        "account": ("company_name",),
        "action_item": ("-updated_at",) if hasattr(qs.model, "updated_at") else ("-pk",),
        "calendar_event": ("-start_datetime",),
        "task": ("-pk",),
    }[link_type]
    out = []
    for obj in qs.order_by(*order)[:limit]:
        row = {"id": obj.pk, "label": _label(link_type, obj), "detail": _detail(link_type, obj)}
        if link_type == "calendar_event":
            row["at"] = obj.start_datetime.isoformat()
        out.append(row)
    return out


def normalize_links(user, raw) -> list[dict]:
    """Validate a client's `links` and return clean ones with labels from the database.

    Raises a `ValidationError` for an unknown type, a missing id, too many links, or a record
    the user cannot see. Duplicates collapse; order is kept.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise serializers.ValidationError({"links": "Links must be a list."})
    if len(raw) > MAX_LINKS:
        raise serializers.ValidationError({"links": f"A reminder can link to at most {MAX_LINKS} records."})

    clean: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise serializers.ValidationError({"links": "Each link must be an object."})
        link_type = item.get("resource_type")
        if link_type not in LINK_TYPES:
            raise serializers.ValidationError({"links": f"Can't link to a {link_type!r}."})
        try:
            pk = int(item.get("resource_id"))
        except (TypeError, ValueError):
            raise serializers.ValidationError({"links": "Each link needs a record."})
        if (link_type, pk) in seen:
            continue
        obj = visible_queryset(user, link_type).filter(pk=pk).first()
        if obj is None:
            # Same answer for "doesn't exist" and "isn't yours": don't reveal which.
            raise serializers.ValidationError({"links": "You can only link to records you have access to."})
        seen.add((link_type, pk))
        clean.append({"resource_type": link_type, "resource_id": pk, "resource_label": _label(link_type, obj)[:300]})
    return clean


def primary(links: list[dict]) -> dict | None:
    """The link the legacy single-resource fields mirror: the account if any, else the first."""
    for link in links:
        if link["resource_type"] == "account":
            return link
    return links[0] if links else None


def all_links(reminder) -> list[dict]:
    """The reminder's links, falling back to its primary fields for rows that predate `links`."""
    links = list(reminder.links or [])
    if links:
        return links
    if reminder.resource_type not in ("", "general") and reminder.resource_id:
        return [{"resource_type": reminder.resource_type, "resource_id": reminder.resource_id,
                 "resource_label": reminder.resource_label}]
    return []


def linked_account(reminder):
    """The Account a reminder belongs to: an account link, else the account of a linked meeting
    or action item. None when it has none."""
    from team.notifications import account_for_resource

    links = all_links(reminder)
    ordered = sorted(links, key=lambda l: 0 if l["resource_type"] == "account" else 1)
    for link in ordered:
        account = account_for_resource(link["resource_type"], link["resource_id"])
        if account is not None:
            return account
    return None


def reachable_accounts(links: list[dict], user) -> list:
    """Accounts the user is on that these links lead to, without duplicates.

    An account link is itself one; an action item or a meeting leads to the account it is
    filed under. This is what decides whose teammates can be notified, so a reminder about
    "Draft QBR deck" (an Acme action item) can notify the Acme team without also linking Acme.
    Accounts the user is not on are dropped: they cannot be used to reach someone.
    """
    from accounts.access import is_account_member  # lazy: accounts imports scheduler
    from team.notifications import account_for_resource

    found: dict[int, object] = {}
    for link in links:
        account = account_for_resource(link["resource_type"], link["resource_id"])
        if account is not None and account.pk not in found and is_account_member(user, account):
            found[account.pk] = account
    return list(found.values())


def is_private_admin_link(link: dict) -> bool:
    """True for a link into the user's own Admin workspace.

    Every user has an Admin account (`is_admin_account`) that cannot be shared, and action
    items filed under the shared Airtable "Admin" account are private to their assignee. There is
    no team behind either, so a reminder about one has no account team to pick teammates from.
    """
    from accounts.models import ADMIN_ACCOUNT_NAME

    kind, pk = link["resource_type"], link["resource_id"]
    try:
        if kind == "account":
            from accounts.models import Account

            return Account.objects.filter(pk=pk, is_admin_account=True).exists()
        if kind == "action_item":
            from airtable_sync.models import AirtableActionItem

            item = AirtableActionItem.objects.select_related("account").filter(pk=pk).first()
            return bool(item and item.account_id and (item.account.name or "").strip().lower() == ADMIN_ACCOUNT_NAME.lower())
        if kind == "calendar_event":
            from .models import CalendarEvent

            return CalendarEvent.objects.filter(pk=pk, account__is_admin_account=True).exists()
    except Exception:
        return False
    return False


def has_private_admin_link(links: list[dict]) -> bool:
    return any(is_private_admin_link(l) for l in links)
