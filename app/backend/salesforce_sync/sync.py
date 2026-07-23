"""
Salesforce → local DB sync.

Pulls Accounts, Projects (Cloud Coach), Project Members, and Tasks.
Run via Celery beat every 30 min or call sync_all(user) directly.
"""
import logging
from datetime import datetime

from django.utils import timezone

from .client import get_client, discover_namespace
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


def _get_or_create_config(user, sf) -> SalesforceConfig:
    from django.conf import settings
    config, _ = SalesforceConfig.objects.get_or_create(
        user=user,
        defaults={"instance_url": settings.SALESFORCE_INSTANCE_URL},
    )
    if not config.namespace:
        config.namespace = discover_namespace(sf)

    # Fetch SF user identity
    try:
        identity = sf.restful("chatter/users/me", method="GET")
        config.sf_user_id = identity.get("id", "")
        config.sf_user_email = identity.get("email", "")
    except Exception:
        pass

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


def sync_projects(sf, ns: str) -> int:
    query = (
        f"SELECT Id, Name, {ns}__Status__c, {ns}__Description__c, "
        f"{ns}__Start_Date__c, {ns}__End_Date__c, "
        f"AccountId, Account.Name, OwnerId, Owner.Name "
        f"FROM {ns}__Project__c WHERE IsDeleted = false "
        f"ORDER BY {ns}__Start_Date__c DESC NULLS LAST LIMIT 200"
    )
    result = sf.query_all(query)
    count = 0
    for rec in result.get("records", []):
        account = None
        if rec.get("AccountId"):
            account = SalesforceAccount.objects.filter(sf_id=rec["AccountId"]).first()

        owner = rec.get("Owner") or {}
        SalesforceProject.objects.update_or_create(
            sf_id=rec["Id"],
            defaults={
                "account": account,
                "name": _str(rec.get("Name")),
                "status": _str(rec.get(f"{ns}__Status__c")),
                "description": _str(rec.get(f"{ns}__Description__c")),
                "start_date": _parse_date(rec.get(f"{ns}__Start_Date__c")),
                "end_date": _parse_date(rec.get(f"{ns}__End_Date__c")),
                "owner_sf_id": _str(rec.get("OwnerId")),
                "owner_name": _str(owner.get("Name")),
            },
        )
        count += 1
    logger.info("sync_projects: %d records", count)
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
    sf = get_client(user)
    config = _get_or_create_config(user, sf)
    ns = config.namespace

    accounts = sync_accounts(sf)
    projects = sync_projects(sf, ns)
    members = sync_project_members(sf, ns)
    tasks = sync_tasks(sf, ns)

    return {
        "accounts": accounts,
        "projects": projects,
        "members": members,
        "tasks": tasks,
        "namespace": ns,
    }
