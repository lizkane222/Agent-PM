#!/usr/bin/env python
"""
CRUD Test Suite — validates Django ↔ Airtable write-back across all data pathways.
Run from the backend directory:
    cd /path/to/app/backend && .venv/bin/python ../scripts/crud_test.py
"""
import sys, os, uuid, uuid as _uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/../backend")
import dotenv
dotenv.load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django
django.setup()

from django.conf import settings
from airtable_sync.airtable_client import get_table, TABLE_ACTION_ITEMS, TABLE_ACCOUNTS

# New table IDs from settings
TABLE_CLAUDE_SKILLS   = settings.AIRTABLE_TABLE_CLAUDE_SKILLS
TABLE_REMINDERS       = settings.AIRTABLE_TABLE_REMINDERS
TABLE_ACTIVITY_LOG    = settings.AIRTABLE_TABLE_ACTIVITY_LOG
TABLE_VOICE_SESSIONS  = settings.AIRTABLE_TABLE_VOICE_SESSIONS
TABLE_ARTIFACTS       = settings.AIRTABLE_TABLE_ARTIFACTS
TABLE_TASKS           = settings.AIRTABLE_TABLE_TASKS
TABLE_TEAM_MEMBERS    = settings.AIRTABLE_TABLE_TEAM_MEMBERS
from airtable_sync.models import AirtableAccount, AirtableActionItem
from airtable_sync.write_back import (
    push_action_item_create,
    push_action_item_update,
    push_action_item_delete,
    push_account_create,
    push_account_update,
    push_account_delete,
)
from accounts.models import Account, AccountArtifact
from scheduler.models import Reminder, Task
from skills.models import ClaudeSkill, SkillInvocation
from realtime.models import AgentActivityEvent, VoiceSession
from team.models import TeamMember
from django.contrib.auth import get_user_model
User = get_user_model()

# ── Constants ─────────────────────────────────────────────────────────────────

JPMC_PK = 5
JPMC_AT_ID = "receKtHuzqPzViuVd"
BERXI_AT_ID = "recU6Mb9olif89CdO"
ASSIGNEE_ID = "usrF4PFCK8pXQ9a8i"
ASSIGNEE_NAME = "Liz Kane"

# ── Result tracking ───────────────────────────────────────────────────────────

results = []


def record(suite, test, passed, detail=""):
    results.append({"suite": suite, "test": test, "pass": passed, "detail": detail})
    status = "PASS" if passed else "FAIL"
    line = f"  [{status}] {test}"
    if detail:
        line += f"  ({detail})"
    print(line)


def check(suite, test, condition, detail=""):
    record(suite, test, bool(condition), detail)


# ── Airtable helpers ──────────────────────────────────────────────────────────

def at_get_ai(at_id):
    """Fetch fields dict for an Action Items record, or None on any error."""
    try:
        rec = get_table(TABLE_ACTION_ITEMS).get(at_id)
        return rec.get("fields", {})
    except Exception:
        return None


def at_get_acct(at_id):
    """Fetch fields dict for an Accounts record, or None on any error."""
    try:
        rec = get_table(TABLE_ACCOUNTS).get(at_id)
        return rec.get("fields", {})
    except Exception:
        return None


# ── Cleanup helpers ───────────────────────────────────────────────────────────

def cleanup_django_ai(pk):
    """Silently delete an AirtableActionItem Django record by pk."""
    try:
        AirtableActionItem.objects.filter(pk=pk).delete()
    except Exception:
        pass


def cleanup_at_ai(at_id):
    """Silently delete an Airtable Action Items record if it looks like a real ID."""
    if at_id and not str(at_id).startswith("pending-"):
        try:
            get_table(TABLE_ACTION_ITEMS).delete(at_id)
        except Exception:
            pass


def cleanup_django_acct(pk):
    """Silently delete an AirtableAccount Django record by pk."""
    try:
        AirtableAccount.objects.filter(pk=pk).delete()
    except Exception:
        pass


def cleanup_at_acct(at_id):
    """Silently delete an Airtable Accounts record if at_id is set."""
    if at_id and not str(at_id).startswith("pending-"):
        try:
            get_table(TABLE_ACCOUNTS).delete(at_id)
        except Exception:
            pass


def cleanup_app_acct(pk):
    """Silently delete an App Account Django record by pk."""
    try:
        Account.objects.filter(pk=pk).delete()
    except Exception:
        pass


# ── make_ai factory ───────────────────────────────────────────────────────────

def make_ai(**kwargs):
    """
    Create an AirtableActionItem with sensible defaults, push to Airtable,
    and return (item, at_id).
    """
    defaults = dict(
        airtable_id=f"pending-{uuid.uuid4().hex}",
        account_id=JPMC_PK,
        status="Open",
        priority="Medium",
        estimated_time=3600,
        time_spent=0,
        prep_time=900,
        due_date="2026-09-01 17:00:00+00:00",
        assignee_airtable_id=ASSIGNEE_ID,
        assignee_name=ASSIGNEE_NAME,
        slack_thread_url="",
        task_details="",
        salesforce_task_id="",
    )
    defaults.update(kwargs)
    item = AirtableActionItem.objects.create(**defaults)
    item.refresh_from_db()
    at_id = push_action_item_create(item)
    if at_id and not at_id.startswith("pending-"):
        item.airtable_id = at_id
        item.save(update_fields=["airtable_id"])
    return item, at_id


# ══════════════════════════════════════════════════════════════════════════════
# SUITE A — AirtableActionItem CRUD
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE A: AirtableActionItem CRUD ===")

SUITE_A = "Suite A"

item_a1 = None
at_id_a1 = None
item_a2 = None
at_id_a2 = None

try:
    # ── A1: Create, leave untouched ───────────────────────────────────────────
    item_a1, at_id_a1 = make_ai(
        task="CRUD Test: A1 Schedule Q3 stakeholder review",
        task_details="90-min review with all account stakeholders.",
        priority="High",
        estimated_time=5400,
        prep_time=1800,
        slack_thread_url="https://twilio.enterprise.slack.com/archives/C0264L92S87/p1111111111",
    )
    check(SUITE_A, "A1: Airtable record created",
          at_id_a1 is not None and not str(at_id_a1).startswith("pending-"))

    fields_a1 = at_get_ai(at_id_a1)
    check(SUITE_A, "A1: Task field matches",
          fields_a1 is not None and fields_a1.get("Task") == item_a1.task)
    check(SUITE_A, "A1: Status mapped Open→Not Started",
          fields_a1 is not None and fields_a1.get("Status") == "Not Started")
    check(SUITE_A, "A1: Priority correct",
          fields_a1 is not None and fields_a1.get("Priority") == "High")
    check(SUITE_A, "A1: Account linked in Airtable",
          fields_a1 is not None and JPMC_AT_ID in fields_a1.get("Account", []))
    check(SUITE_A, "A1: Django account FK correct",
          AirtableActionItem.objects.get(pk=item_a1.pk).account_id == JPMC_PK)

    # ── A2: Create then Update ────────────────────────────────────────────────
    item_a2, at_id_a2 = make_ai(
        task="CRUD Test: A2 Draft enterprise expansion proposal",
        status="Open",
        priority="Medium",
        estimated_time=7200,
        prep_time=3600,
    )
    check(SUITE_A, "A2: Airtable record created",
          at_id_a2 is not None and not str(at_id_a2).startswith("pending-"))

    item_a2.status = "In Progress"
    item_a2.priority = "High"
    item_a2.time_spent = 1800
    item_a2.task_details = "Updated: stakeholder review complete."
    item_a2.save(update_fields=["status", "priority", "time_spent", "task_details"])
    push_action_item_update(item_a2)

    fields_a2 = at_get_ai(at_id_a2)
    check(SUITE_A, "A2: Status update In Progress",
          fields_a2 is not None and fields_a2.get("Status") == "In Progress")
    check(SUITE_A, "A2: Priority update High",
          fields_a2 is not None and fields_a2.get("Priority") == "High")
    check(SUITE_A, "A2: Time Spent updated",
          fields_a2 is not None and fields_a2.get("Time Spent") == 1800)
    check(SUITE_A, "A2: Django status updated",
          AirtableActionItem.objects.get(pk=item_a2.pk).status == "In Progress")

    # ── A3: Create then Delete ────────────────────────────────────────────────
    item_a3, at_id_a3 = make_ai(
        task="CRUD Test: A3 Temp delete record",
        status="Blocked",
        priority="Low",
    )
    check(SUITE_A, "A3: Airtable record created",
          at_id_a3 is not None and not str(at_id_a3).startswith("pending-"))

    pk_a3 = item_a3.pk
    push_action_item_delete(item_a3.airtable_id)
    item_a3.delete()

    check(SUITE_A, "A3: Django record deleted",
          not AirtableActionItem.objects.filter(pk=pk_a3).exists())
    check(SUITE_A, "A3: Airtable record deleted",
          at_get_ai(at_id_a3) is None)

finally:
    # Cleanup A1 and A2
    if item_a1 is not None:
        cleanup_django_ai(item_a1.pk)
    cleanup_at_ai(at_id_a1)
    if item_a2 is not None:
        cleanup_django_ai(item_a2.pk)
    cleanup_at_ai(at_id_a2)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE B — AirtableAccount (Airtable-synced) CRUD
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE B: AirtableAccount CRUD ===")

SUITE_B = "Suite B"

at_id_b1 = None
django_b1 = None
at_id_b2 = None
django_b2 = None

try:
    at_table = get_table(TABLE_ACCOUNTS)

    # ── B1: Create, leave untouched ───────────────────────────────────────────
    at_rec_b1 = at_table.create({"Account Name": "CRUD Test: B1 Acme Corp"})
    at_id_b1 = at_rec_b1["id"]
    django_b1 = AirtableAccount.objects.create(
        airtable_id=at_id_b1,
        name="CRUD Test: B1 Acme Corp",
        email_domain="acmecorp.com",
        health_score="Green",
        open_ticket_count=3,
        time_budget=14400,
    )

    check(SUITE_B, "B1: Airtable record created", at_id_b1 is not None)

    fields_b1 = at_get_acct(at_id_b1)
    check(SUITE_B, "B1: Account Name in Airtable",
          fields_b1 is not None and fields_b1.get("Account Name") == "CRUD Test: B1 Acme Corp")
    check(SUITE_B, "B1: Django record exists",
          AirtableAccount.objects.filter(airtable_id=at_id_b1).exists())

    # ── B2: Create then Update ────────────────────────────────────────────────
    at_rec_b2 = at_table.create({"Account Name": "CRUD Test: B2 Global Logistics"})
    at_id_b2 = at_rec_b2["id"]
    django_b2 = AirtableAccount.objects.create(
        airtable_id=at_id_b2,
        name="CRUD Test: B2 Global Logistics",
    )

    check(SUITE_B, "B2: Airtable record created", at_id_b2 is not None)

    at_table.update(at_id_b2, {"Account Name": "CRUD Test: B2 Global Logistics (Renamed)"})
    django_b2.name = "CRUD Test: B2 Global Logistics (Renamed)"
    django_b2.save()

    fields_b2 = at_get_acct(at_id_b2)
    check(SUITE_B, "B2: Name updated in Airtable",
          fields_b2 is not None and fields_b2.get("Account Name") == "CRUD Test: B2 Global Logistics (Renamed)")
    check(SUITE_B, "B2: Name updated in Django",
          AirtableAccount.objects.get(airtable_id=at_id_b2).name == "CRUD Test: B2 Global Logistics (Renamed)")

    # ── B3: Create then Delete ────────────────────────────────────────────────
    at_rec_b3 = at_table.create({"Account Name": "CRUD Test: B3 Temp Delete Corp"})
    at_id_b3 = at_rec_b3["id"]
    django_b3 = AirtableAccount.objects.create(
        airtable_id=at_id_b3,
        name="CRUD Test: B3 Temp Delete Corp",
    )

    check(SUITE_B, "B3: Airtable record created", at_id_b3 is not None)

    at_table.delete(at_id_b3)
    AirtableAccount.objects.filter(airtable_id=at_id_b3).delete()

    check(SUITE_B, "B3: Airtable record deleted", at_get_acct(at_id_b3) is None)
    check(SUITE_B, "B3: Django record deleted",
          not AirtableAccount.objects.filter(airtable_id=at_id_b3).exists())

finally:
    # Cleanup B1 and B2
    if django_b1 is not None:
        cleanup_django_acct(django_b1.pk)
    cleanup_at_acct(at_id_b1)
    if django_b2 is not None:
        cleanup_django_acct(django_b2.pk)
    cleanup_at_acct(at_id_b2)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE C — App Account with Airtable write-back
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE C: App Account CRUD (with Airtable write-back) ===")

SUITE_C = "Suite C"

acct_c1 = None
at_id_c1 = None
acct_c2 = None
at_id_c2 = None

try:
    user = User.objects.first()

    # ── C1: Create, leave untouched ───────────────────────────────────────────
    acct_c1 = Account.objects.create(
        company_name="CRUD Test: C1 Streamline Tech",
        website="https://streamlinetech.io",
        industry="Technology",
        status="active",
        arr=750000.00,
        created_by=user,
    )
    at_id_c1 = push_account_create(acct_c1)

    check(SUITE_C, "C1: Airtable record created via write-back",
          at_id_c1 is not None)

    acct_c1.airtable_id = at_id_c1
    acct_c1.save(update_fields=["airtable_id"])

    fields_c1 = at_get_acct(at_id_c1)
    check(SUITE_C, "C1: Account Name in Airtable",
          fields_c1 is not None and fields_c1.get("Account Name") == "CRUD Test: C1 Streamline Tech")
    check(SUITE_C, "C1: Email Domain extracted from website",
          fields_c1 is not None and fields_c1.get("Email Domain") == "streamlinetech.io")

    # ── C2: Create then Update ────────────────────────────────────────────────
    acct_c2 = Account.objects.create(
        company_name="CRUD Test: C2 Apex Industries",
        website="https://apexindustries.com",
        status="prospect",
        created_by=user,
    )
    at_id_c2 = push_account_create(acct_c2)

    check(SUITE_C, "C2: Airtable record created",
          at_id_c2 is not None)

    acct_c2.airtable_id = at_id_c2
    acct_c2.save(update_fields=["airtable_id"])

    acct_c2.company_name = "CRUD Test: C2 Apex Industries (Updated)"
    acct_c2.website = "https://v2.apexindustries.com"
    acct_c2.save()
    push_account_update(acct_c2)

    fields_c2 = at_get_acct(at_id_c2)
    check(SUITE_C, "C2: Name updated in Airtable",
          fields_c2 is not None and fields_c2.get("Account Name") == "CRUD Test: C2 Apex Industries (Updated)")
    check(SUITE_C, "C2: Email Domain updated",
          fields_c2 is not None and fields_c2.get("Email Domain") == "v2.apexindustries.com")

    # ── C3: Create then Delete ────────────────────────────────────────────────
    acct_c3 = Account.objects.create(
        company_name="CRUD Test: C3 Temp Delete Account",
        website="https://temp.example.com",
        created_by=user,
    )
    at_id_c3 = push_account_create(acct_c3)

    check(SUITE_C, "C3: Airtable record created",
          at_id_c3 is not None)

    push_account_delete(at_id_c3)
    acct_c3.delete()

    check(SUITE_C, "C3: Airtable record deleted", at_get_acct(at_id_c3) is None)
    check(SUITE_C, "C3: Django record deleted",
          not Account.objects.filter(company_name="CRUD Test: C3 Temp Delete Account").exists())

finally:
    # Cleanup C1 and C2
    if acct_c1 is not None:
        cleanup_app_acct(acct_c1.pk)
    cleanup_at_acct(at_id_c1)
    if acct_c2 is not None:
        cleanup_app_acct(acct_c2.pk)
    cleanup_at_acct(at_id_c2)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE D — Link Verification
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE D: Link Verification ===")

SUITE_D = "Suite D"

item_d1 = None
at_id_d1 = None
acct_d3 = None
at_id_d3 = None

try:
    # ── D1: ActionItem → AirtableAccount FK link ──────────────────────────────
    item_d1, at_id_d1 = make_ai(
        task="CRUD Test: D1 Link test JPMC",
        account_id=JPMC_PK,
    )

    fields_d1 = at_get_ai(at_id_d1)
    check(SUITE_D, "D1: AT Account field links to JPMC",
          fields_d1 is not None and JPMC_AT_ID in fields_d1.get("Account", []))
    check(SUITE_D, "D1: AT Account Name lookup = JPMC",
          fields_d1 is not None and fields_d1.get("Account Name (from Account)", []) == ["JPMC"])
    check(SUITE_D, "D1: Django FK = JPMC pk",
          item_d1.account_id == JPMC_PK)

    # ── D2: Re-link ActionItem from JPMC to Berxi ─────────────────────────────
    berxi_obj = AirtableAccount.objects.filter(airtable_id=BERXI_AT_ID).first()
    if berxi_obj is None:
        berxi_obj = AirtableAccount.objects.create(airtable_id=BERXI_AT_ID, name="Berxi")

    item_d1.account = berxi_obj
    item_d1.save(update_fields=["account"])
    push_action_item_update(item_d1)

    fields_d2 = at_get_ai(at_id_d1)
    check(SUITE_D, "D2: AT Account re-linked to Berxi",
          fields_d2 is not None and BERXI_AT_ID in fields_d2.get("Account", []))
    check(SUITE_D, "D2: Django FK updated to Berxi",
          AirtableActionItem.objects.get(pk=item_d1.pk).account.airtable_id == BERXI_AT_ID)

    # ── D3: App Account.airtable_id populated after create ────────────────────
    user = User.objects.first()
    acct_d3 = Account.objects.create(
        company_name="CRUD Test: D3 Link verify account",
        website="https://linkverify.example.com",
        created_by=user,
    )
    at_id_d3 = push_account_create(acct_d3)
    acct_d3.airtable_id = at_id_d3
    acct_d3.save(update_fields=["airtable_id"])

    check(SUITE_D, "D3: Account.airtable_id populated",
          acct_d3.airtable_id is not None and not acct_d3.airtable_id.startswith("pending"))

    fields_d3 = at_get_acct(at_id_d3)
    check(SUITE_D, "D3: AT record exists for app Account",
          fields_d3 is not None and fields_d3.get("Account Name") is not None)

finally:
    # Cleanup D1 item and D3 account
    if item_d1 is not None:
        cleanup_django_ai(item_d1.pk)
    cleanup_at_ai(at_id_d1)
    if acct_d3 is not None:
        cleanup_app_acct(acct_d3.pk)
    cleanup_at_acct(at_id_d3)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE E — Status Transition Pathway
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE E: Status Transition Pathway ===")

SUITE_E = "Suite E"

item_e = None
at_id_e = None

try:
    item_e, at_id_e = make_ai(task="CRUD Test: E1 Status transitions")

    transitions = [
        ("In Progress", "In Progress"),
        ("Done", "Done"),
        ("Blocked", "Blocked"),
    ]

    for django_status, expected_at_status in transitions:
        item_e.status = django_status
        item_e.save(update_fields=["status"])
        push_action_item_update(item_e)

        fields_e = at_get_ai(at_id_e)
        check(SUITE_E, f"E: {django_status}→{expected_at_status}",
              fields_e is not None and fields_e.get("Status") == expected_at_status)

finally:
    if item_e is not None:
        cleanup_django_ai(item_e.pk)
    cleanup_at_ai(at_id_e)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE F — Time Logging Pathway
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE F: Time Logging Pathway ===")

SUITE_F = "Suite F"

item_f = None
at_id_f = None

try:
    item_f, at_id_f = make_ai(task="CRUD Test: F1 Time logging test")
    at_table_ai = get_table(TABLE_ACTION_ITEMS)

    # First time increment: +3600s
    item_f.time_spent += 3600
    item_f.save(update_fields=["time_spent"])
    at_table_ai.update(item_f.airtable_id, {"Time Spent": item_f.time_spent})

    fields_f1 = at_get_ai(at_id_f)
    check(SUITE_F, "F: +3600s logged in Airtable",
          fields_f1 is not None and fields_f1.get("Time Spent") == 3600)

    # Second time increment: +1800s (cumulative 5400s)
    item_f.time_spent += 1800
    item_f.save(update_fields=["time_spent"])
    at_table_ai.update(item_f.airtable_id, {"Time Spent": item_f.time_spent})

    fields_f2 = at_get_ai(at_id_f)
    check(SUITE_F, "F: cumulative 5400s in Airtable",
          fields_f2 is not None and fields_f2.get("Time Spent") == 5400)
    check(SUITE_F, "F: Django time_spent=5400",
          AirtableActionItem.objects.get(pk=item_f.pk).time_spent == 5400)

finally:
    if item_f is not None:
        cleanup_django_ai(item_f.pk)
    cleanup_at_ai(at_id_f)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE G — Claude Skills
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE G: Claude Skills ===")
SUITE_G = "Suite G"

def at_get(table_id, rec_id):
    try:
        rec = get_table(table_id).get(rec_id)
        return rec.get("fields", {})
    except Exception:
        return None

def at_delete(table_id, rec_id):
    if rec_id:
        try:
            get_table(table_id).delete(rec_id)
        except Exception:
            pass

g_skill = None
g_at_id = None

try:
    user = User.objects.first()
    g_skill = ClaudeSkill.objects.create(
        name=f"crud_test_skill_{uuid.uuid4().hex[:6]}",
        description="CRUD Test: G1 a test skill",
        code="async def crud_test_skill(**kwargs):\n    return {'ok': True}",
        status="pending_review",
        submitted_by=user,
    )
    at_tbl = get_table(TABLE_CLAUDE_SKILLS)
    at_rec = at_tbl.create({
        "Skill Name":    g_skill.name,
        "Description":   g_skill.description,
        "Status":        "Pending Review",
        "Code":          g_skill.code,
        "Submitted By":  user.username if user else "",
        "Django ID":     g_skill.pk,
    })
    g_at_id = at_rec["id"]

    check(SUITE_G, "G1: Airtable record created", g_at_id is not None)
    fields_g = at_get(TABLE_CLAUDE_SKILLS, g_at_id)
    check(SUITE_G, "G1: Skill Name matches", fields_g is not None and fields_g.get("Skill Name") == g_skill.name)
    check(SUITE_G, "G1: Status = Pending Review", fields_g is not None and fields_g.get("Status") == "Pending Review")
    check(SUITE_G, "G1: Django ID round-trips", fields_g is not None and fields_g.get("Django ID") == g_skill.pk)

    # Update: approve and set invocation count
    g_skill.status = "approved"
    g_skill.invocation_count = 3
    g_skill.save(update_fields=["status", "invocation_count"])
    at_tbl.update(g_at_id, {"Status": "Approved", "Invocation Count": 3})

    fields_g2 = at_get(TABLE_CLAUDE_SKILLS, g_at_id)
    check(SUITE_G, "G2: Status updated to Approved", fields_g2 is not None and fields_g2.get("Status") == "Approved")
    check(SUITE_G, "G2: Invocation Count = 3", fields_g2 is not None and fields_g2.get("Invocation Count") == 3)

    # Delete
    at_delete(TABLE_CLAUDE_SKILLS, g_at_id)
    g_skill.delete()
    check(SUITE_G, "G3: Airtable record deleted", at_get(TABLE_CLAUDE_SKILLS, g_at_id) is None)
    check(SUITE_G, "G3: Django record deleted", not ClaudeSkill.objects.filter(pk=g_skill.pk).exists())
    g_skill = None
    g_at_id = None

finally:
    if g_skill is not None:
        try: g_skill.delete()
        except Exception: pass
    at_delete(TABLE_CLAUDE_SKILLS, g_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE H — Reminders
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE H: Reminders ===")
SUITE_H = "Suite H"

h_rem = None
h_at_id = None

try:
    user = User.objects.first()
    from django.utils import timezone
    due = timezone.now().replace(hour=17, minute=0, second=0, microsecond=0)

    h_rem = Reminder.objects.create(
        created_by=user,
        title="CRUD Test: H1 review action items before EOD",
        body="Check all open items for JPMC",
        resource_type="account",
        resource_label="JPMC",
        due_at=due,
        notify_in_app=True,
        notify_slack=True,
    )
    at_tbl = get_table(TABLE_REMINDERS)
    at_rec = at_tbl.create({
        "Title":          h_rem.title,
        "Body":           h_rem.body,
        "Due At":         due.isoformat(),
        "Status":         "Pending",
        "Resource Type":  h_rem.resource_type,
        "Resource Label": h_rem.resource_label,
        "Notify In-App":  True,
        "Notify Slack":   True,
        "Notify Push":    False,
        "Notify SMS":     False,
        "Created By":     user.username if user else "",
        "Django ID":      h_rem.pk,
    })
    h_at_id = at_rec["id"]

    check(SUITE_H, "H1: Airtable record created", h_at_id is not None)
    fields_h = at_get(TABLE_REMINDERS, h_at_id)
    check(SUITE_H, "H1: Title matches", fields_h is not None and fields_h.get("Title") == h_rem.title)
    check(SUITE_H, "H1: Status = Pending", fields_h is not None and fields_h.get("Status") == "Pending")
    check(SUITE_H, "H1: Notify Slack = True", fields_h is not None and fields_h.get("Notify Slack") is True)
    check(SUITE_H, "H1: Resource Label = JPMC", fields_h is not None and fields_h.get("Resource Label") == "JPMC")

    # Dismiss
    h_rem.status = "dismissed"
    h_rem.save(update_fields=["status"])
    at_tbl.update(h_at_id, {"Status": "Dismissed"})
    fields_h2 = at_get(TABLE_REMINDERS, h_at_id)
    check(SUITE_H, "H2: Status updated to Dismissed", fields_h2 is not None and fields_h2.get("Status") == "Dismissed")

    # Delete
    at_delete(TABLE_REMINDERS, h_at_id)
    h_rem.delete()
    check(SUITE_H, "H3: Airtable record deleted", at_get(TABLE_REMINDERS, h_at_id) is None)
    check(SUITE_H, "H3: Django record deleted", not Reminder.objects.filter(pk=h_rem.pk).exists())
    h_rem = None
    h_at_id = None

finally:
    if h_rem is not None:
        try: h_rem.delete()
        except Exception: pass
    at_delete(TABLE_REMINDERS, h_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE I — Activity Log
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE I: Activity Log ===")
SUITE_I = "Suite I"

i_event = None
i_at_id = None

try:
    user = User.objects.first()
    i_event = AgentActivityEvent.objects.create(
        user=user,
        event_type="task_created",
        title="CRUD Test: I1 task created event",
        detail="Created task for JPMC review",
    )
    at_tbl = get_table(TABLE_ACTIVITY_LOG)
    at_rec = at_tbl.create({
        "Title":       i_event.title,
        "Event Type":  i_event.event_type,
        "Detail":      i_event.detail,
        "User":        user.username if user else "",
        "Created At":  i_event.created_at.isoformat(),
        "Django ID":   i_event.pk,
    })
    i_at_id = at_rec["id"]

    check(SUITE_I, "I1: Airtable record created", i_at_id is not None)
    fields_i = at_get(TABLE_ACTIVITY_LOG, i_at_id)
    check(SUITE_I, "I1: Title matches", fields_i is not None and fields_i.get("Title") == i_event.title)
    check(SUITE_I, "I1: Event Type = task_created", fields_i is not None and fields_i.get("Event Type") == "task_created")
    check(SUITE_I, "I1: Django ID round-trips", fields_i is not None and fields_i.get("Django ID") == i_event.pk)

    # Activity log is append-only; test delete cleanup
    at_delete(TABLE_ACTIVITY_LOG, i_at_id)
    i_event.delete()
    check(SUITE_I, "I2: Airtable record deleted", at_get(TABLE_ACTIVITY_LOG, i_at_id) is None)
    check(SUITE_I, "I2: Django record deleted", not AgentActivityEvent.objects.filter(pk=i_event.pk).exists())
    i_event = None
    i_at_id = None

finally:
    if i_event is not None:
        try: i_event.delete()
        except Exception: pass
    at_delete(TABLE_ACTIVITY_LOG, i_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE J — Voice Sessions
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE J: Voice Sessions ===")
SUITE_J = "Suite J"

j_session = None
j_at_id = None

try:
    user = User.objects.first()
    j_session = VoiceSession.objects.create(
        user=user,
        call_sid=f"CA{uuid.uuid4().hex[:32]}",
        from_number="+14155550100",
        to_number="+14157070208",
        status="completed",
        duration_seconds=127,
        transcript="CRUD Test: J1 transcript content",
    )
    at_tbl = get_table(TABLE_VOICE_SESSIONS)
    at_rec = at_tbl.create({
        "Call SID":           j_session.call_sid,
        "From Number":        j_session.from_number,
        "To Number":          j_session.to_number,
        "Status":             j_session.status,
        "Duration (seconds)": j_session.duration_seconds,
        "Transcript":         j_session.transcript,
        "User":               user.username if user else "",
        "Django ID":          j_session.pk,
    })
    j_at_id = at_rec["id"]

    check(SUITE_J, "J1: Airtable record created", j_at_id is not None)
    fields_j = at_get(TABLE_VOICE_SESSIONS, j_at_id)
    check(SUITE_J, "J1: Call SID matches", fields_j is not None and fields_j.get("Call SID") == j_session.call_sid)
    check(SUITE_J, "J1: Status = completed", fields_j is not None and fields_j.get("Status") == "completed")
    check(SUITE_J, "J1: Duration = 127", fields_j is not None and fields_j.get("Duration (seconds)") == 127)

    # Update: add recording URL
    j_session.recording_url = "https://api.twilio.com/recordings/RE_crud_test"
    j_session.save(update_fields=["recording_url"])
    at_tbl.update(j_at_id, {"Recording URL": j_session.recording_url})
    fields_j2 = at_get(TABLE_VOICE_SESSIONS, j_at_id)
    check(SUITE_J, "J2: Recording URL updated", fields_j2 is not None and "crud_test" in (fields_j2.get("Recording URL") or ""))

    at_delete(TABLE_VOICE_SESSIONS, j_at_id)
    j_session.delete()
    check(SUITE_J, "J3: Airtable record deleted", at_get(TABLE_VOICE_SESSIONS, j_at_id) is None)
    j_session = None
    j_at_id = None

finally:
    if j_session is not None:
        try: j_session.delete()
        except Exception: pass
    at_delete(TABLE_VOICE_SESSIONS, j_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE K — Account Artifacts
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE K: Account Artifacts ===")
SUITE_K = "Suite K"

k_artifact = None
k_at_id = None

try:
    user = User.objects.first()
    account = Account.objects.first()
    k_artifact = AccountArtifact.objects.create(
        account=account,
        uploaded_by=user,
        artifact_type="link",
        name="CRUD Test: K1 Q3 deck",
        url="https://docs.google.com/presentation/d/crud_test_k1",
        mime_type="text/html",
    )
    at_tbl = get_table(TABLE_ARTIFACTS)
    at_rec = at_tbl.create({
        "Name":         k_artifact.name,
        "Account Name": account.company_name if account else "",
        "Type":         k_artifact.artifact_type,
        "URL":          k_artifact.url,
        "MIME Type":    k_artifact.mime_type,
        "Uploaded By":  user.username if user else "",
        "Django ID":    k_artifact.pk,
    })
    k_at_id = at_rec["id"]

    check(SUITE_K, "K1: Airtable record created", k_at_id is not None)
    fields_k = at_get(TABLE_ARTIFACTS, k_at_id)
    check(SUITE_K, "K1: Name matches", fields_k is not None and fields_k.get("Name") == k_artifact.name)
    check(SUITE_K, "K1: Type = link", fields_k is not None and fields_k.get("Type") == "link")
    check(SUITE_K, "K1: URL matches", fields_k is not None and fields_k.get("URL") == k_artifact.url)

    at_delete(TABLE_ARTIFACTS, k_at_id)
    k_artifact.delete()
    check(SUITE_K, "K2: Airtable record deleted", at_get(TABLE_ARTIFACTS, k_at_id) is None)
    k_artifact = None
    k_at_id = None

finally:
    if k_artifact is not None:
        try: k_artifact.delete()
        except Exception: pass
    at_delete(TABLE_ARTIFACTS, k_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE L — Tasks
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE L: Tasks ===")
SUITE_L = "Suite L"

l_task = None
l_at_id = None

try:
    user = User.objects.first()
    l_task = Task.objects.create(
        title="CRUD Test: L1 prepare renewal deck",
        description="Build slides for Q4 renewal meeting",
        assigned_to=user,
        created_by=user,
        status="todo",
        priority="high",
        tags=["renewal", "Q4"],
    )
    at_tbl = get_table(TABLE_TASKS)
    at_rec = at_tbl.create({
        "Title":       l_task.title,
        "Description": l_task.description,
        "Status":      l_task.status,
        "Priority":    l_task.priority,
        "Assigned To": user.username if user else "",
        "Tags":        ", ".join(l_task.tags),
        "Django ID":   l_task.pk,
    })
    l_at_id = at_rec["id"]

    check(SUITE_L, "L1: Airtable record created", l_at_id is not None)
    fields_l = at_get(TABLE_TASKS, l_at_id)
    check(SUITE_L, "L1: Title matches", fields_l is not None and fields_l.get("Title") == l_task.title)
    check(SUITE_L, "L1: Status = todo", fields_l is not None and fields_l.get("Status") == "todo")
    check(SUITE_L, "L1: Priority = high", fields_l is not None and fields_l.get("Priority") == "high")

    # Status transition todo → in_progress → done
    for new_status in ("in_progress", "done"):
        l_task.status = new_status
        l_task.save(update_fields=["status"])
        at_tbl.update(l_at_id, {"Status": new_status})
        fields_lt = at_get(TABLE_TASKS, l_at_id)
        check(SUITE_L, f"L2: Status → {new_status}", fields_lt is not None and fields_lt.get("Status") == new_status)

    at_delete(TABLE_TASKS, l_at_id)
    l_task.delete()
    check(SUITE_L, "L3: Airtable record deleted", at_get(TABLE_TASKS, l_at_id) is None)
    l_task = None
    l_at_id = None

finally:
    if l_task is not None:
        try: l_task.delete()
        except Exception: pass
    at_delete(TABLE_TASKS, l_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE M — Team Members
# ══════════════════════════════════════════════════════════════════════════════

print("\n=== SUITE M: Team Members ===")
SUITE_M = "Suite M"

m_member = None
m_at_id = None

try:
    m_member = TeamMember.objects.create(
        full_name="CRUD Test M1 Jane Doe",
        email=f"crud.test.m1.{uuid.uuid4().hex[:6]}@example.com",
        title="Solutions Engineer",
        department="Customer Success",
        status="active",
        slack_handle="@crud_test_m1",
    )
    at_tbl = get_table(TABLE_TEAM_MEMBERS)
    at_rec = at_tbl.create({
        "Full Name":   m_member.full_name,
        "Email":       m_member.email,
        "Title":       m_member.title,
        "Department":  m_member.department,
        "Status":      m_member.status,
        "Slack Handle": m_member.slack_handle,
        "Django ID":   m_member.pk,
    })
    m_at_id = at_rec["id"]

    check(SUITE_M, "M1: Airtable record created", m_at_id is not None)
    fields_m = at_get(TABLE_TEAM_MEMBERS, m_at_id)
    check(SUITE_M, "M1: Full Name matches", fields_m is not None and fields_m.get("Full Name") == m_member.full_name)
    check(SUITE_M, "M1: Email matches", fields_m is not None and fields_m.get("Email") == m_member.email)
    check(SUITE_M, "M1: Status = active", fields_m is not None and fields_m.get("Status") == "active")

    # Update title
    m_member.title = "Senior Solutions Engineer"
    m_member.save(update_fields=["title"])
    at_tbl.update(m_at_id, {"Title": m_member.title})
    fields_m2 = at_get(TABLE_TEAM_MEMBERS, m_at_id)
    check(SUITE_M, "M2: Title updated in Airtable", fields_m2 is not None and fields_m2.get("Title") == "Senior Solutions Engineer")

    at_delete(TABLE_TEAM_MEMBERS, m_at_id)
    m_member.delete()
    check(SUITE_M, "M3: Airtable record deleted", at_get(TABLE_TEAM_MEMBERS, m_at_id) is None)
    m_member = None
    m_at_id = None

finally:
    if m_member is not None:
        try: m_member.delete()
        except Exception: pass
    at_delete(TABLE_TEAM_MEMBERS, m_at_id)


# ══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

print("\n" + "="*70)
print("  FINAL RESULTS SUMMARY")
print("="*70)
total = len(results)
passed = sum(1 for r in results if r["pass"])
failed = total - passed
for r in results:
    status = "PASS" if r["pass"] else "FAIL"
    print(f"  [{status}] {r['suite']} — {r['test']}")
    if not r["pass"] and r["detail"]:
        print(f"         detail: {r['detail']}")
print(f"\n  {passed}/{total} passed", "✓" if failed == 0 else f"  ({failed} FAILED)")
sys.exit(0 if failed == 0 else 1)
