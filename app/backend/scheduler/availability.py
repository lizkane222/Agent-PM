"""Compare-calendars: other people's busy time, privacy-masked.

`GET /api/v1/scheduler/availability/?emails=a@x.com,b@x.com&start=…&end=…`

Per person, the source is:

* **An app user** (a `TeamMember` with a linked login) — their `CalendarEvent` rows. Every
  viewer sees *when* they are busy. The title is revealed only for a meeting linked to an
  account both people are on (`Account.team_members`), because that meeting is already
  visible to the viewer through the account page; everything else reads "Busy". Description,
  location, attendees and links are never returned.
* **Anyone else** — Google Calendar free/busy for that address, queried with the *viewer's*
  Google connection. Google itself decides what that viewer may see (free/busy within the
  Workspace domain); it never includes titles.

Cancelled events, "did not attend" events and AgentPM's own work_tracking / reminders
calendars are excluded: they don't block a new meeting.
"""

from __future__ import annotations

import logging
from datetime import datetime

from django.contrib.auth import get_user_model
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.query_params import csv_params

from .models import CalendarEvent

logger = logging.getLogger(__name__)

MAX_PEOPLE = 8
MAX_RANGE_DAYS = 62
NON_BLOCKING_CALENDARS = ("work_tracking", "reminders")
BUSY_LABEL = "Busy"


def _parse_range(request):
    start = parse_datetime(request.query_params.get("start") or "")
    end = parse_datetime(request.query_params.get("end") or "")
    if not start or not end or end <= start:
        return None, None, "start and end (ISO 8601) are required, with end after start."
    if (end - start).days > MAX_RANGE_DAYS:
        return None, None, f"Range may not exceed {MAX_RANGE_DAYS} days."
    return start, end, None


def _shared_account_ids(viewer, other) -> set[int]:
    from accounts.models import Account

    return set(
        Account.objects.filter(team_members__user=viewer)
        .filter(team_members__user=other)
        .values_list("pk", flat=True)
    )


def _app_user_busy(viewer, other, start, end) -> list[dict]:
    shared = _shared_account_ids(viewer, other)
    rows = (
        CalendarEvent.objects
        .filter(owner=other, start_datetime__lt=end, end_datetime__gt=start)
        .exclude(status="cancelled")
        .exclude(attended=False)
        .exclude(calendar_id__in=NON_BLOCKING_CALENDARS)
        .order_by("start_datetime")
        .values("start_datetime", "end_datetime", "all_day", "title", "account_id")
    )
    out = []
    for r in rows:
        visible = r["account_id"] is not None and r["account_id"] in shared
        out.append({
            "start": r["start_datetime"].isoformat(),
            "end": r["end_datetime"].isoformat(),
            "all_day": r["all_day"],
            "title": r["title"] if visible else BUSY_LABEL,
            "title_visible": visible,
        })
    return out


def _google_service_for(viewer):
    from django.conf import settings
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    from integrations.models import OAuthCredential

    cred = OAuthCredential.objects.filter(user=viewer, provider="google", is_active=True).first()
    if cred is None:
        return None
    creds = Credentials(
        token=cred.access_token,
        refresh_token=cred.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=cred.scopes.split(),
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _google_freebusy(viewer, emails: list[str], start: datetime, end: datetime) -> dict[str, dict]:
    """`{email: {"source": ..., "busy": [...], "error": ...}}` via one freebusy.query call."""
    if not emails:
        return {}
    service = _google_service_for(viewer)
    if service is None:
        return {e: {"source": "google", "busy": [], "error": "not_connected"} for e in emails}
    try:
        result = service.freebusy().query(body={
            "timeMin": start.isoformat(),
            "timeMax": end.isoformat(),
            "items": [{"id": e} for e in emails],
        }).execute()
    except Exception:
        logger.exception("Google freebusy query failed for %d address(es)", len(emails))
        return {e: {"source": "google", "busy": [], "error": "google_error"} for e in emails}

    calendars = result.get("calendars", {})
    out = {}
    for email in emails:
        cal = calendars.get(email) or calendars.get(email.lower()) or {}
        errors = cal.get("errors") or []
        out[email] = {
            "source": "google",
            "busy": [
                {"start": b["start"], "end": b["end"], "all_day": False, "title": BUSY_LABEL, "title_visible": False}
                for b in cal.get("busy", [])
            ],
            # e.g. "notFound" for an address outside the domain, "groupTooBig" for a list.
            "error": errors[0].get("reason") if errors else None,
        }
    return out


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def availability(request):
    start, end, err = _parse_range(request)
    if err:
        return Response({"detail": err}, status=400)

    emails = []
    for raw in csv_params(request.query_params.get("emails")):
        e = raw.strip().lower()
        if e and "@" in e and e not in emails:
            emails.append(e)
    if not emails:
        return Response({"detail": "Provide at least one email in ?emails=."}, status=400)
    if len(emails) > MAX_PEOPLE:
        return Response({"detail": f"At most {MAX_PEOPLE} people at a time."}, status=400)

    from team.models import TeamMember

    User = get_user_model()
    members = {
        m.email.lower(): m
        for m in TeamMember.objects.filter(email__in=emails).select_related("user")
    }
    users_by_email = {u.email.lower(): u for u in User.objects.filter(email__in=emails, is_active=True)}

    people, google_emails = [], []
    for email in emails:
        member = members.get(email)
        user = (member.user if member and member.user_id else None) or users_by_email.get(email)
        name = (member.full_name if member else "") or (user.get_full_name() if user else "") or email
        if user is not None and user.pk == request.user.pk:
            continue  # the viewer's own calendar is already on screen
        if user is not None and user.is_active:
            people.append({
                "email": email, "name": name, "source": "app",
                "busy": _app_user_busy(request.user, user, start, end), "error": None,
            })
        else:
            people.append({"email": email, "name": name, "source": "google", "busy": [], "error": None})
            google_emails.append(email)

    google = _google_freebusy(request.user, google_emails, start, end)
    for person in people:
        if person["source"] == "google" and person["email"] in google:
            person.update(google[person["email"]])

    return Response({"start": start.isoformat(), "end": end.isoformat(), "people": people})
