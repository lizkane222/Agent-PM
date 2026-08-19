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

from .models import AirtableAccount, AirtableMeeting

logger = logging.getLogger(__name__)


def find_meeting_for_event(event) -> AirtableMeeting | None:
    """Return the AirtableMeeting linked to `event`, without creating one."""
    if not event.agentpm_airtable_id:
        return None
    return AirtableMeeting.objects.filter(airtable_id=event.agentpm_airtable_id).first()


def _airtable_account_for_event(event) -> AirtableAccount | None:
    """Resolve the event's Django Account to its AirtableAccount, if it has one.

    Returns None for events with no account, or whose account was never linked to
    Airtable (per-user Admin workspaces) — a meeting with no account is still a valid
    place to hang notes.
    """
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
