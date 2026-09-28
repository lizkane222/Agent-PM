"""
Salesforce → local DB sync.

Pulls Accounts, Projects (Cloud Coach), Project Members, and Tasks.
Run via Celery beat every 30 min or call sync_all(user) directly.
"""
import logging
from datetime import datetime

from django.utils import timezone

from .client import get_client, discover_namespace
from .cloudcoach import available_fields, gate_fields, is_sf_id
from .cloudcoach_schema import account_relationship, get_schema
from .models import (
    SalesforceConfig,
    SalesforceAccount,
    SalesforceProject,
    SalesforceTeamMember,
    SalesforceTask,
)

logger = logging.getLogger(__name__)


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _str(v) -> str:
    return str(v) if v else ""


def _chatter_me(sf) -> dict:
    """`chatter/users/me`, or `{}`. 404s when the org has Chatter disabled."""
    try:
        return sf.restful("chatter/users/me", method="GET") or {}
    except Exception:
        return {}


def _oauth_userinfo(sf) -> dict:
    """
    `/services/oauth2/userinfo`, or `{}`.

    Not reachable through `sf.restful`, whose `base_url` is the versioned data API path;
    this endpoint sits outside it, so the session is used directly. It is an OpenID
    endpoint present in every org, which is what makes it a usable fallback when Chatter
    is off.
    """
    try:
        host = sf.base_url.split("/services/")[0]
        resp = sf.session.get(
            f"{host}/services/oauth2/userinfo", headers=sf.headers, timeout=15
        )
        return resp.json() if resp.ok else {}
    except Exception:
        return {}


def _get_or_create_config(user, sf) -> SalesforceConfig:
    from django.conf import settings
    config, _ = SalesforceConfig.objects.get_or_create(
        user=user,
        defaults={"instance_url": settings.SALESFORCE_INSTANCE_URL},
    )
    # `instance_url` is deliberately NOT written here. The OAuth callback stores the value
    # from the token response, which is the only authoritative source; reading it back off
    # the client would be circular, since the client's base_url is built *from* this row.
    if not config.namespace:
        config.namespace = discover_namespace(sf)

    # Fetch SF user identity.
    #
    # `chatter/users/me` is tried first because it is the richer payload, but it 404s in an
    # org with Chatter disabled — and a corporate sandbox often has it off. `oauth2/userinfo`
    # is an OpenID endpoint available to any org, so it is the fallback rather than the
    # primary only because Chatter was here first and works where it is enabled.
    #
    # Both are best-effort: an existing sf_user_id is never overwritten with a blank. The
    # OAuth callback already derived it from the token response's identity URL, which needs
    # no API call at all, and losing it here would disable the role-matched project fallback
    # and strip Resource__c from every time entry.
    for fetch, id_key in ((_chatter_me, "id"), (_oauth_userinfo, "user_id")):
        identity = fetch(sf)
        found_id = _str(identity.get(id_key))
        if is_sf_id(found_id):
            config.sf_user_id = found_id
            config.sf_user_email = _str(identity.get("email")) or config.sf_user_email
            break

    config.last_synced = timezone.now()
    config.save()
    return config


def sync_accounts(sf) -> int:
    query = (
        "SELECT Id, Name, Website, Industry, Type, Phone, "
        "BillingCity, BillingCountry, Owner.Id, Owner.Name "
        "FROM Account WHERE IsDeleted = false ORDER BY Name LIMIT 500"
    )
    result = sf.query_all(query)
    count = 0
    for rec in result.get("records", []):
        owner = rec.get("Owner") or {}
        SalesforceAccount.objects.update_or_create(
            sf_id=rec["Id"],
            defaults={
                "name": _str(rec.get("Name")),
                "website": _str(rec.get("Website")),
                "industry": _str(rec.get("Industry")),
                "account_type": _str(rec.get("Type")),
                "phone": _str(rec.get("Phone")),
                "billing_city": _str(rec.get("BillingCity")),
                "billing_country": _str(rec.get("BillingCountry")),
                "owner_sf_id": _str(owner.get("Id")),
                "owner_name": _str(owner.get("Name")),
            },
        )
        count += 1
    logger.info("sync_accounts: %d records", count)
    return count


def sync_projects(sf, ns: str, schema: dict | None = None) -> int:
    """
    Pull Cloud Coach projects, using the schema's real object/field API names.

    Previously this queried `{ns}__Project__c` with `AccountId` and
    `{ns}__Start_Date__c`. Against the org `timesheeter` probed, the object is
    `project_cloud__Project__c`, the account lookup is `ccpe_ocp__Account__c` and the
    dates are `project_cloud__Start__c`/`__End__c` — so the query 400'd and
    `SalesforceProject` stayed empty. Every optional column is now describe-gated, so
    a name that is still wrong costs that one column instead of the whole sync.
    """
    schema = schema or get_schema()
    p = schema["project"]
    sobject = p["object"]
    acct_field = p["accountField"]
    acct_rel = account_relationship(acct_field)

    available = available_fields(sf, sobject)
    optional = [
        p["nameField"], acct_field, p["startField"], p["endField"],
        p["statusField"], p["descriptionField"],
    ]
    present, skipped = gate_fields(available, optional)
    if skipped:
        logger.info("sync_projects: skipping fields absent from %s: %s", sobject, skipped)

    select = ["Id", "OwnerId", "Owner.Name", *present]
    if acct_field in present:
        select.append(f"{acct_rel}.Name")

    order_by = f" ORDER BY {p['startField']} DESC NULLS LAST" if p["startField"] in present else ""
    query = (
        f"SELECT {', '.join(select)} FROM {sobject} "
        f"WHERE IsDeleted = false{order_by} LIMIT 200"
    )
    result = sf.query_all(query)

    # Read only what was actually selected. Without this, a field dropped by the gate
    # could still be mapped onto the model if the response happened to carry it, so
    # "skipped" and "stored" could disagree.
    selected = set(present)

    def _field(name):
        return rec.get(name) if name in selected else None

    count = 0
    for rec in result.get("records", []):
        account = None
        account_sf_id = _str(_field(acct_field))
        if account_sf_id:
            account = SalesforceAccount.objects.filter(sf_id=account_sf_id).first()
            if account is None:
                # A project can reference an Account outside the 500-row window
                # `sync_accounts` pulls. Mirror the name from the parent traversal so
                # the by-name project fallback in `log_week` still has something to
                # match on, rather than dropping the link entirely.
                acct_name = _str((rec.get(acct_rel) or {}).get("Name"))
                if acct_name:
                    account, _ = SalesforceAccount.objects.update_or_create(
                        sf_id=account_sf_id, defaults={"name": acct_name},
                    )

        owner = rec.get("Owner") or {}
        SalesforceProject.objects.update_or_create(
            sf_id=rec["Id"],
            defaults={
                "account": account,
                "name": _str(_field(p["nameField"])),
                "status": _str(_field(p["statusField"])),
                "description": _str(_field(p["descriptionField"])),
                "start_date": _parse_date(_field(p["startField"])),
                "end_date": _parse_date(_field(p["endField"])),
                "owner_sf_id": _str(rec.get("OwnerId")),
                "owner_name": _str(owner.get("Name")),
            },
        )
        count += 1
    logger.info("sync_projects: %d records", count)
    return count


def sync_project_roles(sf, schema: dict | None = None) -> int:
    """
    Mirror the project role lookups into `SalesforceTeamMember` rows.

    This org does not link people to projects through Cloud Coach's Resource
    Assignment object — `timesheeter/src/Debug.js::debugMyAssignments` found zero rows
    there. Membership is expressed as ten User lookups *on the project itself*
    (`Project_Manager__c`, `Solution_Architect_Primary__c`, …).

    Reusing the existing `SalesforceTeamMember` model means no migration: `role` holds
    the field name and `sf_id` is synthesized as `role:<projectId>:<field>`, which is
    stable across syncs so the row updates rather than duplicating.
    """
    schema = schema or get_schema()
    p = schema["project"]
    sobject = p["object"]

    available = available_fields(sf, sobject)
    role_fields, skipped = gate_fields(available, list(p["userRoleFields"]))
    if skipped:
        logger.info("sync_project_roles: role fields absent from %s: %s", sobject, skipped)
    if not role_fields:
        return 0

    query = (
        f"SELECT Id, {', '.join(role_fields)} FROM {sobject} "
        f"WHERE IsDeleted = false LIMIT 200"
    )
    result = sf.query_all(query)

    count = 0
    for rec in result.get("records", []):
        project = SalesforceProject.objects.filter(sf_id=rec["Id"]).first()
        if not project:
            continue
        for field_name in role_fields:
            sf_user_id = _str(rec.get(field_name))
            if not is_sf_id(sf_user_id):
                continue
            SalesforceTeamMember.objects.update_or_create(
                sf_id=f"role:{project.sf_id}:{field_name}",
                defaults={
                    "project": project,
                    "sf_user_id": sf_user_id,
                    "name": "",
                    "role": field_name,
                },
            )
            count += 1
    logger.info("sync_project_roles: %d role links", count)
    return count


def sync_project_members(sf, ns: str) -> int:
    query = (
        f"SELECT Id, {ns}__Project__c, {ns}__User__c, "
        f"{ns}__User__r.Name, {ns}__User__r.Email, {ns}__Role__c "
        f"FROM {ns}__Project_Member__c WHERE IsDeleted = false LIMIT 500"
    )
    result = sf.query_all(query)
    count = 0
    for rec in result.get("records", []):
        project = SalesforceProject.objects.filter(
            sf_id=_str(rec.get(f"{ns}__Project__c"))
        ).first()
        if not project:
            continue

        user_rec = rec.get(f"{ns}__User__r") or {}
        name = _str(user_rec.get("Name"))
        email = _str(user_rec.get("Email"))

        member, _ = SalesforceTeamMember.objects.update_or_create(
            sf_id=rec["Id"],
            defaults={
                "project": project,
                "sf_user_id": _str(rec.get(f"{ns}__User__c")),
                "name": name,
                "email": email,
                "role": _str(rec.get(f"{ns}__Role__c")),
            },
        )

        # Create or link a local TeamMember
        if email and not member.local_member_id:
            try:
                from team.models import TeamMember
                local, created = TeamMember.objects.get_or_create(
                    email=email,
                    defaults={
                        "full_name": name,
                        "title": _str(rec.get(f"{ns}__Role__c")),
                        "status": "active",
                    },
                )
                member.local_member_id = local.pk
                member.save(update_fields=["local_member_id"])
                if created:
                    logger.info("Created local TeamMember from SF: %s", email)
            except Exception:
                logger.exception("Failed to create local TeamMember for %s", email)

        count += 1
    logger.info("sync_project_members: %d records", count)
    return count


def sync_tasks(sf, ns: str) -> int:
    query = (
        f"SELECT Id, Subject, {ns}__Status__c, {ns}__Priority__c, "
        f"{ns}__Due_Date__c, {ns}__Description__c, "
        f"{ns}__Project__c, {ns}__Account__c, "
        f"OwnerId, Owner.Name "
        f"FROM {ns}__Task__c WHERE IsDeleted = false "
        f"ORDER BY {ns}__Due_Date__c ASC NULLS LAST LIMIT 500"
    )
    result = sf.query_all(query)
    count = 0
    for rec in result.get("records", []):
        project = SalesforceProject.objects.filter(
            sf_id=_str(rec.get(f"{ns}__Project__c"))
        ).first()
        account = SalesforceAccount.objects.filter(
            sf_id=_str(rec.get(f"{ns}__Account__c"))
        ).first()
        owner = rec.get("Owner") or {}

        SalesforceTask.objects.update_or_create(
            sf_id=rec["Id"],
            defaults={
                "project": project,
                "account": account,
                "subject": _str(rec.get("Subject")),
                "status": _str(rec.get(f"{ns}__Status__c")),
                "priority": _str(rec.get(f"{ns}__Priority__c")),
                "due_date": _parse_date(rec.get(f"{ns}__Due_Date__c")),
                "description": _str(rec.get(f"{ns}__Description__c")),
                "assigned_to_sf_id": _str(rec.get("OwnerId")),
                "assigned_to_name": _str(owner.get("Name")),
            },
        )
        count += 1
    logger.info("sync_tasks: %d records", count)
    return count


def sync_all(user) -> dict:
    """
    Run every sync step, reporting per-step failures instead of aborting.

    Each step used to run unguarded, so one broken SOQL query (which is exactly what
    `sync_projects` was doing against the real org's field names) took accounts,
    members and tasks down with it. Now a step that fails reports its error and the
    rest still run.
    """
    sf = get_client(user)
    config = _get_or_create_config(user, sf)
    ns = config.namespace
    schema = get_schema()

    results: dict = {"namespace": ns}
    errors: dict[str, str] = {}

    steps = (
        ("accounts", lambda: sync_accounts(sf)),
        ("projects", lambda: sync_projects(sf, ns, schema)),
        ("project_roles", lambda: sync_project_roles(sf, schema)),
        ("members", lambda: sync_project_members(sf, ns)),
        ("tasks", lambda: sync_tasks(sf, ns)),
    )
    for name, step in steps:
        try:
            results[name] = step()
        except Exception as exc:
            logger.exception("Salesforce sync step %s failed", name)
            results[name] = 0
            errors[name] = str(exc)[:300]

    if errors:
        results["errors"] = errors
    return results
