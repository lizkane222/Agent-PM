"""Resolve a CalendarEvent to the AirtableMeeting that carries its notes.

Meeting notes hang off `AirtableMeeting`, but plenty of real meetings only exist as a
Google Calendar event — nothing mirrors them into Airtable until someone saves notes
against them. The manual paste path has always created a `local-*` stub on demand for
exactly that reason; this module is that logic, extracted so the recap-email scanner
creates stubs the same way instead of silently having nowhere to put a summary.
"""

from __future__ import annotations

import logging
import uuid

from .models import AirtableAccount, AirtableMeeting, CalendarEventAccountLink

logger = logging.getLogger(__name__)


def find_meeting_for_event(event) -> AirtableMeeting | None:
    """Return the AirtableMeeting linked to `event`, without creating one."""
    if not event.agentpm_airtable_id:
        return None
    return AirtableMeeting.objects.filter(airtable_id=event.agentpm_airtable_id).first()


def _airtable_account_for_event(event) -> AirtableAccount | None:
    """Resolve the AirtableAccount that notes for `event` should be filed under.

    Prefers `CalendarEventAccountLink` — the account-matching cache that drives the
    account name shown on the calendar page's own meeting panel (see
    `matching.match_event_to_account` / `set_manual_categorization`) — because that is
    the account the user actually sees the meeting linked to. `CalendarEvent.account`
    (a plain Django FK) is checked as a fallback for callers that do set it, but nothing
    in this codebase's sync or UI paths ever populates it, so relying on it alone left
    every calendar-page-created stub meeting with no account at all. Returns None for
    events that resolve to no account, or to an account never linked to Airtable
    (per-user Admin workspaces) — a meeting with no account is still a valid place to
    hang notes.
    """
    event_uid = event.google_event_id or str(event.pk)
    link = (
        CalendarEventAccountLink.objects.filter(calendar_event_uid=event_uid)
        .select_related("account")
        .first()
    )
    if link and link.account_id:
        return link.account

    if not event.account_id:
        return None
    try:
        from accounts.models import Account as DjangoAccount

        django_acct = DjangoAccount.objects.get(pk=event.account_id)
    except Exception:
        return None
    if not django_acct.airtable_id:
        return None
    return AirtableAccount.objects.filter(airtable_id=django_acct.airtable_id).first()


def get_or_create_meeting_for_event(event) -> AirtableMeeting:
    """Return the AirtableMeeting for `event`, creating a local stub if there is none.

    The stub's `airtable_id` is `local-<event pk>-<random>`; `push_meeting_gong_notes`
    promotes it to a real Airtable record on the next write-through, and the event is
    linked back immediately so the following call resolves without another stub.
    """
    meeting = find_meeting_for_event(event)
    if meeting:
        # A stub created before the account-link fallback existed (or before the user
        # picked/confirmed an account) can be sitting with no account attached even
        # though the event now resolves to one — re-resolve and backfill so the meeting
        # starts showing up in account-scoped fetches (e.g. the Account Detail page).
        if meeting.account_id is None:
            account = _airtable_account_for_event(event)
            if account is not None:
                meeting.account = account
                meeting.save(update_fields=["account"])
        return meeting

    stub_id = f"local-{event.pk}-{uuid.uuid4().hex[:8]}"
    meeting = AirtableMeeting.objects.create(
        airtable_id=stub_id,
        account=_airtable_account_for_event(event),
        name=event.title or "",
        date=event.start_datetime,
    )
    event.agentpm_airtable_id = stub_id
    event.save(update_fields=["agentpm_airtable_id"])
    logger.info(
        "Created stub meeting %s for calendar event %s (%r)", stub_id, event.pk, event.title
    )
    return meeting
