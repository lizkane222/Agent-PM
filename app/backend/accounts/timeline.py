"""Server-side data for the Account Detail Timeline (``GET /accounts/accounts/<id>/timeline/``).

Two scopes:

* ``mine`` -- the requester's own calendar events for the account.
* ``team`` -- every account team member's events for the account (plus the requester's),
  one row per real-world meeting.

How an event belongs to an account: ``CalendarEventAccountLink`` (keyed by
``google_event_id``, the account-matching cache -- this is what the calendar page and the
meeting-notes importer use) **or** the plain ``CalendarEvent.account`` FK. Both are honoured.

Meeting notes hang off ``AirtableMeeting``. An event reaches its meeting through
``CalendarEvent.agentpm_airtable_id == AirtableMeeting.airtable_id``. The importer
(``airtable_sync.meeting_stubs``) writes that link onto the event of whoever's Gmail it
scanned, and files the meeting under the account the event resolved to -- which is often
none. So the timeline resolves meetings *from the events* rather than only by
``AirtableMeeting.account``, and a teammate whose own copy of the same Google event has no
link borrows the link from a sibling copy.

What a teammate's event reveals: title, times, status, category, attendee names/emails
and responses, the account, who owns it, and the notes link. It does NOT reveal
``description``, ``location``, ``meet_link``, ``attended``, invitation bookkeeping, or the
reminder/project/reference links. The requester's own events are returned in full.
"""

from __future__ import annotations

from scheduler.models import CalendarEvent
from scheduler.serializers import CalendarEventSerializer

# Fields blanked on an event owned by somebody else.
_PRIVATE_FIELDS = {
    "description": "",
    "location": "",
    "meet_link": "",
    "attended": None,
    "reminder": None,
    "project": None,
    "project_name": None,
    "references": [],
    "artifact_ids": [],
}


def _account_event_queryset(account):
    from airtable_sync.models import AirtableAccount, CalendarEventAccountLink
    from django.db.models import Q

    q = Q(account=account)
    if account.airtable_id:
        at_acct = AirtableAccount.objects.filter(airtable_id=account.airtable_id).first()
        if at_acct:
            uids = CalendarEventAccountLink.objects.filter(account=at_acct).values_list(
                "calendar_event_uid", flat=True
            )
            q |= Q(google_event_id__in=list(uids)) & ~Q(google_event_id="")
    return CalendarEvent.objects.filter(q)


def _dedupe_key(ev) -> str:
    if ev.google_event_id:
        return f"g:{ev.google_event_id}"
    return f"t:{(ev.title or '').strip().lower()}|{ev.start_datetime.isoformat()}"


def build_timeline(account, user, scope: str) -> dict:
    from airtable_sync.models import AirtableAccount, AirtableMeeting
    from airtable_sync.serializers import AirtableMeetingSerializer

    base = _account_event_queryset(account)
    team_user_ids = set(
        account.team_members.exclude(user__isnull=True).values_list("user_id", flat=True)
    )
    team_user_ids.add(user.pk)

    all_events = list(base.filter(owner_id__in=team_user_ids).select_related("owner", "account"))

    # Notes link per real-world meeting, from ANY copy of the event (userA's import
    # lives on userA's row; userB's row for the same Google event has no link).
    link_by_key: dict[str, str] = {}
    for ev in all_events:
        if ev.agentpm_airtable_id:
            link_by_key.setdefault(_dedupe_key(ev), ev.agentpm_airtable_id)

    if scope == "mine":
        candidates = [e for e in all_events if e.owner_id == user.pk]
    else:
        candidates = all_events

    # One row per meeting; the requester's own copy wins, then a copy that carries the link.
    chosen: dict[str, CalendarEvent] = {}
    for ev in sorted(
        candidates,
        key=lambda e: (e.owner_id != user.pk, not e.agentpm_airtable_id, e.pk),
    ):
        chosen.setdefault(_dedupe_key(ev), ev)

    events_out = []
    for key, ev in sorted(chosen.items(), key=lambda kv: kv[1].start_datetime):
        data = dict(CalendarEventSerializer(ev).data)
        if ev.owner_id != user.pk:
            data.update(_PRIVATE_FIELDS)
        data["agentpm_airtable_id"] = ev.agentpm_airtable_id or link_by_key.get(key, "")
        events_out.append(data)

    linked_ids = {e["agentpm_airtable_id"] for e in events_out if e["agentpm_airtable_id"]}
    meetings_qs = AirtableMeeting.objects.select_related("account")
    from django.db.models import Q

    mq = Q(airtable_id__in=linked_ids)
    if account.airtable_id:
        at_acct = AirtableAccount.objects.filter(airtable_id=account.airtable_id).first()
        if at_acct:
            mq |= Q(account=at_acct)
    elif account.company_name:
        mq |= Q(account__name__iexact=account.company_name)
    meetings_out = AirtableMeetingSerializer(meetings_qs.filter(mq).order_by("-date"), many=True).data

    return {"scope": scope, "events": events_out, "meetings": list(meetings_out)}
