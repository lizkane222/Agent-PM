"""
Add a person to a Cloud Coach project, so they can log time against it.

The mechanism is **discovered at push time**, not assumed, because this org's membership
model is unusual and unverified: `timesheeter/src/Debug.js::debugMyAssignments` found zero
rows in `project_cloud__Resource_Assignment__c` for the current user, yet membership is
plainly readable from ten named User lookups on the Project record itself (that is how
`cloudcoach.my_projects_for_week` finds a user's projects at all).

So the ladder, in order, with the reason for each rung:

1. **Already a member** — a role lookup holds them, or a Resource Assignment exists.
   No write at all. Makes a repeated drag idempotent.
2. **Resource Assignment record** — if that object and its User lookup both exist in the
   org. Creating a child record disturbs nothing, so it is strictly preferable.
3. **First *empty* role lookup** on the Project, verified against the live record.
4. **All role slots populated** → report `no_free_slot` and write nothing.

Rung 4 is the important one. `Project_Manager__c` is a real named role on a record shared
by the whole team; silently overwriting it to satisfy a drag-and-drop would be worse than
not pushing at all. Nothing in this module ever clears or replaces a populated field.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .cloudcoach import (
    CloudCoachError,
    available_fields,
    gate_fields,
    is_sf_id,
    soql_string,
)
from .cloudcoach_schema import get_schema

logger = logging.getLogger(__name__)

# Outcome vocabulary. Kept as constants because the frontend words each one (see
# `lib/cloudCoachPush.ts`) and a typo would silently render as "unknown result".
PUSHED = "pushed"
ALREADY_MEMBER = "already_member"
NO_FREE_SLOT = "no_free_slot"
NO_SF_USER = "no_sf_user"
NO_MECHANISM = "no_mechanism"
ERROR = "error"

MECHANISM_RESOURCE_ASSIGNMENT = "resource_assignment"
MECHANISM_ROLE_FIELD = "role_field"


@dataclass
class MemberPushPlan:
    """What a push would do, resolved against the live org but not yet written."""

    status: str
    mechanism: str = ""
    field_name: str = ""
    sf_project_id: str = ""
    sf_user_id: str = ""
    member_name: str = ""
    member_email: str = ""
    project_name: str = ""
    message: str = ""
    fields_skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "mechanism": self.mechanism,
            "field": self.field_name,
            "sf_project_id": self.sf_project_id,
            "sf_user_id": self.sf_user_id,
            "member_name": self.member_name,
            "member_email": self.member_email,
            "project_name": self.project_name,
            "message": self.message,
            "fields_skipped": list(self.fields_skipped),
        }


# ── Resolving a local TeamMember to a Salesforce User ─────────────────────────


def resolve_sf_user_id(sf, team_member) -> str:
    """
    The Salesforce User Id for a local `team.TeamMember`, or "" if it can't be found.

    The local `SalesforceTeamMember` mirror is checked first — it is populated by
    `sync.sync_project_roles` and needs no round trip. Falling back to an email query is
    safe because `TeamMember.email` is `unique=True`, so it is a genuine join key.

    Returning "" is a reported outcome, never an exception: a person who has no Salesforce
    user (a contractor, someone not yet provisioned) is a normal state, not a failure.
    """
    from .models import SalesforceTeamMember

    email = (getattr(team_member, "email", "") or "").strip()

    mirrored = (
        SalesforceTeamMember.objects
        .filter(email__iexact=email)
        .exclude(sf_user_id="")
        .values_list("sf_user_id", flat=True)
        .first()
        if email else None
    )
    if mirrored and is_sf_id(mirrored):
        return mirrored

    local_id = getattr(team_member, "pk", None)
    if local_id:
        by_local = (
            SalesforceTeamMember.objects
            .filter(local_member_id=local_id)
            .exclude(sf_user_id="")
            .values_list("sf_user_id", flat=True)
            .first()
        )
        if by_local and is_sf_id(by_local):
            return by_local

    if not email:
        return ""

    soql = (
        "SELECT Id FROM User "
        f"WHERE Email = '{soql_string(email)}' AND IsActive = true LIMIT 1"
    )
    try:
        result = sf.query(soql)
    except Exception:
        logger.warning("Could not query Salesforce for user %s", email)
        return ""
    records = (result or {}).get("records", []) or []
    found = records[0].get("Id", "") if records else ""
    return found if is_sf_id(found) else ""


# ── Planning ──────────────────────────────────────────────────────────────────


def _resource_assignment_available(sf, schema: dict) -> tuple[bool, list[str]]:
    """Whether the Resource Assignment object and both its lookups exist in the org."""
    ra = schema.get("resourceAssignment") or {}
    obj = ra.get("object") or ""
    if not obj:
        return False, []
    present = available_fields(sf, obj)
    if not present:
        # Undescribable — the object is absent or unreadable. Fall through to a role slot
        # rather than issuing a create that will 404.
        return False, [obj]
    wanted = [ra.get("projectField") or "", ra.get("userField") or ""]
    _, missing = gate_fields(present, [w for w in wanted if w])
    return (not missing), missing


def _existing_assignment(sf, schema: dict, sf_project_id: str, sf_user_id: str) -> bool:
    ra = schema["resourceAssignment"]
    soql = (
        f"SELECT Id FROM {ra['object']} "
        f"WHERE {ra['projectField']} = '{soql_string(sf_project_id)}' "
        f"AND {ra['userField']} = '{soql_string(sf_user_id)}' LIMIT 1"
    )
    try:
        result = sf.query(soql)
    except Exception:
        # A failed existence check must not be read as "not a member" — that would risk a
        # duplicate. Treat it as present and let the caller report already_member.
        logger.warning("Resource Assignment existence check failed; assuming present.")
        return True
    return bool((result or {}).get("records"))


def plan_member_push(sf, sf_project_id: str, team_member, schema: dict | None = None) -> MemberPushPlan:
    """Resolve what a push would do. Reads Salesforce; writes nothing."""
    schema = schema or get_schema()
    p = schema["project"]

    plan = MemberPushPlan(
        status=ERROR,
        sf_project_id=sf_project_id,
        member_name=getattr(team_member, "full_name", "") or "",
        member_email=(getattr(team_member, "email", "") or ""),
    )

    if not is_sf_id(sf_project_id):
        plan.status = ERROR
        plan.message = "That project has no Salesforce id."
        return plan

    sf_user_id = resolve_sf_user_id(sf, team_member)
    if not sf_user_id:
        plan.status = NO_SF_USER
        plan.message = (
            f"No active Salesforce user found for {plan.member_email or plan.member_name}."
        )
        return plan
    plan.sf_user_id = sf_user_id

    available = available_fields(sf, p["object"])
    role_fields, roles_skipped = gate_fields(available, list(p["userRoleFields"]))
    plan.fields_skipped = roles_skipped

    # Read the live project once: its name, and which role slots are taken.
    name_field = p["nameField"]
    select = ["Id", *([name_field] if not available or name_field in available else []), *role_fields]
    soql = (
        f"SELECT {', '.join(select)} FROM {p['object']} "
        f"WHERE Id = '{soql_string(sf_project_id)}' LIMIT 1"
    )
    try:
        result = sf.query(soql)
    except Exception as exc:
        logger.exception("Could not read the Cloud Coach project before pushing a member")
        raise CloudCoachError("Could not read that Cloud Coach project.") from exc

    records = (result or {}).get("records", []) or []
    if not records:
        plan.status = ERROR
        plan.message = "That Cloud Coach project no longer exists."
        return plan
    record = records[0]
    plan.project_name = record.get(name_field) or ""

    # 1. Already on it?
    held = [f for f in role_fields if record.get(f) == sf_user_id]
    if held:
        plan.status = ALREADY_MEMBER
        plan.mechanism = MECHANISM_ROLE_FIELD
        plan.field_name = held[0]
        plan.message = f"{plan.member_name} is already on {plan.project_name or 'that project'}."
        return plan

    ra_ok, ra_missing = _resource_assignment_available(sf, schema)
    if ra_ok and _existing_assignment(sf, schema, sf_project_id, sf_user_id):
        plan.status = ALREADY_MEMBER
        plan.mechanism = MECHANISM_RESOURCE_ASSIGNMENT
        plan.message = f"{plan.member_name} is already on {plan.project_name or 'that project'}."
        return plan

    # 2. Resource Assignment — preferred, because it creates rather than overwrites.
    if ra_ok:
        plan.status = PUSHED
        plan.mechanism = MECHANISM_RESOURCE_ASSIGNMENT
        plan.message = f"Add {plan.member_name} to {plan.project_name or 'the project'} as a resource."
        return plan
    plan.fields_skipped = [*plan.fields_skipped, *ra_missing]

    # 3. First empty role slot, never a populated one.
    empty = [f for f in role_fields if not record.get(f)]
    if empty:
        plan.status = PUSHED
        plan.mechanism = MECHANISM_ROLE_FIELD
        plan.field_name = empty[0]
        plan.message = (
            f"Add {plan.member_name} to {plan.project_name or 'the project'} "
            f"as {empty[0].removesuffix('__c').replace('_', ' ')}."
        )
        return plan

    # 4. Nothing free. Report rather than clobber a named role.
    if not role_fields:
        plan.status = NO_MECHANISM
        plan.message = (
            "This org exposes no way to add a project member that Agent PM can see — "
            "no Resource Assignment object and no role fields."
        )
        return plan
    plan.status = NO_FREE_SLOT
    plan.message = (
        f"Every project role on {plan.project_name or 'that project'} is already filled, "
        f"so {plan.member_name} was not added. Assign them in Cloud Coach directly."
    )
    return plan


# ── Writing ───────────────────────────────────────────────────────────────────


def push_member_to_project(user, sf_project_id: str, team_member, *, dry_run: bool = False) -> dict:
    """
    Add `team_member` to the Cloud Coach project, using whichever mechanism the org offers.

    Returns the outcome dict rather than raising, so callers can treat the push as
    best-effort — the local membership row is valid whether or not Salesforce accepted it,
    and losing the local link because a third party was unreachable would be the wrong
    trade.
    """
    from .client import get_client

    schema = get_schema()
    try:
        sf = get_client(user)
    except PermissionError:
        return MemberPushPlan(
            status=ERROR,
            sf_project_id=sf_project_id,
            member_name=getattr(team_member, "full_name", "") or "",
            message="Salesforce is not connected for this user.",
        ).as_dict()
    except Exception:
        logger.exception("Salesforce client setup failed for a member push")
        return MemberPushPlan(
            status=ERROR,
            sf_project_id=sf_project_id,
            member_name=getattr(team_member, "full_name", "") or "",
            message="Could not reach Salesforce.",
        ).as_dict()

    try:
        plan = plan_member_push(sf, sf_project_id, team_member, schema)
    except CloudCoachError as exc:
        return MemberPushPlan(
            status=ERROR,
            sf_project_id=sf_project_id,
            member_name=getattr(team_member, "full_name", "") or "",
            message=str(exc),
        ).as_dict()

    if dry_run or plan.status != PUSHED:
        return plan.as_dict()

    try:
        if plan.mechanism == MECHANISM_RESOURCE_ASSIGNMENT:
            ra = schema["resourceAssignment"]
            sf.restful(
                f"sobjects/{ra['object']}",
                method="POST",
                json={
                    ra["projectField"]: sf_project_id,
                    ra["userField"]: plan.sf_user_id,
                },
            )
        else:
            sf.restful(
                f"sobjects/{schema['project']['object']}/{sf_project_id}",
                method="PATCH",
                json={plan.field_name: plan.sf_user_id},
            )
    except Exception as exc:
        logger.exception("Cloud Coach member push failed")
        plan.status = ERROR
        plan.message = (
            f"Salesforce rejected adding {plan.member_name} to "
            f"{plan.project_name or 'that project'}."
        )
        logger.debug("member push detail: %s", exc)
        return plan.as_dict()

    plan.message = (
        f"{plan.member_name} added to {plan.project_name or 'the project'} in Cloud Coach"
        + (f" as {plan.field_name.removesuffix('__c').replace('_', ' ')}" if plan.field_name else "")
        + "."
    )
    logger.info(
        "Cloud Coach: added %s to project %s via %s",
        plan.member_email or plan.member_name, sf_project_id, plan.mechanism,
    )
    return plan.as_dict()


def sync_project_members(user, project, *, dry_run: bool = False) -> dict:
    """
    Reconcile every local `ProjectMember` on an `AccountProject` with Cloud Coach.

    The backfill for members linked before the auto-push existed. `dry_run` resolves the
    full plan without writing, which is also the only safe way to see what mechanism this
    org will actually use before letting it loose on real projects.
    """
    sf_project_id = (getattr(project, "sf_project_id", "") or "").strip()
    if not sf_project_id:
        return {
            "status": ERROR,
            "dry_run": dry_run,
            "project_name": getattr(project, "name", ""),
            "results": [],
            "message": "This project has no Salesforce project id, so nothing can be synced.",
        }

    members = list(project.members.select_related("team_member").all())
    results = [
        push_member_to_project(
            user, sf_project_id, pm.team_member, dry_run=dry_run
        )
        for pm in members
    ]
    counts: dict[str, int] = {}
    for item in results:
        counts[item["status"]] = counts.get(item["status"], 0) + 1

    return {
        "status": "ok",
        "dry_run": dry_run,
        "project_name": getattr(project, "name", ""),
        "sf_project_id": sf_project_id,
        "member_count": len(members),
        "counts": counts,
        "results": results,
    }
