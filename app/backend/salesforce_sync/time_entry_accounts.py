"""
Work out which app account a logged time entry belongs to.

Two situations need this:

* **At log time** (`account_for_project_sf_id`). The Log Time panel sends a Cloud Coach project id.
  That id maps to an account through the app's own `AccountProject.sf_project_id` (or, when the
  project has been synced, through `SalesforceProject.account`). This is authoritative.
* **For entries logged before the account was recorded** (`infer_account`). All that survives is a
  date, minutes and a description such as "Siemens Email (15m)". The inference is deliberately
  conservative — it only answers when exactly one account fits — and is only used by the explicit
  `backfill_time_entry_accounts` command, never silently on a read.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from django.db.models import Q


def account_for_project_sf_id(project_sf_id: str):
    """The app `Account` that owns this Cloud Coach project id, or None."""
    from accounts.models import Account, AccountProject

    sf_id = (project_sf_id or "").strip()
    if not sf_id:
        return None
    project = AccountProject.objects.filter(sf_project_id=sf_id).select_related("account").first()
    if project and project.account_id:
        return project.account

    from .models import SalesforceProject

    synced = SalesforceProject.objects.filter(sf_id=sf_id).select_related("account").first()
    if synced and synced.account_id:
        return Account.objects.filter(company_name__iexact=synced.account.name).first()
    return None


def entry_title(description: str) -> str:
    """The title line of a logged description: "Siemens Email (15m)\\nTotal: …" -> "Siemens Email"."""
    first = (description or "").split("\n", 1)[0]
    return re.sub(r"\s*\([^)]*\)\s*$", "", first).strip()


def _user_accounts(user):
    """Accounts the user is on. Inference never reaches an account they cannot see."""
    from accounts.models import Account

    return Account.objects.filter(
        Q(team_members__user=user) | Q(admin_owner=user)
    ).distinct()


def account_matcher(user):
    """
    A function `text -> Account | None` naming the single one of the user's accounts that appears in
    `text` as a whole word. The account list is read once, so matching many events costs one query.
    """
    candidates = [
        (acct, re.compile(rf"(?<![A-Za-z0-9]){re.escape(acct.company_name.strip())}(?![A-Za-z0-9])", re.IGNORECASE))
        for acct in _user_accounts(user)
        # "Admin" is every user's personal workspace; matching it on a word like "admin" would file
        # ordinary work there. Very short names match too much.
        if len((acct.company_name or "").strip()) >= 3 and not acct.is_admin_account
    ]

    def match(text: str):
        hits = [acct for acct, rx in candidates if rx.search(text or "")]
        return hits[0] if len(hits) == 1 else None

    return match


def _mentioned_account(user, text: str):
    """The single user account whose name appears in `text` as a whole word, else None."""
    return account_matcher(user)(text)


def _aliased_account(user, text: str, aliases: dict[str, str] | None):
    """An account the caller named explicitly: `{"schnucks": "Festival Foods & Schnucks"}`."""
    if not aliases:
        return None
    mine = {a.company_name.lower(): a for a in _user_accounts(user)}
    hits = {
        mine[target.lower()].pk: mine[target.lower()]
        for phrase, target in aliases.items()
        if phrase and target.lower() in mine
        and re.search(rf"(?<![A-Za-z0-9]){re.escape(phrase)}(?![A-Za-z0-9])", text, re.IGNORECASE)
    }
    return next(iter(hits.values())) if len(hits) == 1 else None


def infer_account(user, entry_date: date, description: str, aliases: dict[str, str] | None = None):
    """
    Best account for an old entry, or None when it is ambiguous or unknowable. In order:
    1. a calendar event the user owns, same title, within a day, that has an account;
    2. an action item with the same task title that has an account;
    3. a phrase the caller explicitly mapped to one of the user's accounts (`aliases`);
    4. exactly one of the user's accounts named in the description.

    There is deliberately no loose word matching: "Segment" is a word in an account called
    "Segment Data Deletion" and in many meeting titles, so it would file ordinary work there.
    """
    from accounts.models import Account
    from airtable_sync.models import AirtableActionItem
    from scheduler.models import CalendarEvent

    title = entry_title(description)
    if title:
        lo, hi = entry_date - timedelta(days=1), entry_date + timedelta(days=1)
        event = (
            CalendarEvent.objects
            .filter(owner=user, title__iexact=title, account__isnull=False,
                    start_datetime__date__gte=lo, start_datetime__date__lte=hi)
            .select_related("account").first()
        )
        if event:
            return event.account

        item = (
            AirtableActionItem.objects
            .filter(task__iexact=title, account__isnull=False).select_related("account").first()
        )
        if item:
            acct = Account.objects.filter(company_name__iexact=item.account.name).first()
            if acct:
                return acct

    return _aliased_account(user, description or "", aliases) or _mentioned_account(user, description or "")


def entry_account_name(entry) -> str:
    """The account an entry is for: the one recorded at log time, else a synced project's, else ''."""
    if entry.account_id:
        return entry.account.company_name
    project = entry.project
    if project is not None and project.account_id:
        return project.account.name
    return ""
