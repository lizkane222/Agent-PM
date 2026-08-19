"""
Airtable → local DB sync. Run via Celery beat every 30 minutes,
or call sync_all() directly for an immediate sync.
"""
import logging
import time
from datetime import datetime

from django.utils.dateparse import parse_datetime

from django.conf import settings

from .airtable_client import get_table, TABLE_ACCOUNTS, TABLE_ACTION_ITEMS, TABLE_MEETINGS
from .models import AirtableAccount, AirtableActionItem, AirtableMeeting

logger = logging.getLogger(__name__)


# ── Airtable → scheduler.ActionItem mirror ────────────────────────────────────
#
# The frontend writes action items via `airtable_sync.AirtableActionItem`.
# `scheduler.ActionItem` is a parallel Django-native model. To keep both in
# lockstep we upsert the Django row after every Airtable write, keyed by
# `airtable_record_id`. Reads stay canonical to Airtable.

_STATUS_AT_TO_SCHEDULER = {
    "Open": "open",
    "In Progress": "in_progress",
    "Done": "done",
    "Blocked": "open",       # blocked is still "open" in the scheduler taxonomy
    "Backlogged": "open",
}
_PRIORITY_AT_TO_SCHEDULER = {
    "Low": "low",
    "Medium": "normal",
    "High": "high",
    "Critical": "urgent",
}


def _resolve_scheduler_account(air_item: AirtableActionItem):
    if not air_item.account_id:
        return None
    # local imports to avoid circular deps
    from accounts.models import (
        ADMIN_ACCOUNT_NAME,
        Account,
        get_or_create_admin_account,
    )

    # The shared Airtable "Admin" account has no shared Django counterpart — admin
    # accounts are per-user workspaces. Route each item to its assignee's own Admin.
    # An unassigned Admin item carries no owner, so it gets no account at all (same
    # rule AirtableActionItemViewSet applies when deciding Admin item visibility).
    if (air_item.account.name or "").strip().lower() == ADMIN_ACCOUNT_NAME.lower():
        assignee = _resolve_scheduler_user(air_item.assignee_airtable_id)
        return get_or_create_admin_account(assignee) if assignee else None

    return Account.objects.filter(airtable_id=air_item.account.airtable_id).first()


def _resolve_scheduler_user(assignee_airtable_id: str):
    if not assignee_airtable_id:
        return None
    from team.models import UserProfile  # local import to avoid circular deps
    profile = UserProfile.objects.filter(airtable_collaborator_id=assignee_airtable_id).select_related("user").first()
    return profile.user if profile else None


def mirror_action_item_to_scheduler(air_item: AirtableActionItem) -> None:
    """Upsert `scheduler.ActionItem` from an `AirtableActionItem`, keyed by airtable_id.

    Safe to call inside a request handler — swallows and logs any errors so that
    a Django-side mirror failure never fails the Airtable-facing write.
    """
    if not air_item or not air_item.airtable_id:
        return
    try:
        from scheduler.models import ActionItem as SchedulerActionItem  # local import
        defaults = {
            "title": air_item.task[:500] if air_item.task else "",
            "notes": air_item.task_details or "",
            "priority": _PRIORITY_AT_TO_SCHEDULER.get(air_item.priority, "normal"),
            "status": _STATUS_AT_TO_SCHEDULER.get(air_item.status, "open"),
            "due_date": air_item.due_date.date() if air_item.due_date else None,
            "account": _resolve_scheduler_account(air_item),
            "assigned_to": _resolve_scheduler_user(air_item.assignee_airtable_id),
        }
        SchedulerActionItem.objects.update_or_create(
            airtable_record_id=air_item.airtable_id,
            defaults=defaults,
        )
    except Exception:
        logger.exception("mirror_action_item_to_scheduler: failed for airtable_id=%s", air_item.airtable_id)


def unmirror_action_item(airtable_id: str) -> None:
    """Delete the mirrored `scheduler.ActionItem` for a removed AirtableActionItem."""
    if not airtable_id:
        return
    try:
        from scheduler.models import ActionItem as SchedulerActionItem  # local import
        SchedulerActionItem.objects.filter(airtable_record_id=airtable_id).delete()
    except Exception:
        logger.exception("unmirror_action_item: failed for airtable_id=%s", airtable_id)


def _batch_delete_stale(table, local_ids: set, id_field: str = "Django ID"):
    """
    Fetch all Airtable records, batch-delete those whose id_field value is not
    in local_ids. Uses a single table.all() call and pyairtable's batch_delete
    to stay under Airtable's 5 req/s limit.
    """
    stale_at_ids = [
        r["id"] for r in table.all()
        if (did := r["fields"].get(id_field)) and int(did) not in local_ids
    ]
    if stale_at_ids:
        table.batch_delete(stale_at_ids)
        logger.info("batch_delete_stale: removed %d stale records", len(stale_at_ids))
    return len(stale_at_ids)


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return parse_datetime(str(value))


def _str(value) -> str:
    if not value:
        return ""
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def sync_accounts() -> int:
    from accounts.models import Account as DjangoAccount

    table = get_table(TABLE_ACCOUNTS)
    seen_ids = set()
    upserted = 0
    for record in table.all():
        f = record["fields"]
        AirtableAccount.objects.update_or_create(
            airtable_id=record["id"],
            defaults={
                "name": _str(f.get("Account Name", "")),
                "email_domain": _str(f.get("Email Domain", "")),
                "health_score": _str(f.get("Health Score", "")),
                "next_meeting": _parse_dt(f.get("Next Meeting")),
                "open_ticket_count": int(f.get("Open Ticket Count") or 0),
                "time_budget": int(f.get("Time Budget") or 0),
                "total_meeting_duration": int(f.get("Total Meeting Duration") or 0),
                "salesforce_account_id": _str(f.get("Salesforce Account ID", "")),
                "segment_workspaces": _str(f.get("Segment Workspaces", "")),
            },
        )
        seen_ids.add(record["id"])
        upserted += 1
    deleted, _ = AirtableAccount.objects.exclude(airtable_id__in=seen_ids).delete()
    if deleted:
        logger.info("sync_accounts: deleted %d stale AirtableAccount records", deleted)

    # Also remove Account rows that were sourced from Airtable but no longer exist there.
    # Only target rows with a non-empty airtable_id so manually-created accounts are preserved.
    acct_deleted, _ = DjangoAccount.objects.filter(airtable_id__gt="").exclude(airtable_id__in=seen_ids).delete()
    if acct_deleted:
        logger.info("sync_accounts: deleted %d stale Account records", acct_deleted)

    logger.info("sync_accounts: upserted %d records", upserted)
    return upserted


def sync_meetings() -> int:
    table = get_table(TABLE_MEETINGS)
    seen_ids = set()
    upserted = 0
    for record in table.all():
        f = record["fields"]
        account_ids = f.get("Account", [])
        account = None
        if account_ids:
            account = AirtableAccount.objects.filter(airtable_id=account_ids[0]).first()

        at_gong_notes = _str(f.get("Gong Notes", ""))
        at_zoom_notes = _str(f.get("Zoom Notes", ""))
        at_zoom_url = _str(f.get("Zoom URL", ""))
        defaults = {
            "account": account,
            "name": _str(f.get("Name", "")),
            "date": _parse_dt(f.get("Date")),
            "duration": int(f.get("Duration") or 0),
            "expected_topics": _str(f.get("Expected Topics", "")),
            "gong_url": _str(f.get("Gong URL", "")),
            "customer_slack": _str(f.get("Customer Slack", "")),
            "account_team_slack": _str(f.get("Account Team Slack", "")),
        }
        # Only overwrite notes from Airtable when Airtable actually has content —
        # prevents a sync cycle from blanking locally-saved notes before write-through
        # completes.
        #
        # The check is `.strip()`, not truthiness: Airtable's richText fields (which is
        # what both Notes columns are) normalise a cleared value to "\n" rather than "",
        # and never drop the key again once written. A bare truthiness test therefore
        # reads an empty Airtable cell as content, overwrites the local notes with "\n",
        # and — because "\n" is itself truthy — makes the meeting look already-summarised
        # to the recap-email scanner, which then skips it forever.
        if at_gong_notes.strip():
            defaults["gong_notes"] = at_gong_notes
        # Same guard for the Zoom pair. These columns may be absent from a base that
        # hasn't run `manage.py ensure_airtable_zoom_fields`, in which case `fields`
        # simply omits them and the local values are preserved.
        if at_zoom_notes.strip():
            defaults["zoom_notes"] = at_zoom_notes
        if at_zoom_url.strip():
            defaults["zoom_url"] = at_zoom_url
        AirtableMeeting.objects.update_or_create(
            airtable_id=record["id"],
            defaults=defaults,
        )
        seen_ids.add(record["id"])
        upserted += 1
    # Preserve local stubs (airtable_id starts with "local-") — they haven't been
    # promoted to real Airtable records yet, so they won't be in seen_ids.
    deleted, _ = AirtableMeeting.objects.exclude(airtable_id__in=seen_ids).exclude(
        airtable_id__startswith="local-"
    ).delete()
    if deleted:
        logger.info("sync_meetings: deleted %d stale records", deleted)
    logger.info("sync_meetings: upserted %d records", upserted)
    return upserted


_AT_TO_STATUS = {
    "Not Started": "Open",
    "In Progress": "In Progress",
    "Completed": "Done",  # renamed in Airtable from "Completed" → "Done"
    "Done": "Done",
    "Blocked": "Blocked",
    "Backlogged": "Backlogged",
    "Ready": "Open",
}
_AT_TO_PRIORITY = {
    "Urgent": "Critical",
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
}


def sync_action_items() -> int:
    table = get_table(TABLE_ACTION_ITEMS)
    seen_ids = set()
    upserted = 0
    for record in table.all():
        f = record["fields"]
        account_ids = f.get("Account", [])
        account = None
        if account_ids:
            account = AirtableAccount.objects.filter(airtable_id=account_ids[0]).first()

        # Assignee is a multipleCollaborators or singleCollaborator field —
        # Airtable returns a list of {"id": "usrXXX", "name": "...", "email": "..."}.
        assignee_list = f.get("Assignee") or []
        if isinstance(assignee_list, dict):
            assignee_list = [assignee_list]
        assignee_airtable_id = assignee_list[0].get("id", "") if assignee_list else ""
        assignee_name = assignee_list[0].get("name", "") if assignee_list else ""

        defaults = {
            "account": account,
            "task": _str(f.get("Task", "")),
            "task_details": _str(f.get("Task Details", "")),
            "status": _AT_TO_STATUS.get(_str(f.get("Status", "")), "Open") or "Open",
            "priority": _AT_TO_PRIORITY.get(_str(f.get("Priority", "")), "Medium") or "Medium",
            "due_date": _parse_dt(f.get("Due Date")),
            "estimated_time": int(f.get("Estimated Time") or 0) * 60,
            "time_spent": int(f.get("Time Spent") or 0) * 60,
            "prep_time": int(f.get("Prep Time") or 0) * 60,
            "slack_thread_url": _str(f.get("Slack Thread URL", "")),
            "salesforce_task_id": _str(f.get("Salesforce Task ID", "")),
            "assignee_airtable_id": assignee_airtable_id,
            "assignee_name": assignee_name,
        }
        if f.get("Marked Done At"):
            defaults["marked_done_at"] = _parse_dt(f.get("Marked Done At"))
        air_item, _ = AirtableActionItem.objects.update_or_create(
            airtable_id=record["id"],
            defaults=defaults,
        )
        mirror_action_item_to_scheduler(air_item)
        seen_ids.add(record["id"])
        upserted += 1
    stale_ids = list(
        AirtableActionItem.objects.exclude(airtable_id__in=seen_ids).values_list("airtable_id", flat=True)
    )
    for stale_id in stale_ids:
        unmirror_action_item(stale_id)
    deleted, _ = AirtableActionItem.objects.exclude(airtable_id__in=seen_ids).delete()
    if deleted:
        logger.info("sync_action_items: deleted %d stale records", deleted)
    logger.info("sync_action_items: upserted %d records", upserted)
    return upserted


def sync_artifacts() -> int:
    """Push all AccountArtifact rows to the Airtable Artifacts table.

    Uses Django ID as the stable upsert key so records are updated in-place
    rather than duplicated on re-sync.
    """
    table_id = getattr(settings, "AIRTABLE_TABLE_ARTIFACTS", "")
    if not table_id:
        logger.warning("sync_artifacts: AIRTABLE_TABLE_ARTIFACTS not configured, skipping")
        return 0

    from accounts.models import AccountArtifact  # local import to avoid circular deps

    table = get_table(table_id)

    artifacts = (
        AccountArtifact.objects
        .select_related("account", "uploaded_by")
        .all()
    )

    records = []
    for a in artifacts:
        records.append({"fields": {
            "Name": a.name,
            "Account Name": a.account.company_name if a.account else "",
            "Type": a.artifact_type,
            "URL": a.url or "",
            "MIME Type": a.mime_type or "",
            "File Size (bytes)": a.file_size or 0,
            "Uploaded By": (
                a.uploaded_by.get_full_name() or a.uploaded_by.username
                if a.uploaded_by else ""
            ),
            "Created At": a.created_at.isoformat() if a.created_at else "",
            "Django ID": a.id,
        }})

    if not records:
        logger.info("sync_artifacts: no artifacts to sync")
        return 0

    # batch_upsert merges on Django ID so re-syncs update rather than duplicate
    table.batch_upsert(records, key_fields=["Django ID"], replace=True)

    # Prune Airtable records whose Django ID no longer exists locally
    local_ids = set(artifacts.values_list("id", flat=True))
    _batch_delete_stale(table, local_ids, id_field="Django ID")

    logger.info("sync_artifacts: synced %d artifacts", len(records))
    return len(records)


def sync_action_item_attachments() -> int:
    """Push all ActionItemAttachment rows into the same Artifacts table used by AccountArtifact.

    Records are tagged with Source='Action Item' so the frontend can show them
    in a separate subsection. Uses a namespaced key 'Django ID (AI)' to avoid
    collisions with account-level artifacts.
    """
    table_id = getattr(settings, "AIRTABLE_TABLE_ARTIFACTS", "")
    if not table_id:
        return 0

    from .models import ActionItemAttachment  # local import to avoid circular deps

    table = get_table(table_id)

    attachments = (
        ActionItemAttachment.objects
        .select_related("action_item", "action_item__account", "uploaded_by")
        .all()
    )

    records = []
    for a in attachments:
        account_name = ""
        if a.action_item.account:
            account_name = a.action_item.account.name
        records.append({"fields": {
            "Name": a.name,
            "Account Name": account_name,
            "Type": a.artifact_type,
            "URL": a.url or "",
            "MIME Type": a.mime_type or "",
            "File Size (bytes)": a.file_size or 0,
            "Uploaded By": (
                a.uploaded_by.get_full_name() or a.uploaded_by.username
                if a.uploaded_by else ""
            ),
            "Created At": a.created_at.isoformat() if a.created_at else "",
            "Source": "Action Item",
            "Action Item Task": a.action_item.task,
            "Django ID (AI)": a.id,
        }})

    if not records:
        logger.info("sync_action_item_attachments: no attachments to sync")
        return 0

    table.batch_upsert(records, key_fields=["Django ID (AI)"], replace=True)

    # Prune stale records that came from action items — use a single table scan
    local_ids = set(attachments.values_list("id", flat=True))
    stale = [
        r["id"] for r in table.all()
        if r["fields"].get("Source") == "Action Item"
        and (did := r["fields"].get("Django ID (AI)"))
        and int(did) not in local_ids
    ]
    if stale:
        table.batch_delete(stale)

    logger.info("sync_action_item_attachments: synced %d attachments", len(records))
    return len(records)


def sync_claude_skills() -> int:
    """Push all ClaudeSkill rows to the Airtable Claude Skills table.

    Uses Django ID as the stable upsert key so re-syncs update in-place
    rather than duplicating records.
    """
    table_id = getattr(settings, "AIRTABLE_TABLE_CLAUDE_SKILLS", "")
    if not table_id:
        logger.warning("sync_claude_skills: AIRTABLE_TABLE_CLAUDE_SKILLS not configured, skipping")
        return 0

    from skills.models import ClaudeSkill

    table = get_table(table_id)
    skills = ClaudeSkill.objects.select_related("submitted_by").all()

    records = []
    for s in skills:
        submitted_by = ""
        if s.submitted_by:
            submitted_by = s.submitted_by.get_full_name() or s.submitted_by.username
        records.append({"fields": {
            "Django ID": s.id,
            "Name": s.name,
            "Description": s.description,
            "Command": s.command or "",
            "Roles": ", ".join(s.roles) if s.roles else "",
            "Status": s.status,
            "Review Feedback": s.review_feedback or "",
            "Review Suggestions": s.review_suggestions or "",
            "Reviewed At": s.reviewed_at.isoformat() if s.reviewed_at else "",
            "Invocation Count": s.invocation_count,
            "Last Invoked At": s.last_invoked_at.isoformat() if s.last_invoked_at else "",
            "Submitted By": submitted_by,
        }})

    if not records:
        logger.info("sync_claude_skills: no skills to sync")
        return 0

    table.batch_upsert(records, key_fields=["Django ID"], replace=True)

    # Prune Airtable records whose Django ID no longer exists locally
    local_ids = set(skills.values_list("id", flat=True))
    _batch_delete_stale(table, local_ids, id_field="Django ID")

    logger.info("sync_claude_skills: synced %d skills", len(records))
    return len(records)


def sync_comments() -> int:
    """Push all Comment rows to the Airtable Comments table."""
    table_id = getattr(settings, "AIRTABLE_TABLE_COMMENTS", "")
    if not table_id:
        logger.warning("sync_comments: AIRTABLE_TABLE_COMMENTS not configured, skipping")
        return 0

    from comments.models import Comment

    table = get_table(table_id)
    comments = Comment.objects.select_related("author", "parent").all()

    records = []
    for c in comments:
        author_name = ""
        if c.author:
            author_name = c.author.get_full_name() or c.author.username
        records.append({"fields": {
            "Django ID": c.id,
            "Resource Type": c.resource_type,
            "Resource ID": c.resource_id,
            "Resource Label": c.resource_label,
            "Author": author_name,
            "Content": c.content,
            "Parent ID": c.parent_id or "",
            "Created At": c.created_at.isoformat() if c.created_at else "",
        }})

    if not records:
        logger.info("sync_comments: no comments to sync")
        return 0

    table.batch_upsert(records, key_fields=["Django ID"], replace=True)

    local_ids = set(comments.values_list("id", flat=True))
    _batch_delete_stale(table, local_ids, id_field="Django ID")

    logger.info("sync_comments: synced %d comments", len(records))
    return len(records)


def sync_feedback() -> int:
    """Push all Feedback rows to the Airtable Feedback table."""
    table_id = getattr(settings, "AIRTABLE_TABLE_FEEDBACK", "")
    if not table_id:
        logger.warning("sync_feedback: AIRTABLE_TABLE_FEEDBACK not configured, skipping")
        return 0

    from feedback.models import Feedback

    table = get_table(table_id)
    items = Feedback.objects.select_related("author").all()

    records = []
    for f in items:
        author_name = ""
        if f.author:
            author_name = f.author.get_full_name() or f.author.username
        records.append({"fields": {
            "Django ID": f.id,
            "Author": author_name,
            "Description": f.description,
            "Element Label": f.element_label,
            "Element Path": f.element_path,
            "Page URL": f.page_url,
            "Status": f.status,
            "Created At": f.created_at.isoformat() if f.created_at else "",
        }})

    if not records:
        logger.info("sync_feedback: no feedback to sync")
        return 0

    table.batch_upsert(records, key_fields=["Django ID"], replace=True)

    local_ids = set(items.values_list("id", flat=True))
    _batch_delete_stale(table, local_ids, id_field="Django ID")

    logger.info("sync_feedback: synced %d items", len(records))
    return len(records)


def sync_working_sessions() -> int:
    from layouts.models import WorkingSession
    from django.contrib.auth import get_user_model
    User = get_user_model()

    table_id = getattr(settings, "AIRTABLE_TABLE_WORKING_SESSIONS", "")
    if not table_id:
        return 0

    table = get_table(table_id)
    upserted = 0
    for record in table.all():
        f = record["fields"]
        django_id = f.get("Django ID")
        if not django_id:
            continue
        try:
            session = WorkingSession.objects.get(pk=int(django_id))
            if not session.airtable_id:
                session.airtable_id = record["id"]
                session.save(update_fields=["airtable_id"])
            upserted += 1
        except (WorkingSession.DoesNotExist, ValueError):
            continue
    return upserted


def backfill_missing_accounts() -> int:
    """
    Push any Django Account rows that have no airtable_id to Airtable.

    This handles the case where the write-through in perform_create silently
    failed (network error, rate limit, etc.) and the account was saved locally
    but never created in Airtable. Admin accounts are skipped — they're
    personal workspaces and don't belong in the shared Airtable base.
    """
    from accounts.models import Account as DjangoAccount
    from .write_back import push_account_create

    missing = DjangoAccount.objects.filter(airtable_id="", is_admin_account=False)
    pushed = 0
    for account in missing:
        airtable_id = push_account_create(account)
        if airtable_id:
            account.airtable_id = airtable_id
            account.save(update_fields=["airtable_id"])
            pushed += 1
            logger.info("backfill_missing_accounts: created Airtable record %s for '%s'", airtable_id, account.company_name)
        else:
            logger.warning("backfill_missing_accounts: failed to create Airtable record for '%s'", account.company_name)
    if pushed:
        logger.info("backfill_missing_accounts: pushed %d accounts", pushed)
    return pushed


def sync_all() -> dict:
    try:
        backfilled = backfill_missing_accounts()
    except Exception as e:
        logger.warning("backfill_missing_accounts failed (skipping): %s", e)
        backfilled = 0
    accounts = sync_accounts()
    meetings = sync_meetings()
    action_items = sync_action_items()
    try:
        artifacts = sync_artifacts()
    except Exception as e:
        logger.warning("sync_artifacts failed (skipping): %s", e)
        artifacts = 0
    try:
        action_item_attachments = sync_action_item_attachments()
    except Exception as e:
        logger.warning("sync_action_item_attachments failed (skipping): %s", e)
        action_item_attachments = 0
    try:
        comments = sync_comments()
    except Exception as e:
        logger.warning("sync_comments failed (skipping): %s", e)
        comments = 0
    try:
        claude_skills = sync_claude_skills()
    except Exception as e:
        logger.warning("sync_claude_skills failed (skipping): %s", e)
        claude_skills = 0
    try:
        feedback = sync_feedback()
    except Exception as e:
        logger.warning("sync_feedback failed (skipping): %s", e)
        feedback = 0
    try:
        working_sessions = sync_working_sessions()
    except Exception as e:
        logger.warning("sync_working_sessions failed (skipping): %s", e)
        working_sessions = 0
    return {
        "accounts_backfilled": backfilled,
        "accounts": accounts,
        "meetings": meetings,
        "action_items": action_items,
        "artifacts": artifacts,
        "action_item_attachments": action_item_attachments,
        "comments": comments,
        "claude_skills": claude_skills,
        "feedback": feedback,
        "working_sessions": working_sessions,
    }
