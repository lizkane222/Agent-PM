"""
Dynamic lookup keywords for skills: ``@#--all-action-items-${account}`` and friends.

A keyword is `@#--<kind>-<account>[-<date range>]`. At run time each one is expanded to
compact records by calling the app's own REST endpoints **as the runner** through
`agents.rest_bridge`, so a keyword can never reach a record the runner could not open in
the UI. Unresolvable pieces are reported, never guessed.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from agents import rest_bridge
from agents.fuzzy import resolve_name
from agents.tool_policy import ToolPolicyError

# kind -> (label, takes a date range)
KINDS = {
    "all-action-items": ("Action items", True),
    "all-meeting-notes": ("Meeting notes", True),
    "all-artifacts": ("Artifacts", False),
    "all-account-notes": ("Account notes", True),
}

# Shown by the editor's `@#--` picker.
KEYWORD_CATALOG = [
    {"kind": "all-action-items", "template": "@#--all-action-items-${account_name}",
     "description": "Every action item on the account"},
    {"kind": "all-action-items", "template": "@#--all-action-items-${account_name}-${date-range}",
     "description": "Action items created or due in a date range"},
    {"kind": "all-meeting-notes", "template": "@#--all-meeting-notes-${account_name}-${date-range}",
     "description": "Meetings and their notes in a date range"},
    {"kind": "all-artifacts", "template": "@#--all-artifacts-${account_name}",
     "description": "Links and files on the account"},
    {"kind": "all-account-notes", "template": "@#--all-account-notes-${account_name}-${date-range}",
     "description": "Notes logged on the account"},
]

_KIND_ALT = "|".join(KINDS)
_ARG = r"(?:\$\{([^}]+)\}|([A-Za-z0-9_.]+))"
KEYWORD_RE = re.compile(rf"@#--({_KIND_ALT})-{_ARG}(?:-{_ARG})?")

MAX_ROWS = 40
MAX_TEXT = 1500
_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
           "september", "october", "november", "december"]


def parse_date_range(text: str | None, today: date | None = None) -> tuple[date, date] | None:
    """
    "last-30-days", "this-week", "last-week", "this-month", "last-month", "october",
    "october-2025", "2026-10-01..2026-10-31", "2026-10". None when absent/unparseable.
    """
    if not text:
        return None
    today = today or date.today()
    t = text.strip().lower().replace("_", "-").replace(" ", "-")
    m = re.fullmatch(r"(?:last|past)-(\d+)-(day|week|month)s?", t)
    if m:
        n = int(m.group(1)) * {"day": 1, "week": 7, "month": 30}[m.group(2)]
        return today - timedelta(days=n), today
    if t == "this-week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if t == "last-week":
        start = today - timedelta(days=today.weekday() + 7)
        return start, start + timedelta(days=6)
    if t in ("this-month", "last-month"):
        first = today.replace(day=1)
        if t == "last-month":
            first = (first - timedelta(days=1)).replace(day=1)
        nxt = (first + timedelta(days=32)).replace(day=1)
        return first, nxt - timedelta(days=1)
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})", t)
    if m:
        a, b = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
        return (a, b) if a <= b else (b, a)
    m = re.fullmatch(r"(\d{4})-(\d{2})", t)
    if m:
        return _month_span(int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"([a-z]+)(?:-(\d{4}))?", t)
    if m and m.group(1) in _MONTHS:
        month = _MONTHS.index(m.group(1)) + 1
        year = int(m.group(2)) if m.group(2) else (today.year if month <= today.month else today.year - 1)
        return _month_span(year, month)
    return None


def _month_span(year: int, month: int) -> tuple[date, date] | None:
    if not 1 <= month <= 12:
        return None
    first = date(year, month, 1)
    return first, (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)


def find_keywords(text: str) -> list[dict]:
    """Every keyword in `text`: {raw, kind, account, range}. Account/range may be ""."""
    found = []
    for m in KEYWORD_RE.finditer(text or ""):
        found.append({
            "raw": m.group(0), "kind": m.group(1),
            "account": (m.group(2) or m.group(3) or "").replace("-", " ").strip(),
            "range": (m.group(4) or m.group(5) or ""),
        })
    return found


def _in_range(value: str | None, span: tuple[date, date] | None) -> bool:
    if not span:
        return True
    if not value:
        return False
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return False
    return span[0] <= d <= span[1]


def _clip(text: str | None) -> str:
    text = (text or "").strip()
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + "…"


def _req(user, path, params=None):
    status, payload = rest_bridge.call(user, "GET", path, params=params)
    return rest_bridge.check(status, payload, action="load that record list")


def resolve_account(user, name: str) -> dict | None:
    """The runner's account best matching `name` (fuzzy, scoped by the accounts endpoint)."""
    data = _req(user, "accounts/accounts/", {"page_size": 1000})
    accounts = {a["company_name"]: a for a in rest_bridge.results(data) if a.get("company_name")}
    res = resolve_name(name, list(accounts))
    return accounts[res.match] if res.match else None


def expand_keyword(user, kw: dict, today: date | None = None) -> dict:
    """
    Expand one parsed keyword. Returns {raw, ok, label, account, range, rows|error}.
    Errors are data, so one bad keyword doesn't sink the rest of a run.
    """
    base = {"raw": kw["raw"], "kind": kw["kind"]}
    if kw["kind"] not in KINDS:
        return {**base, "ok": False, "error": f"Unknown keyword '{kw['kind']}'."}
    label, ranged = KINDS[kw["kind"]]
    span = parse_date_range(kw["range"], today) if ranged else None
    if ranged and kw["range"] and span is None:
        return {**base, "ok": False, "error": f"Could not read the date range '{kw['range']}'."}
    try:
        acct = resolve_account(user, kw["account"])
        if not acct:
            return {**base, "ok": False, "error": f"No account of yours matches '{kw['account']}'."}
        name, aid = acct["company_name"], acct["id"]
        if kw["kind"] == "all-action-items":
            rows = [
                {"task": r.get("task"), "status": r.get("status"), "due": r.get("due_date"),
                 "assignee": r.get("assignee_name"), "details": _clip(r.get("task_details"))}
                for r in rest_bridge.results(_req(user, "airtable/action-items/", {"account_name": name}))
                if _in_range(r.get("due_date") or r.get("created_at"), span)
            ]
        elif kw["kind"] == "all-meeting-notes":
            rows = [
                {"meeting": r.get("name"), "date": r.get("date"),
                 "notes": _clip(r.get("gong_notes") or r.get("zoom_notes") or r.get("expected_topics"))}
                for r in rest_bridge.results(
                    _req(user, "airtable/meetings/", {"account_name": name, "page_size": 500}))
                if _in_range(r.get("date"), span)
            ]
        elif kw["kind"] == "all-artifacts":
            rows = [
                {"name": r.get("name"), "type": r.get("artifact_type"), "url": r.get("url"),
                 "description": _clip(r.get("description"))}
                for r in rest_bridge.results(_req(user, f"accounts/accounts/{aid}/artifacts/"))
            ]
        else:  # all-account-notes
            rows = [
                {"note": _clip(r.get("content")), "author": r.get("author_username"), "at": r.get("created_at")}
                for r in rest_bridge.results(_req(user, f"accounts/accounts/{aid}/notes/"))
                if _in_range(r.get("created_at"), span)
            ]
    except ToolPolicyError as exc:
        return {**base, "ok": False, "error": str(exc)}
    return {
        **base, "ok": True, "label": label, "account": name,
        "range": [span[0].isoformat(), span[1].isoformat()] if span else None,
        "total": len(rows), "rows": rows[:MAX_ROWS],
    }


def render_expansion(result: dict) -> str:
    """Prompt text for one expanded keyword."""
    if not result.get("ok"):
        return f"{result['raw']}: could not be resolved — {result.get('error')}"
    span = f" ({result['range'][0]} to {result['range'][1]})" if result.get("range") else ""
    head = f"{result['label']} for {result['account']}{span} — {result['total']} found"
    if result["total"] > len(result["rows"]):
        head += f", showing {len(result['rows'])}"
    lines = [head]
    for row in result["rows"]:
        lines.append("- " + "; ".join(f"{k}: {v}" for k, v in row.items() if v not in (None, "")))
    return "\n".join(lines)
