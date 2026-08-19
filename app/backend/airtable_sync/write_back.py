"""
Write-through helpers — push local changes to Airtable immediately.

These are called from viewset hooks (perform_create, perform_update,
perform_destroy) so that the local Django DB and Airtable stay in sync
without waiting for the 30-minute reconciliation sync.

Every function is safe to call from any context: errors are logged and
never re-raised so a failing Airtable write never blocks the local save.
"""

import logging
import time

from django.conf import settings

from .airtable_client import get_table, TABLE_ACCOUNTS, TABLE_ACTION_ITEMS, TABLE_MEETINGS

TABLE_ARTIFACTS = getattr(settings, "AIRTABLE_TABLE_ARTIFACTS", "")


def _airtable_call(fn, *args, **kwargs):
    """Call an Airtable API function with exponential backoff on HTTP 429."""
    delay = 1
    for attempt in range(5):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429 and attempt < 4:
                logger.warning("Airtable rate limited (429); retrying in %ds (attempt %d/5)", delay, attempt + 1)
                time.sleep(delay)
                delay = min(delay * 2, 16)
            else:
                raise

TABLE_CONTACTS = getattr(settings, "AIRTABLE_TABLE_CONTACTS", "")

logger = logging.getLogger(__name__)


# ── Accounts ──────────────────────────────────────────────────────────────────

def _account_fields(account) -> dict:
    """Map a Django Account instance to Airtable field names.

    The Airtable Accounts table schema only has: Account Name, Email Domain,
    Health Score, Next Meeting, Open Ticket Count, Salesforce Account ID,
    Time Budget, Total Meeting Duration, Last Sync — most are computed/synced
    fields. We only write the fields we own.
    """
    fields: dict = {"Account Name": account.company_name}
    # Extract email domain from website if present (e.g. https://acme.com -> acme.com)
    if account.website:
        domain = account.website.removeprefix("https://").removeprefix("http://").split("/")[0]
        if domain:
            fields["Email Domain"] = domain
    return fields


def push_account_create(account) -> str | None:
    """
    Create a new record in the Airtable Accounts table.
    Returns the Airtable record ID on success, None on failure.
    """
    try:
        table = get_table(TABLE_ACCOUNTS)
        record = _airtable_call(table.create, _account_fields(account))
        logger.info("Created Airtable account record %s for '%s'", record["id"], account.company_name)
        return record["id"]
    except Exception:
        logger.exception("Failed to create Airtable account for '%s'", account.company_name)
        return None


def push_account_update(account) -> bool:
    """
    Update an existing record in the Airtable Accounts table.
    Requires account.airtable_id to be set. Returns True on success.
    """
    if not account.airtable_id:
        logger.warning("push_account_update called with no airtable_id on account %s", account.pk)
        return False
    try:
        table = get_table(TABLE_ACCOUNTS)
        _airtable_call(table.update, account.airtable_id, _account_fields(account))
        logger.info("Updated Airtable account record %s", account.airtable_id)
        return True
    except Exception:
        logger.exception("Failed to update Airtable account %s", account.airtable_id)
        return False


def push_account_delete(airtable_id: str) -> bool:
    """Delete a record from the Airtable Accounts table. Returns True on success."""
    if not airtable_id:
        return False
    try:
        table = get_table(TABLE_ACCOUNTS)
        _airtable_call(table.delete, airtable_id)
        logger.info("Deleted Airtable account record %s", airtable_id)
        return True
    except Exception:
        logger.exception("Failed to delete Airtable account %s", airtable_id)
        return False


# ── Action Items ──────────────────────────────────────────────────────────────

# Map our internal values → Airtable select option names
_STATUS_TO_AT = {
    "Open": "Not Started",
    "In Progress": "In Progress",
    "Done": "Done",
    "Blocked": "Blocked",
}
_PRIORITY_TO_AT = {
    "Critical": "Urgent",
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
}


def _action_item_fields(item, account_airtable_id: str | None = None) -> dict:
    """Map a Django AirtableActionItem instance to Airtable field names."""
    fields: dict = {"Task": item.task}
    if item.status:
        fields["Status"] = _STATUS_TO_AT.get(item.status, item.status)
    if item.priority:
        fields["Priority"] = _PRIORITY_TO_AT.get(item.priority, item.priority)
    if item.due_date:
        due = item.due_date
        fields["Due Date"] = due.isoformat() if hasattr(due, "isoformat") else str(due)
    if item.estimated_time:
        fields["Estimated Time"] = item.estimated_time // 60
    if item.time_spent:
        fields["Time Spent"] = item.time_spent // 60
    if item.prep_time:
        fields["Prep Time"] = item.prep_time // 60
    if item.slack_thread_url:
        fields["Slack Thread URL"] = item.slack_thread_url
    if item.marked_done_at:
        fields["Marked Done At"] = item.marked_done_at.isoformat()
    # Link to account record if we know the Airtable account ID
    at_account_id = account_airtable_id or (item.account.airtable_id if item.account else None)
    if at_account_id:
        fields["Account"] = [at_account_id]
    return fields


def push_action_item_create(item, account_airtable_id: str | None = None) -> str | None:
    """
    Create a new record in the Airtable Action Items table.
    Returns the Airtable record ID on success, None on failure.
    """
    try:
        table = get_table(TABLE_ACTION_ITEMS)
        record = _airtable_call(table.create, _action_item_fields(item, account_airtable_id))
        logger.info("Created Airtable action item record %s for '%s'", record["id"], item.task)
        return record["id"]
    except Exception:
        logger.exception("Failed to create Airtable action item for '%s'", item.task)
        return None


def push_action_item_update(item) -> bool:
    """
    Update an existing record in the Airtable Action Items table.
    Requires item.airtable_id to be set. Returns True on success.
    """
    if not item.airtable_id:
        logger.warning("push_action_item_update called with no airtable_id on item %s", item.pk)
        return False
    try:
        table = get_table(TABLE_ACTION_ITEMS)
        _airtable_call(table.update, item.airtable_id, _action_item_fields(item))
        logger.info("Updated Airtable action item record %s", item.airtable_id)
        return True
    except Exception:
        logger.exception("Failed to update Airtable action item %s", item.airtable_id)
        return False


def push_action_item_delete(airtable_id: str) -> bool:
    """Delete a record from the Airtable Action Items table. Returns True on success."""
    if not airtable_id:
        return False
    try:
        table = get_table(TABLE_ACTION_ITEMS)
        _airtable_call(table.delete, airtable_id)
        logger.info("Deleted Airtable action item record %s", airtable_id)
        return True
    except Exception:
        logger.exception("Failed to delete Airtable action item %s", airtable_id)
        return False


# ── Meetings ──────────────────────────────────────────────────────────────────

def _meeting_fields(meeting) -> dict:
    """Map a Django AirtableMeeting instance to Airtable field names.

    Deliberately omits the Zoom pair. This dict is passed to `table.create` when a
    local stub is promoted, and Airtable rejects the whole create with
    UNKNOWN_FIELD_NAME if any key is missing from the base. Zoom Notes / Zoom URL are
    newer columns that may not exist yet, so they are pushed by a separate, isolated
    call (`push_meeting_zoom_notes`) where a missing column costs only that write.
    """
    fields: dict = {}
    if meeting.name:
        fields["Name"] = meeting.name
    if meeting.date:
        fields["Date"] = meeting.date.isoformat()
    if meeting.gong_notes:
        fields["Gong Notes"] = meeting.gong_notes
    if meeting.gong_url:
        fields["Gong URL"] = meeting.gong_url
    if meeting.account and meeting.account.airtable_id:
        fields["Account"] = [meeting.account.airtable_id]
    return fields


def _promote_stub_meeting(meeting, table) -> str:
    """Create a real Airtable record for a 'local-' stub and adopt the returned ID.

    Also rewrites any CalendarEvent pointing at the stub ID so the next write
    resolves straight to the real record. Returns the new Airtable record ID.
    """
    fields = _meeting_fields(meeting)
    if not fields.get("Name"):
        fields["Name"] = f"Meeting {meeting.pk}"
    record = _airtable_call(table.create, fields)
    real_id = record["id"]
    from scheduler.models import CalendarEvent
    CalendarEvent.objects.filter(agentpm_airtable_id=meeting.airtable_id).update(
        agentpm_airtable_id=real_id
    )
    meeting.airtable_id = real_id
    meeting.save(update_fields=["airtable_id"])
    logger.info("Promoted stub meeting pk=%s to Airtable record %s", meeting.pk, real_id)
    return real_id


def push_meeting_gong_notes(meeting) -> bool:
    """
    Push updated gong_notes for a meeting to Airtable.

    If the meeting is a local stub (airtable_id starts with 'local-'), creates
    a new Airtable record and replaces the stub ID with the real one so future
    writes go directly to the correct record.
    """
    if not meeting.airtable_id:
        logger.warning("push_meeting_gong_notes called with no airtable_id on meeting %s", meeting.pk)
        return False
    try:
        table = get_table(TABLE_MEETINGS)
        if meeting.airtable_id.startswith("local-"):
            # `_meeting_fields` already carries gong_notes, so the create is the push.
            _promote_stub_meeting(meeting, table)
        else:
            _airtable_call(table.update, meeting.airtable_id, {"Gong Notes": meeting.gong_notes})
            logger.info("Updated Airtable meeting gong_notes for record %s", meeting.airtable_id)
        return True
    except Exception:
        logger.exception("Failed to push Airtable meeting %s gong_notes", meeting.airtable_id)
        return False


def push_meeting_zoom_notes(meeting) -> bool:
    """
    Push updated zoom_notes / zoom_url for a meeting to Airtable.

    Runs as its own request rather than joining the Gong payload: "Zoom Notes" and
    "Zoom URL" are newer columns, and if they are absent from the base Airtable fails
    the entire update with UNKNOWN_FIELD_NAME. Isolating the call means a base that
    hasn't grown the columns yet loses only the Zoom mirror — the notes are still saved
    locally and the Gong push is unaffected. Returns False (and logs) in that case.
    """
    if not meeting.airtable_id:
        logger.warning("push_meeting_zoom_notes called with no airtable_id on meeting %s", meeting.pk)
        return False
    try:
        table = get_table(TABLE_MEETINGS)
        if meeting.airtable_id.startswith("local-"):
            _promote_stub_meeting(meeting, table)
        fields = {"Zoom Notes": meeting.zoom_notes}
        if meeting.zoom_url:
            fields["Zoom URL"] = meeting.zoom_url
        _airtable_call(table.update, meeting.airtable_id, fields)
        logger.info("Updated Airtable meeting zoom_notes for record %s", meeting.airtable_id)
        return True
    except Exception:
        logger.exception(
            "Failed to push Airtable meeting %s zoom_notes — if the Airtable Meetings "
            "table has no 'Zoom Notes' / 'Zoom URL' column, add them to enable the mirror. "
            "The notes are saved locally either way.",
            meeting.airtable_id,
        )
        return False


# ── Customer Contacts ─────────────────────────────────────────────────────────

def _contact_fields(contact) -> dict:
    fields: dict = {"Name": contact.name}
    if contact.role:
        fields["Role"] = contact.role
    if contact.description:
        fields["Description"] = contact.description
    if contact.email:
        fields["Email"] = contact.email
    # Link to Airtable account record if we have one
    if contact.account and contact.account.airtable_id:
        fields["Account"] = [contact.account.airtable_id]
    return fields


def push_customer_contact_create(contact) -> str | None:
    if not TABLE_CONTACTS:
        return None
    try:
        table = get_table(TABLE_CONTACTS)
        record = _airtable_call(table.create, _contact_fields(contact))
        contact.airtable_id = record["id"]
        contact.save(update_fields=["airtable_id"])
        logger.info("Created Airtable contact record %s for '%s'", record["id"], contact.name)
        return record["id"]
    except Exception:
        logger.exception("Failed to create Airtable contact for '%s'", contact.name)
        return None


def push_customer_contact_update(contact) -> bool:
    if not TABLE_CONTACTS or not contact.airtable_id:
        return False
    try:
        table = get_table(TABLE_CONTACTS)
        _airtable_call(table.update, contact.airtable_id, _contact_fields(contact))
        logger.info("Updated Airtable contact record %s", contact.airtable_id)
        return True
    except Exception:
        logger.exception("Failed to update Airtable contact %s", contact.airtable_id)
        return False


def push_customer_contact_delete(airtable_id: str) -> bool:
    if not TABLE_CONTACTS or not airtable_id:
        return False
    try:
        table = get_table(TABLE_CONTACTS)
        _airtable_call(table.delete, airtable_id)
        logger.info("Deleted Airtable contact record %s", airtable_id)
        return True
    except Exception:
        logger.exception("Failed to delete Airtable contact %s", airtable_id)
        return False


# ── Account Artifacts ─────────────────────────────────────────────────────────

def _artifact_fields(artifact) -> dict:
    return {
        "Name": artifact.name,
        "Account Name": artifact.account.company_name if artifact.account else "",
        "Type": artifact.artifact_type,
        "URL": artifact.url or "",
        "MIME Type": artifact.mime_type or "",
        "File Size (bytes)": artifact.file_size or 0,
        "Uploaded By": (
            artifact.uploaded_by.get_full_name() or artifact.uploaded_by.username
            if artifact.uploaded_by else ""
        ),
        "Created At": artifact.created_at.isoformat() if artifact.created_at else "",
        "Django ID": artifact.id,
    }


def push_artifact_upsert(artifact) -> bool:
    """Create or update an artifact record in Airtable using Django ID as the stable key."""
    if not TABLE_ARTIFACTS:
        return False
    try:
        table = get_table(TABLE_ARTIFACTS)
        _airtable_call(table.batch_upsert, [{"fields": _artifact_fields(artifact)}], key_fields=["Django ID"])
        logger.info("Upserted Airtable artifact for Django ID %s ('%s')", artifact.id, artifact.name)
        return True
    except Exception:
        logger.exception("Failed to upsert Airtable artifact for Django ID %s", artifact.id)
        return False


def push_artifact_delete_by_django_id(django_id: int) -> bool:
    """Delete the Airtable artifact record matching the given Django ID."""
    if not TABLE_ARTIFACTS:
        return False
    try:
        table = get_table(TABLE_ARTIFACTS)
        matches = _airtable_call(
            table.all,
            formula=f"{{Django ID}}={django_id}",
        )
        for record in matches:
            _airtable_call(table.delete, record["id"])
            logger.info("Deleted Airtable artifact record %s (Django ID %s)", record["id"], django_id)
        return True
    except Exception:
        logger.exception("Failed to delete Airtable artifact for Django ID %s", django_id)
        return False


# ── Working Sessions ──────────────────────────────────────────────────────────

TABLE_WORKING_SESSIONS = getattr(settings, "AIRTABLE_TABLE_WORKING_SESSIONS", "")

import json as _json


def _working_session_fields(session) -> dict:
    return {
        "Name": session.name,
        "Owner": session.owner.username if session.owner else "",
        "RecordRefs": _json.dumps(session.record_refs),
        "CanvasNodes": _json.dumps(session.canvas_nodes),
        "Django ID": session.id,
    }


def push_working_session_create(session) -> str | None:
    if not TABLE_WORKING_SESSIONS:
        return None
    try:
        table = get_table(TABLE_WORKING_SESSIONS)
        record = _airtable_call(table.create, _working_session_fields(session))
        logger.info("Created Airtable working session record %s for '%s'", record["id"], session.name)
        return record["id"]
    except Exception:
        logger.exception("Failed to create Airtable working session for '%s'", session.name)
        return None


def push_working_session_update(session) -> bool:
    if not TABLE_WORKING_SESSIONS or not session.airtable_id:
        return False
    try:
        table = get_table(TABLE_WORKING_SESSIONS)
        _airtable_call(table.update, session.airtable_id, _working_session_fields(session))
        return True
    except Exception:
        logger.exception("Failed to update Airtable working session %s", session.airtable_id)
        return False


def push_working_session_delete(airtable_id: str) -> bool:
    if not TABLE_WORKING_SESSIONS or not airtable_id:
        return False
    try:
        table = get_table(TABLE_WORKING_SESSIONS)
        _airtable_call(table.delete, airtable_id)
        return True
    except Exception:
        logger.exception("Failed to delete Airtable working session %s", airtable_id)
        return False
