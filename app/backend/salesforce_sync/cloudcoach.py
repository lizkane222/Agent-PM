"""
Cloud Coach domain layer.

Ported from the `timesheeter` Apps Script add-on's `src/CloudCoach.js` and
`src/Salesforce.js`, rebuilt on top of this app's `client.get_client(user)` and
`cloudcoach_schema.get_schema()`.

Every SOQL builder here runs `available_fields()` first and drops fields the org does
not actually have, reporting them to the caller. That mirrors the describe-gating
`accounts.views.AccountProjectViewSet.fetch_salesforce` already does, and it is what
keeps a wrong guess in `cloudcoach_schema` from becoming an opaque Salesforce 400.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta

from .cloudcoach_schema import account_relationship, get_schema

logger = logging.getLogger(__name__)

# Salesforce ids are 15 or 18 characters of [a-zA-Z0-9]. Anything else cannot be an
# id, so rejecting it outright is both a correctness and an injection guard — these
# values are interpolated into SOQL.
_SF_ID_RE = re.compile(r"^[a-zA-Z0-9]{15,18}$")


class CloudCoachError(Exception):
    """A Cloud Coach read or write failed in a way the caller should surface."""


def is_sf_id(value: str) -> bool:
    return bool(value) and bool(_SF_ID_RE.match(str(value)))


def soql_string(value: str) -> str:
    """Escape a value for use inside single quotes in a SOQL literal."""
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def soql_like(value: str) -> str:
    """
    Escape a value for use inside a SOQL `LIKE` pattern.

    `soql_string` is not sufficient here: in a LIKE, `%` and `_` are wildcards, so an
    unescaped user-supplied `%` turns "find the project called %" into "match everything",
    and a `_` silently matches any single character. Backslash first, so the escapes added
    below are not themselves re-escaped.
    """
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


# ── Week math ─────────────────────────────────────────────────────────────────


def week_bounds(d: date | None = None) -> tuple[date, date]:
    """
    Monday-start week containing `d`, as `(week_start, week_end_exclusive)`.

    Ported from `Gcal.js::getWeekStartDate`/`getWeekEndDate`. The end is *exclusive*
    (start + 7 days), matching how `views.log_time_day_assignments` already filters a
    week with `date__lt=end`.
    """
    day = d or date.today()
    # date.weekday() is already Monday=0, so no Sunday special-case is needed here —
    # the JS version needed one only because Date.getDay() is Sunday=0.
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=7)


def parse_week_start(value: str | None) -> date:
    """
    Resolve a `week_start` request/tool argument to the Monday of that week.

    Blank resolves to the current week. A non-ISO value raises ValueError so the
    caller can answer 400 rather than silently logging to the wrong week.
    """
    if not value:
        return week_bounds()[0]
    parsed = date.fromisoformat(str(value).strip()[:10])
    return week_bounds(parsed)[0]


# ── Describe gating ───────────────────────────────────────────────────────────


def available_fields(sf, sobject: str) -> set[str]:
    """
    The set of field API names that actually exist on `sobject`.

    Returns an empty set if the object cannot be described at all — callers treat
    that as "gate nothing", because an undescribable object is a hard failure the
    subsequent query will report with a real Salesforce message.
    """
    try:
        describe = sf.restful(f"sobjects/{sobject}/describe")
    except Exception:
        logger.warning("Could not describe %s; skipping field gating.", sobject)
        return set()
    return {f["name"] for f in (describe or {}).get("fields", []) or []}


def gate_fields(available: set[str], wanted: list[str]) -> tuple[list[str], list[str]]:
    """Split `wanted` into (present, skipped). An empty `available` gates nothing."""
    if not available:
        return list(wanted), []
    present = [f for f in wanted if f in available]
    skipped = [f for f in wanted if f not in available]
    return present, skipped


# ── Projects the user is assigned to ──────────────────────────────────────────


def my_projects_for_week(sf, sf_user_id: str, week_start: date, schema: dict | None = None) -> dict:
    """
    Cloud Coach projects the user holds a role on, live during the given week.

    Port of `CloudCoach.js::ccGetMyProjectsThisWeek`. Returns
    `{"projects": [...], "fields_skipped": [...], "roles_skipped": [...]}` where each
    project is `{projectId, projectName, accountId, accountName}`.
    """
    schema = schema or get_schema()
    p = schema["project"]
    if not is_sf_id(sf_user_id):
        return {"projects": [], "fields_skipped": [], "roles_skipped": []}

    available = available_fields(sf, p["object"])
    role_fields, roles_skipped = gate_fields(available, list(p["userRoleFields"]))
    if not role_fields:
        logger.warning(
            "None of the configured userRoleFields exist on %s; cannot resolve "
            "the user's projects.", p["object"],
        )
        return {"projects": [], "fields_skipped": [], "roles_skipped": roles_skipped}

    acct_rel = account_relationship(p["accountField"])
    optional = [p["nameField"], p["accountField"], p["startField"], p["endField"]]
    present, fields_skipped = gate_fields(available, optional)

    select = ["Id", *present]
    if p["accountField"] in present:
        select.append(f"{acct_rel}.Name")

    user_literal = soql_string(sf_user_id)
    role_clause = " OR ".join(f"{f} = '{user_literal}'" for f in role_fields)

    where = [f"({role_clause})"]
    week_end_inclusive = week_start + timedelta(days=6)
    if p["endField"] in present:
        where.append(f"({p['endField']} = NULL OR {p['endField']} >= {week_start.isoformat()})")
    if p["startField"] in present:
        where.append(
            f"({p['startField']} = NULL OR {p['startField']} <= {week_end_inclusive.isoformat()})"
        )

    soql = (
        f"SELECT {', '.join(select)} FROM {p['object']} WHERE " + " AND ".join(where)
    )

    try:
        result = sf.query(soql)
    except Exception as exc:
        logger.exception("Cloud Coach project query failed")
        raise CloudCoachError("Could not read your Cloud Coach projects.") from exc

    projects = []
    for rec in (result or {}).get("records", []) or []:
        acct = rec.get(acct_rel) or {}
        projects.append({
            "projectId": rec.get("Id", ""),
            "projectName": rec.get(p["nameField"]) or "(Unnamed project)",
            "accountId": rec.get(p["accountField"]) or "",
            "accountName": acct.get("Name") or "",
        })
    projects.sort(key=lambda r: (r["accountName"].lower(), r["projectName"].lower()))
    return {
        "projects": projects,
        "fields_skipped": fields_skipped,
        "roles_skipped": roles_skipped,
    }


PROJECT_NAME_SEARCH_LIMIT = 10


def find_projects_by_name(
    sf,
    name: str,
    *,
    sf_user_id: str = "",
    limit: int = PROJECT_NAME_SEARCH_LIMIT,
    schema: dict | None = None,
) -> dict:
    """
    Cloud Coach projects whose name contains `name`, with the caller's roles on each.

    Deliberately **not** filtered to the caller's own projects: the question being answered
    is often "does a project called X exist" or "am I on X", and a filtered search cannot
    answer the second in the negative. SOQL runs under the user's own OAuth token, so the
    org's sharing rules still apply — nothing is exposed that the user could not see in the
    Salesforce UI.

    `myRoles` lists the role lookup fields holding `sf_user_id`, which is what turns a bare
    "yes it exists" into "yes, and you're the Solution Architect on it".
    """
    schema = schema or get_schema()
    p = schema["project"]
    term = (name or "").strip()
    if not term:
        return {"projects": [], "fields_skipped": [], "roles_skipped": []}

    available = available_fields(sf, p["object"])
    acct_rel = account_relationship(p["accountField"])
    optional = [p["nameField"], p["accountField"], p["startField"], p["endField"]]
    present, fields_skipped = gate_fields(available, optional)
    role_fields, roles_skipped = gate_fields(available, list(p["userRoleFields"]))

    select = ["Id", *present, *role_fields]
    if p["accountField"] in present:
        select.append(f"{acct_rel}.Name")

    # LIKE needs its own escaping — see soql_like.
    soql = (
        f"SELECT {', '.join(select)} FROM {p['object']} "
        f"WHERE {p['nameField']} LIKE '%{soql_like(term)}%' "
        f"ORDER BY {p['nameField']} LIMIT {int(limit)}"
    )

    try:
        result = sf.query(soql)
    except Exception as exc:
        logger.exception("Cloud Coach project name search failed")
        raise CloudCoachError("Could not search your Cloud Coach projects.") from exc

    projects = []
    for rec in (result or {}).get("records", []) or []:
        acct = rec.get(acct_rel) or {}
        my_roles = [
            f for f in role_fields
            if sf_user_id and rec.get(f) == sf_user_id
        ]
        projects.append({
            "projectId": rec.get("Id", ""),
            "projectName": rec.get(p["nameField"]) or "(Unnamed project)",
            "accountId": rec.get(p["accountField"]) or "",
            "accountName": acct.get("Name") or "",
            "startDate": rec.get(p["startField"]) or None,
            "endDate": rec.get(p["endField"]) or None,
            "myRoles": my_roles,
            "isMember": bool(my_roles),
        })
    return {
        "projects": projects,
        "fields_skipped": fields_skipped,
        "roles_skipped": roles_skipped,
    }


# ── The Resource lookup on the time-log object ────────────────────────────────


def resolve_resource_id(sf, sf_user_id: str, schema: dict | None = None) -> str:
    """
    The value for the time log's optional `userField`, or "" if it can't be resolved.

    `cloudcoach_schema` sets `timeLog.userField = "Resource__c"`, and
    `timesheeter/src/Debug.js::debugMyAssignments` probes `Resource__c` as a *separate
    custom object*, so this may be a lookup to a Resource record rather than to User.
    We cannot tell without the live org, so: describe the time-log object, read what
    `userField` actually references, and answer accordingly.

    Returning "" is a supported outcome — `build_time_log_payload` omits the field,
    exactly as `ccLogWeek` did when `tl.userField` was falsy.
    """
    schema = schema or get_schema()
    tl = schema["timeLog"]
    user_field = tl.get("userField") or ""
    if not user_field or not is_sf_id(sf_user_id):
        return ""

    try:
        describe = sf.restful(f"sobjects/{tl['object']}/describe")
    except Exception:
        logger.warning("Could not describe %s; omitting %s.", tl["object"], user_field)
        return ""

    field = next(
        (f for f in (describe or {}).get("fields", []) or [] if f.get("name") == user_field),
        None,
    )
    if not field:
        return ""

    references = set(field.get("referenceTo") or [])
    if "User" in references:
        return sf_user_id

    resource_obj = (schema.get("resource") or {}).get("object") or ""
    resource_user_field = (schema.get("resource") or {}).get("userField") or ""
    if resource_obj not in references or not resource_user_field:
        logger.warning(
            "%s.%s references %s, which is not a configured resource object; omitting it.",
            tl["object"], user_field, sorted(references) or "nothing",
        )
        return ""

    soql = (
        f"SELECT Id FROM {resource_obj} "
        f"WHERE {resource_user_field} = '{soql_string(sf_user_id)}' LIMIT 1"
    )
    try:
        result = sf.query(soql)
    except Exception:
        logger.warning("Could not resolve a %s record for the user; omitting %s.",
                       resource_obj, user_field)
        return ""
    records = (result or {}).get("records", []) or []
    return records[0].get("Id", "") if records else ""


# ── Time-log writes ───────────────────────────────────────────────────────────


def build_time_log_payload(
    *,
    project_sf_id: str,
    entry_date: date,
    hours: float,
    description: str,
    resource_id: str = "",
    schema: dict | None = None,
) -> dict:
    """One time-log record body. Port of the body-building half of `ccLogWeek`."""
    schema = schema or get_schema()
    tl = schema["timeLog"]
    payload = {
        tl["projectField"]: project_sf_id,
        tl["dateField"]: entry_date.isoformat(),
        tl["hoursField"]: hours,
        tl["descriptionField"]: description,
    }
    user_field = tl.get("userField") or ""
    if user_field and resource_id:
        payload[user_field] = resource_id
    return payload


def composite_create(sf, records: list[dict], *, all_or_none: bool = True, schema: dict | None = None) -> list[str]:
    """
    Create every record in one Composite API call. Returns the new Salesforce ids.

    Port of `Salesforce.js::sfComposite` plus `ccLogWeek`'s per-`referenceId` error
    collection. One HTTP call instead of one per entry — the same reason the
    2026-08-18 batching session replaced the frontend's per-item fan-out.

    `all_or_none=True` means a partial week is never left behind: either every line
    lands or none do, so a retry can't double-log.
    """
    schema = schema or get_schema()
    from .client import SF_API_VERSION

    sobject = schema["timeLog"]["object"]
    if not records:
        return []

    requests_body = [
        {
            "method": "POST",
            "url": f"/services/data/{SF_API_VERSION}/sobjects/{sobject}",
            "referenceId": f"log_{idx}",
            "body": body,
        }
        for idx, body in enumerate(records, start=1)
    ]

    try:
        resp = sf.restful(
            "composite",
            method="POST",
            json={"allOrNone": all_or_none, "compositeRequest": requests_body},
        )
    except Exception as exc:
        logger.exception("Cloud Coach composite write failed")
        raise CloudCoachError("Could not write time entries to Cloud Coach.") from exc

    sub_responses = (resp or {}).get("compositeResponse", []) or []
    errors = [
        f"[{r.get('referenceId')} {r.get('httpStatusCode')}]"
        for r in sub_responses
        if int(r.get("httpStatusCode") or 0) >= 400
    ]
    if errors:
        # Log the full bodies (they carry field-level Salesforce messages) but keep
        # the raised message free of org data, matching this app's 502 convention.
        logger.error("Cloud Coach composite write returned errors: %s", sub_responses)
        raise CloudCoachError(
            f"Cloud Coach rejected {len(errors)} of {len(sub_responses)} time entries."
        )

    return [
        (r.get("body") or {}).get("id", "")
        for r in sub_responses
    ]
