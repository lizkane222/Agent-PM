"""
The create/read/update tools in agents/record_tools.py.

Each tool runs the app's real REST view through agents.rest_bridge, so these tests assert
the security property that matters: the agent can act on the caller's own records, and is
refused — by the view's own rules, not a reimplementation — on someone else's. Patched only
where the view would otherwise reach a third party (Airtable write-back).
"""

from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from accounts.models import Account, AccountArtifact, AccountNote, AccountProject, CustomerContact
from agents.mcp_server import mcp_server
from airtable_sync.models import AirtableAccount, AirtableActionItem, ActionItemStep
from comments.models import Comment
from scheduler.models import CalendarEvent, MeetingNote, Reminder, Task
from team.models import TeamMember, UserProfile

User = get_user_model()


def run(tool, user, **args):
    return async_to_sync(mcp_server.dispatch)(tool, args, user=user)


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        # Airtable is a third party; the view's write-back must not leave the test.
        for target in (
            "airtable_sync.write_back.push_account_create",
            "airtable_sync.write_back.push_account_update",
            "airtable_sync.write_back.push_customer_contact_create",
            "airtable_sync.write_back.push_customer_contact_update",
            "airtable_sync.write_back.push_artifact_upsert",
            "airtable_sync.write_back.push_working_session_create",
            "airtable_sync.write_back.push_working_session_update",
        ):
            mock.patch(target, return_value=None).start()
        self.addCleanup(mock.patch.stopall)

        self.me = User.objects.create_user("liz", email="liz@twilio.com", password="x")
        UserProfile.objects.create(user=self.me, timezone="UTC")
        self.me_m = TeamMember.objects.create(user=self.me, full_name="Liz Kane", email="liz@twilio.com")
        self.other = User.objects.create_user("eve", email="eve@twilio.com", password="x")
        UserProfile.objects.create(user=self.other, timezone="UTC")
        self.other_m = TeamMember.objects.create(user=self.other, full_name="Eve Other", email="eve@twilio.com")

        self.mine = Account.objects.create(company_name="Archistrator")
        self.mine.team_members.add(self.me_m)
        self.theirs = Account.objects.create(company_name="Globex")
        self.theirs.team_members.add(self.other_m)


class ReminderToolTests(_Base):
    def test_create_list_and_reschedule_own_reminder(self):
        due = (timezone.now() + timedelta(days=1)).isoformat()
        r = run("create_reminder", self.me, title="Call Acme", due_at=due)
        self.assertEqual(r["status"], "created", r)
        rid = r["reminder"]["id"]
        self.assertEqual(Reminder.objects.get(pk=rid).created_by, self.me)

        listed = run("list_reminders", self.me)
        self.assertEqual([x["id"] for x in listed["reminders"]], [rid])

        Reminder.objects.filter(pk=rid).update(status="sent")
        later = (timezone.now() + timedelta(days=2)).isoformat()
        r = run("update_reminder", self.me, reminder_id=rid, due_at=later)
        self.assertEqual(r["status"], "updated", r)
        # Rescheduling re-arms it; delivery only picks up pending reminders.
        self.assertEqual(Reminder.objects.get(pk=rid).status, "pending")

    def test_cannot_see_or_edit_another_users_reminder(self):
        theirs = Reminder.objects.create(created_by=self.other, title="Theirs", due_at=timezone.now())
        self.assertEqual(run("list_reminders", self.me)["reminders"], [])
        r = run("update_reminder", self.me, reminder_id=theirs.pk, title="hijacked")
        self.assertEqual(r["error_code"], "not_found")
        theirs.refresh_from_db()
        self.assertEqual(theirs.title, "Theirs")

    def test_an_update_with_no_changes_is_refused(self):
        rem = Reminder.objects.create(created_by=self.me, title="x", due_at=timezone.now())
        self.assertEqual(run("update_reminder", self.me, reminder_id=rem.pk)["error_code"], "invalid_arguments")

    def test_bad_status_is_refused_by_schema(self):
        rem = Reminder.objects.create(created_by=self.me, title="x", due_at=timezone.now())
        self.assertEqual(run("update_reminder", self.me, reminder_id=rem.pk, status="sent")["error_code"],
                         "invalid_arguments")


class AccountScopedToolTests(_Base):
    def test_account_names_resolve_only_to_the_callers_accounts(self):
        r = run("create_artifact", self.me, account_name="Globex", name="Deck", url="https://x.test/d")
        self.assertEqual(r["error_code"], "not_found")
        self.assertFalse(AccountArtifact.objects.filter(account=self.theirs).exists())

    def test_misheard_account_name_still_resolves(self):
        r = run("create_artifact", self.me, account_name="Orchestrator", name="Deck", url="https://x.test/d")
        self.assertEqual(r["status"], "created", r)
        self.assertEqual(r["account_name"], "Archistrator")
        art = AccountArtifact.objects.get(account=self.mine)
        self.assertEqual((art.artifact_type, art.url, art.uploaded_by), ("link", "https://x.test/d", self.me))

    def test_artifacts_must_be_http_links(self):
        r = run("create_artifact", self.me, account_name="Archistrator", name="x", url="javascript:alert(1)")
        self.assertEqual(r["error_code"], "invalid_arguments")
        self.assertFalse(AccountArtifact.objects.exists())

    def test_cannot_edit_someone_elses_artifact(self):
        art = AccountArtifact.objects.create(account=self.theirs, uploaded_by=self.other, name="Theirs",
                                             artifact_type="link", url="https://x.test")
        r = run("update_artifact", self.me, artifact_id=art.pk, name="mine now")
        self.assertEqual(r["error_code"], "not_found")
        art.refresh_from_db()
        self.assertEqual(art.name, "Theirs")

    def test_quick_link_round_trip(self):
        r = run("create_quick_link", self.me, account_name="Archistrator", name="Wiki", url="https://wiki.test")
        self.assertEqual(r["status"], "created", r)
        listed = run("list_quick_links", self.me, account_name="Archistrator")
        self.assertEqual([q["name"] for q in listed["quick_links"]], ["Wiki"])
        upd = run("update_quick_link", self.me, quick_link_id=r["quick_link"]["id"], name="Docs")
        self.assertEqual(upd["quick_link"]["name"], "Docs")

    def test_account_note_list_and_edit_own_only(self):
        mine = AccountNote.objects.create(account=self.mine, author=self.me, content="hi")
        theirs = AccountNote.objects.create(account=self.mine, author=self.other, content="theirs")
        self.assertEqual(len(run("list_account_notes", self.me, account_name="Archistrator")["notes"]), 2)
        self.assertEqual(run("update_account_note", self.me, note_id=mine.pk, content="edited")["status"], "updated")
        # The view scopes edits to the author.
        self.assertEqual(run("update_account_note", self.me, note_id=theirs.pk, content="x")["error_code"], "not_found")


class ContactToolTests(_Base):
    def test_create_update_and_note_a_contact(self):
        r = run("create_customer_contact", self.me, account_name="Archistrator", name="Pat", role="CTO")
        self.assertEqual(r["status"], "created", r)
        cid = r["contact"]["id"]
        self.assertEqual(run("update_customer_contact", self.me, contact_id=cid, email="pat@a.test")["status"], "updated")
        n = run("add_contact_note", self.me, contact_id=cid, content="Wants SSO")
        self.assertEqual(n["status"], "created", n)
        self.assertEqual(run("list_customer_contacts", self.me, account_name="Archistrator")["contacts"][0]["notes_count"], 1)

    def test_cannot_touch_contacts_on_other_accounts(self):
        c = CustomerContact.objects.create(account=self.theirs, name="Their contact")
        self.assertEqual(run("update_customer_contact", self.me, contact_id=c.pk, name="x")["error_code"], "not_found")
        self.assertEqual(run("add_contact_note", self.me, contact_id=c.pk, content="x")["error_code"], "not_found")


class ProjectToolTests(_Base):
    def test_goal_attaches_to_its_parent_project(self):
        proj = run("create_project", self.me, account_name="Archistrator", name="Rollout")
        self.assertEqual(proj["status"], "created", proj)
        goal = run("create_project", self.me, account_name="Archistrator", name="SSO", kind="goal",
                   parent_project_id=proj["project"]["id"])
        self.assertEqual(goal["attached_to_project"], proj["project"]["id"])
        parent = AccountProject.objects.get(pk=proj["project"]["id"])
        self.assertIn(goal["project"]["id"], parent.goal_ids)

    def test_linking_items_appends_without_duplicates(self):
        p = AccountProject.objects.create(account=self.mine, name="P", action_ids=["recA"])
        r = run("update_project", self.me, project_id=p.pk, add_action_item_ids=["recA", "recB"])
        self.assertEqual(r["status"], "updated", r)
        p.refresh_from_db()
        self.assertEqual(p.action_ids, ["recA", "recB"])

    def test_cannot_create_a_project_on_another_users_account(self):
        r = run("create_project", self.me, account_name="Globex", name="x")
        self.assertEqual(r["error_code"], "not_found")


class ActionItemSubrecordTests(_Base):
    def setUp(self):
        super().setUp()
        self.at_acct = AirtableAccount.objects.create(airtable_id="recARCH", name="Archistrator")
        self.mine.airtable_id = "recARCH"
        self.mine.save(update_fields=["airtable_id"])
        self.item = AirtableActionItem.objects.create(airtable_id="recITEM", task="Prep", account=self.at_acct)
        self.blocker = AirtableActionItem.objects.create(airtable_id="recBLOCK", task="Blocker", account=self.at_acct)
        self.assigned_to_other = AirtableActionItem.objects.create(
            airtable_id="recOTHER", task="Theirs", account=self.at_acct,
            assignee_airtable_id=str(self.other_m.pk), assignee_name="Eve Other",
        )

    def test_steps_round_trip(self):
        r = run("create_action_item_step", self.me, airtable_id="recITEM", title="Draft deck")
        self.assertEqual(r["status"], "created", r)
        run("create_action_item_step", self.me, airtable_id="recITEM", title="Review")
        steps = run("list_action_item_steps", self.me, airtable_id="recITEM")["steps"]
        self.assertEqual([s["title"] for s in steps], ["Draft deck", "Review"])
        self.assertEqual(run("update_action_item_step", self.me, step_id=steps[0]["id"], status="Done")["step"]["status"], "Done")

    def test_cannot_add_steps_to_an_item_assigned_to_someone_else(self):
        r = run("create_action_item_step", self.me, airtable_id="recOTHER", title="x")
        self.assertEqual(r["error_code"], "forbidden")
        self.assertFalse(ActionItemStep.objects.filter(action_item=self.assigned_to_other).exists())

    def test_dependency_and_cycle_refusal(self):
        self.assertEqual(run("add_action_item_dependency", self.me, airtable_id="recITEM",
                             waiting_on_airtable_id="recBLOCK")["status"], "updated")
        cycle = run("add_action_item_dependency", self.me, airtable_id="recBLOCK", waiting_on_airtable_id="recITEM")
        self.assertEqual(cycle["error_code"], "invalid_arguments")

    def test_attach_link(self):
        r = run("attach_link_to_action_item", self.me, airtable_id="recITEM", name="Ticket", url="https://jira.test/1")
        self.assertEqual(r["status"], "created", r)

    def test_unknown_action_item(self):
        self.assertEqual(run("list_action_item_steps", self.me, airtable_id="recNOPE")["error_code"], "not_found")


class MeetingNoteAndCommentTests(_Base):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.event = CalendarEvent.objects.create(owner=self.me, title="Sync", start_datetime=now,
                                                  end_datetime=now + timedelta(hours=1))
        self.their_event = CalendarEvent.objects.create(owner=self.other, title="Private", start_datetime=now,
                                                        end_datetime=now + timedelta(hours=1))

    def test_meeting_notes_on_own_event(self):
        r = run("add_meeting_note", self.me, event_id=self.event.pk, text="Follow up <b>x</b>")
        self.assertEqual(r["status"], "created", r)
        note = MeetingNote.objects.get(pk=r["note"]["id"])
        self.assertNotIn("<b>", note.html)  # escaped, not injected as markup
        self.assertEqual(len(run("list_meeting_notes", self.me, event_id=self.event.pk)["notes"]), 1)

    def test_cannot_add_notes_to_another_users_event(self):
        r = run("add_meeting_note", self.me, event_id=self.their_event.pk, text="x")
        self.assertEqual(r["error_code"], "forbidden")
        self.assertFalse(MeetingNote.objects.filter(event=self.their_event).exists())

    def test_comment_and_reply(self):
        c = run("add_comment", self.me, resource_type="calendar_event", resource_id=self.event.pk, content="Note")
        self.assertEqual(c["status"], "created", c)
        reply = run("add_comment", self.me, resource_type="calendar_event", resource_id=self.event.pk,
                    content="Reply", reply_to_comment_id=c["comment"]["id"])
        self.assertEqual(reply["status"], "created", reply)
        thread = run("list_comments", self.me, resource_type="calendar_event", resource_id=self.event.pk)
        self.assertEqual(thread["comments"][0]["replies"][0]["content"], "Reply")

    def test_cannot_comment_on_a_record_you_cannot_see(self):
        r = run("add_comment", self.me, resource_type="calendar_event", resource_id=self.their_event.pk, content="x")
        self.assertEqual(r["error_code"], "forbidden")
        self.assertFalse(Comment.objects.exists())


class TaskFeedbackLayoutTeamTests(_Base):
    def test_task_is_assigned_to_the_caller_and_editable(self):
        r = run("create_task", self.me, title="Write runbook", priority="high")
        self.assertEqual(r["status"], "created", r)
        self.assertEqual(Task.objects.get(pk=r["task"]["id"]).assigned_to, self.me)
        self.assertEqual(run("update_task", self.me, task_id=r["task"]["id"], status="done")["task"]["status"], "done")
        self.assertEqual(len(run("list_tasks", self.me)["tasks"]), 1)

    def test_cannot_edit_another_users_task(self):
        t = Task.objects.create(title="Theirs", created_by=self.other, assigned_to=self.other)
        self.assertEqual(run("update_task", self.me, task_id=t.pk, title="x")["error_code"], "not_found")

    def test_feedback_round_trip(self):
        f = run("submit_feedback", self.me, description="The calendar is slow")
        self.assertEqual(f["status"], "created", f)
        self.assertEqual(run("add_feedback_comment", self.me, feedback_id=f["feedback"]["id"], content="+1")["status"], "created")
        self.assertEqual(len(run("list_feedback", self.me)["feedback"]), 1)

    def test_page_notes_create_then_update_in_place(self):
        self.assertEqual(run("set_page_notes", self.me, content="v1")["status"], "created")
        self.assertEqual(run("set_page_notes", self.me, content="v2")["status"], "updated")
        notes = run("get_page_notes", self.me)["notes"]
        self.assertEqual((len(notes), notes[0]["content"]), (1, "v2"))

    def test_working_session_round_trip(self):
        r = run("create_working_session", self.me, name="Q4 plan")
        self.assertEqual(r["status"], "created", r)
        self.assertEqual(run("rename_working_session", self.me, session_id=r["session"]["id"], name="Q4")["status"], "updated")

    def test_team_members_is_read_only(self):
        names = {m["full_name"] for m in run("list_team_members", self.me)["members"]}
        self.assertIn("Liz Kane", names)
        self.assertFalse(any(n.startswith(("create_team", "update_team")) for n in mcp_server.list_tools()))


class RegistryShapeTests(TestCase):
    def test_no_record_tool_deletes_anything(self):
        from agents import record_tools  # noqa: F401 — imported for its registration side effect

        record_tool_names = {
            "list_reminders", "create_reminder", "update_reminder", "create_artifact", "update_artifact",
            "create_customer_contact", "update_customer_contact", "create_project", "update_project",
            "create_action_item_step", "add_comment", "create_task", "submit_feedback",
        }
        for name in record_tool_names:
            with self.subTest(tool=name):
                self.assertIn(name, mcp_server.list_tools())
                self.assertNotEqual(mcp_server.group_of(name), "delete")
        deletes = sorted(n for n in mcp_server.list_tools() if mcp_server.group_of(n) == "delete")
        self.assertEqual(deletes, ["delete_action_item", "delete_calendar_event"])
