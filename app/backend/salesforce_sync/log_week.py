"""
Resolve a week of calendar activity into Cloud Coach time entries, then write them.

Two halves, deliberately separated:

    plan_week(user, week_start, ...)  -> WeekPlan   # DB reads only, no Salesforce
    write_week(user, plan)           -> dict        # one composite call + audit rows

`plan_week` touching no external system is what lets one implementation serve three
callers: the warning modal's preview, the agent's read-back-before-writing step, and
the write path itself. There is no second copy of the resolution rules to drift.

Resolution order per event (first match wins) — "manual wins" is the rule the user
asked for, so a project dragged onto a day in the Log Time panel always beats
whatever the account link would have inferred:

    1. explicitly marked did-not-attend        -> skipped, reported
    2. LogTimeDayAssignment for that user+date -> that project  (manual; account-linked
       events only, and in a scoped run only projects on that account)
    3. event.account -> AccountProject.sf_project_id            (auto)
    4. event.account -> SalesforceProject the user holds a role on (auto, by name)
    5. no account at all                       -> skipped, reported
       account but nothing in 3 or 4           -> skipped, reported
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import date, timedelta

from .cloudcoach import (
    CloudCoachError,
    build_time_log_payload,
    composite_create,
    is_sf_id,
    resolve_resource_id,
    week_bounds,
)
from .cloudcoach_schema import get_schema

logger = logging.getLogger(__name__)

# Cloud Coach bills in quarter hours; a 50-minute meeting is 0.75h, not 0.83h.
QUARTER_HOUR_MINUTES = 15

# Event kinds that are never timesheet activity.
EXCLUDED_CALENDAR_IDS = frozenset({"work_tracking"})


def round_up_to_quarter_hour(minutes: float) -> int:
    """Port of the Log Time panel's `roundUpToQuarterHour`, so UI and server agree."""
    if minutes <= 0:
        return 0
    return int(math.ceil(minutes / QUARTER_HOUR_MINUTES) * QUARTER_HOUR_MINUTES)


@dataclass
class PlannedEntry:
    """One time-log line: a day's worth of work on one project."""
    entry_date: date
    project_sf_id: str
    project_name: str
    minutes: int
    description: str
    source: str = "auto"  # "auto" | "manual" | "client"
    titles: list[str] = field(default_factory=list)

    @property
    def hours(self) -> float:
        return round(self.minutes / 60.0, 2)

    def as_dict(self) -> dict:
        return {
            "date": self.entry_date.isoformat(),
            "project_sf_id": self.project_sf_id,
            "project_name": self.project_name,
            "minutes": self.minutes,
            "hours": self.hours,
            "description": self.description,
            "source": self.source,
            "titles": list(self.titles),
        }


@dataclass
class SkippedEvent:
    event_id: int
    title: str
    event_date: str
    reason: str
    account_name: str = ""

    def as_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "title": self.title,
            "date": self.event_date,
            "reason": self.reason,
            "account_name": self.account_name,
        }


@dataclass
class WeekPlan:
    week_start: date
    week_end: date  # exclusive
    entries: list[PlannedEntry] = field(default_factory=list)
    unlinked_events: list[SkippedEvent] = field(default_factory=list)
    not_attended_events: list[SkippedEvent] = field(default_factory=list)
    account_without_project: list[SkippedEvent] = field(default_factory=list)
    already_logged: list[PlannedEntry] = field(default_factory=list)
    fields_skipped: list[str] = field(default_factory=list)

    @property
    def total_minutes(self) -> int:
        return sum(e.minutes for e in self.entries)

    def as_dict(self) -> dict:
        return {
            "week_start": self.week_start.isoformat(),
            "week_end": self.week_end.isoformat(),
            "entries": [e.as_dict() for e in self.entries],
            "entry_count": len(self.entries),
            "total_minutes": self.total_minutes,
            "total_hours": round(self.total_minutes / 60.0, 2),
            "unlinked_events": [s.as_dict() for s in self.unlinked_events],
            "unlinked_count": len(self.unlinked_events),
            "not_attended_events": [s.as_dict() for s in self.not_attended_events],
            "not_attended_count": len(self.not_attended_events),
            "account_without_project": [s.as_dict() for s in self.account_without_project],
            "account_without_project_count": len(self.account_without_project),
            "already_logged": [e.as_dict() for e in self.already_logged],
            "already_logged_count": len(self.already_logged),
            "fields_skipped": list(self.fields_skipped),
        }


# ── Planning ──────────────────────────────────────────────────────────────────


def _event_minutes(event) -> int:
    seconds = (event.end_datetime - event.start_datetime).total_seconds()
    return max(0, int(round(seconds / 60.0)))


def _build_description(titles: list[str], minutes: int) -> str:
    lines = list(titles)
    lines.append(f"Total: {minutes / 60.0:.2f} hrs")
    return "\n".join(lines)


def _manual_assignments(user, week_start: date, week_end: date) -> dict[date, list]:
    """`{date: [LogTimeDayAssignment, ...]}` for the week, position-ordered."""
    from .models import LogTimeDayAssignment

    out: dict[date, list] = {}
    rows = (
        LogTimeDayAssignment.objects
        .filter(user=user, date__gte=week_start, date__lt=week_end)
        .select_related("project", "project__account")
        .order_by("date", "position")
    )
    for row in rows:
        out.setdefault(row.date, []).append(row)
    return out


def _scoped_assignments(day_rows: list, scope: str) -> list:
    """Drop assignments to another account's project from a per-account run.

    Day assignments are per user, not per account, so a project dragged onto Tuesday in
    one account's panel used to capture every other account's Tuesday events too. A
    project with no mirrored account can't be attributed, so it is kept.
    """
    if not scope:
        return day_rows
    kept = []
    for row in day_rows:
        acct = getattr(row.project, "account", None)
        name = (getattr(acct, "name", "") or "").strip().lower()
        if not name or name == scope.lower():
            kept.append(row)
    return kept


def _my_role_project_sf_ids(user) -> set[str]:
    """
    Cloud Coach project ids the user holds a role on, from the local mirror.

    Populated by `sync.sync_project_roles`, which writes a SalesforceTeamMember row
    per role lookup field. Reading the mirror instead of querying Salesforce is what
    keeps `plan_week` free of network calls.
    """
    from .models import SalesforceConfig, SalesforceTeamMember

    sf_user_id = ""
    try:
        sf_user_id = user.sf_config.sf_user_id or ""
    except (SalesforceConfig.DoesNotExist, AttributeError):
        return set()
    if not sf_user_id:
        return set()
    return set(
        SalesforceTeamMember.objects
        .filter(sf_user_id=sf_user_id)
        .values_list("project__sf_id", flat=True)
    )


def _project_for_account(account, role_project_ids: set[str]) -> tuple[str, str]:
    """
    `(sf_project_id, project_name)` for a local Account, or `("", "")`.

    Prefers an explicit `AccountProject.sf_project_id` — someone typed that id in the
    project modal, so it is the most deliberate signal available. Falls back to a
    Cloud Coach project whose account name matches and which the user is actually on;
    without the role check a name match could file time to a colleague's project.
    """
    from accounts.models import AccountProject

    from .models import SalesforceProject

    explicit = (
        AccountProject.objects
        .filter(account=account)
        .exclude(kind="goal")  # goals roll up into a project; never a timesheet target
        .exclude(sf_project_id="")
        .order_by("position", "name")
        .first()
    )
    if explicit:
        return explicit.sf_project_id, explicit.name

    if not role_project_ids:
        return "", ""
    match = (
        SalesforceProject.objects
        .filter(sf_id__in=role_project_ids, account__name__iexact=account.company_name)
        .order_by("-start_date", "name")
        .first()
    )
    if match:
        return match.sf_id, match.name
    return "", ""


def _already_logged_keys(user, week_start: date, week_end: date) -> set[tuple[str, date]]:
    from .models import SalesforceTimeEntry

    rows = (
        SalesforceTimeEntry.objects
        .filter(user=user, synced_to_sf=True, date__gte=week_start, date__lt=week_end)
        .exclude(project__isnull=True)
        .values_list("project__sf_id", "date")
    )
    return {(sf_id, d) for sf_id, d in rows}


def _plan_from_client_entries(entries: list[dict]) -> list[PlannedEntry]:
    """
    Trust explicit entries from the Log Time panel.

    The panel holds per-event hour overrides, row removals and per-project item
    assignments in localStorage. None of that reaches the server, so recomputing the
    week would silently discard the user's edits — hence this path.
    """
    planned: list[PlannedEntry] = []
    for raw in entries:
        project_sf_id = str(raw.get("project_sf_id") or "").strip()
        if not is_sf_id(project_sf_id):
            # Pseudo-projects the panel invents for admin/local rows ("local-7",
            # "admin-pseudo-2") have no Cloud Coach record to write to.
            continue
        raw_date = raw.get("date")
        if isinstance(raw_date, date):
            entry_date = raw_date
        else:
            try:
                entry_date = date.fromisoformat(str(raw_date)[:10])
            except (TypeError, ValueError):
                continue
        minutes = int(raw.get("minutes") or 0)
        if minutes <= 0:
            continue
        titles = [str(t) for t in (raw.get("titles") or [])]
        description = str(raw.get("description") or "") or _build_description(titles, minutes)
        planned.append(PlannedEntry(
            entry_date=entry_date,
            project_sf_id=project_sf_id,
            project_name=str(raw.get("project_name") or ""),
            minutes=minutes,
            description=description,
            source="client",
            titles=titles,
        ))
    return planned


def plan_week(
    user,
    week_start: date,
    *,
    account_name: str | None = None,
    entries: list[dict] | None = None,
) -> WeekPlan:
    """
    Build the week's time-log plan. Reads the database only — never Salesforce.

    `account_name` scopes to one account (the Log Time panel is per-account). Omit it
    for the whole week, which is what the voice path does.
    """
    from scheduler.models import CalendarEvent

    week_start, week_end = week_bounds(week_start)
    plan = WeekPlan(week_start=week_start, week_end=week_end)

    # Explicit entries still get the week's skip report — the modal must warn about
    # unlinked events regardless of how the entries were produced.
    client_entries = _plan_from_client_entries(entries) if entries else None

    events = (
        CalendarEvent.objects
        .filter(owner=user, start_datetime__date__gte=week_start, start_datetime__date__lt=week_end)
        .exclude(all_day=True)
        .exclude(status="cancelled")
        .exclude(calendar_id__in=EXCLUDED_CALENDAR_IDS)
        .select_related("account")
        .order_by("start_datetime")
    )

    scope = (account_name or "").strip()
    manual = _manual_assignments(user, week_start, week_end)
    role_project_ids = _my_role_project_sf_ids(user)

    # (date, project_sf_id) -> [name, minutes, titles]
    buckets: dict[tuple[date, str], dict] = {}

    for event in events:
        event_date = event.start_datetime.date()
        acct = event.account
        acct_name = acct.company_name if acct else ""

        # A scoped run (the per-account Log Time panel) drops other accounts' events
        # silently — they are somebody else's problem. But an event with *no* account
        # is deliberately kept, because it cannot belong to another account either, and
        # warning about exactly those is the point of the report.
        if scope and acct_name and acct_name.lower() != scope.lower():
            continue

        skipped = SkippedEvent(
            event_id=event.pk,
            title=event.title,
            event_date=event_date.isoformat(),
            reason="",
            account_name=acct_name,
        )

        if event.attended is False:
            skipped.reason = "did_not_attend"
            plan.not_attended_events.append(skipped)
            continue

        minutes = _event_minutes(event)
        if minutes <= 0:
            continue

        # In a per-account run an event with no account is not filed under a dragged-in
        # project: the panel never shows it on that account, so logging it there put hours
        # on an account they didn't belong to. It is reported as unlinked instead. An
        # unscoped (whole-week / voice) run keeps the old "manual covers the day" rule.
        day_manual = (
            _scoped_assignments(manual.get(event_date) or [], scope) if (acct or not scope) else []
        )
        if len(day_manual) == 1:
            row = day_manual[0]
            project_sf_id, project_name, source = row.project.sf_id, row.project.name, "manual"
        elif len(day_manual) > 1:
            # Several projects on one day means the split is a per-event decision the
            # panel makes and stores client-side. Guessing here would put the hours on
            # the wrong project, so defer to whatever `entries` the panel sent.
            project_sf_id, project_name, source = "", "", "manual"
        elif acct:
            project_sf_id, project_name = _project_for_account(acct, role_project_ids)
            source = "auto"
        else:
            project_sf_id, project_name, source = "", "", "auto"

        if not project_sf_id:
            if not acct:
                skipped.reason = "no_account_linked"
                plan.unlinked_events.append(skipped)
            else:
                skipped.reason = "no_cloud_coach_project"
                plan.account_without_project.append(skipped)
            continue

        key = (event_date, project_sf_id)
        bucket = buckets.setdefault(key, {"name": project_name, "minutes": 0, "titles": [], "source": source})
        bucket["minutes"] += minutes
        bucket["titles"].append(event.title)

    if client_entries is not None:
        computed = client_entries
    else:
        computed = [
            PlannedEntry(
                entry_date=entry_date,
                project_sf_id=project_sf_id,
                project_name=bucket["name"],
                minutes=round_up_to_quarter_hour(bucket["minutes"]),
                description=_build_description(bucket["titles"], round_up_to_quarter_hour(bucket["minutes"])),
                source=bucket["source"],
                titles=bucket["titles"],
            )
            for (entry_date, project_sf_id), bucket in sorted(buckets.items(), key=lambda kv: (kv[0][0], kv[0][1]))
        ]

    logged = _already_logged_keys(user, week_start, week_end)
    for entry in computed:
        if (entry.project_sf_id, entry.entry_date) in logged:
            plan.already_logged.append(entry)
        else:
            plan.entries.append(entry)

    return plan


# ── Writing ───────────────────────────────────────────────────────────────────


def write_week(user, plan: WeekPlan) -> dict:
    """
    Write `plan.entries` to Cloud Coach in one composite call, then mirror them locally.

    Local `SalesforceTimeEntry` rows are created first and marked synced afterwards,
    matching `write_back.log_time`'s existing shape — so a failed write leaves an
    audit row carrying `sync_error` rather than no trace at all.
    """
    from .client import get_client
    from .models import SalesforceProject, SalesforceTimeEntry

    if not plan.entries:
        return {**plan.as_dict(), "logged": 0, "written": []}

    schema = get_schema()
    sf = get_client(user)

    sf_user_id = ""
    try:
        sf_user_id = user.sf_config.sf_user_id or ""
    except Exception:
        sf_user_id = ""
    resource_id = resolve_resource_id(sf, sf_user_id, schema)
    if schema["timeLog"].get("userField") and not resource_id:
        plan.fields_skipped.append(schema["timeLog"]["userField"])

    projects_by_sf_id = {
        p.sf_id: p
        for p in SalesforceProject.objects.filter(
            sf_id__in=[e.project_sf_id for e in plan.entries]
        )
    }

    audit_rows = [
        SalesforceTimeEntry.objects.create(
            user=user,
            project=projects_by_sf_id.get(entry.project_sf_id),
            date=entry.entry_date,
            duration_minutes=entry.minutes,
            description=entry.description,
            synced_to_sf=False,
        )
        for entry in plan.entries
    ]

    payloads = [
        build_time_log_payload(
            project_sf_id=entry.project_sf_id,
            entry_date=entry.entry_date,
            hours=entry.hours,
            description=entry.description,
            resource_id=resource_id,
            schema=schema,
        )
        for entry in plan.entries
    ]

    try:
        new_ids = composite_create(sf, payloads, all_or_none=True, schema=schema)
    except CloudCoachError as exc:
        for row in audit_rows:
            row.sync_error = str(exc)
            row.save(update_fields=["sync_error"])
        raise

    for row, new_id in zip(audit_rows, new_ids + [""] * len(audit_rows)):
        row.sf_id = new_id or ""
        row.synced_to_sf = True
        row.save(update_fields=["sf_id", "synced_to_sf"])

    logger.info(
        "Logged %d Cloud Coach time entries for %s, week of %s",
        len(audit_rows), user, plan.week_start,
    )
    return {
        **plan.as_dict(),
        "logged": len(audit_rows),
        "written": [
            {**entry.as_dict(), "sf_id": row.sf_id}
            for entry, row in zip(plan.entries, audit_rows)
        ],
    }


def week_range_label(week_start: date) -> str:
    """`"Mon 25 Aug – Sun 31 Aug"`, for spoken and modal summaries."""
    start, end = week_bounds(week_start)
    last = end - timedelta(days=1)
    return f"{start.strftime('%a %d %b')} – {last.strftime('%a %d %b')}"
