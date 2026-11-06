"""
email_person and leave_note_for — the Public-profile actions the agent can take.

email_person sends nothing, so its tests assert exactly that. leave_note_for notifies another
person, so it is held to the outbound rules: unconfirmed means no note, a saved skill can
never reach it, and the app's own endpoint rules (no self-notes, no empty notes) still apply
because the tool goes through the REST bridge.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from asgiref.sync import async_to_sync

from agents import tool_policy as policy
from agents.mcp_server import mcp_server
from integrations.models import GoogleWriteLog
from team.models import LeftNote, Notification, TeamMember, UserProfile
from realtime.voice_policy import VOICE_CONFIRM_TOOLS, spoken_summary

User = get_user_model()


def run(tool, user, **args):
    return async_to_sync(mcp_server.dispatch)(tool, args, user=user)


def run_confirmed(tool, user, **args):
    return async_to_sync(mcp_server.dispatch)(tool, args, user=user, confirmed=True)


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        self.me = User.objects.create_user("liz", email="liz@twilio.com", password="x")
        UserProfile.objects.create(user=self.me, timezone="UTC")
        self.me_m = TeamMember.objects.create(user=self.me, full_name="Liz Kane", email="liz@twilio.com")
        self.ana_user = User.objects.create_user("ana", email="ana@twilio.com", password="x")
        self.ana = TeamMember.objects.create(user=self.ana_user, full_name="Ana Diaz", email="ana@twilio.com")
        self.mel = TeamMember.objects.create(full_name="Melissa Ramirez", email="mel@twilio.com")  # no login
        self.andrew_h = TeamMember.objects.create(full_name="Andrew Halaby", email="ah@twilio.com")
        self.andrew_s = TeamMember.objects.create(full_name="Andrew Stellwag", email="as@twilio.com")

    def tearDown(self):
        cache.clear()


class EmailPersonTests(_Base):
    def test_returns_a_compose_link_and_says_nothing_was_sent(self):
        r = run("email_person", self.me, person="Ana Diaz")
        self.assertEqual(r["status"], "found")
        self.assertFalse(r["sent"])
        self.assertTrue(r["compose_url"].startswith("https://mail.google.com/mail/?view=cm"))
        self.assertIn("to=ana@twilio.com", r["compose_url"])

    def test_sends_and_writes_nothing(self):
        run("email_person", self.me, person="Ana Diaz")
        self.assertEqual(GoogleWriteLog.objects.count(), 0)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_tolerates_a_misheard_name(self):
        self.assertEqual(run("email_person", self.me, person="Melisa Ramires")["person"]["name"], "Melissa Ramirez")

    def test_an_ambiguous_name_is_not_guessed(self):
        r = run("email_person", self.me, person="Andrew")
        self.assertEqual(r["status"], "ambiguous")
        self.assertNotIn("compose_url", r)

    def test_unknown_name(self):
        self.assertEqual(run("email_person", self.me, person="Zzyzx Quux")["status"], "not_found")

    def test_requires_a_signed_in_user(self):
        r = async_to_sync(mcp_server.dispatch)("email_person", {"person": "Ana Diaz"}, user=None)
        self.assertEqual(r["status"], "error")

    def test_schema_refuses_unknown_keys_and_overlong_names(self):
        self.assertEqual(run("email_person", self.me, person="Ana", cc="x")["status"], "error")
        self.assertEqual(run("email_person", self.me, person="A" * 500)["status"], "error")

    def test_is_not_available_to_a_saved_skill(self):
        token = policy.active_skill.set(policy.SkillScope("s", frozenset({"email_person"})))
        try:
            r = run("email_person", self.me, person="Ana Diaz")
        finally:
            policy.active_skill.reset(token)
        self.assertEqual(r["error_code"], "not_allowed_in_skill")


class LeaveNoteForTests(_Base):
    def test_unconfirmed_call_leaves_nothing_and_asks_for_approval(self):
        r = run("leave_note_for", self.me, person="Ana Diaz", note="Call me")
        self.assertEqual(r["error_code"], "confirmation_required")
        self.assertEqual(LeftNote.objects.count(), 0)
        self.assertEqual(Notification.objects.count(), 0)

    def test_confirmed_call_leaves_a_private_note_and_notifies_the_recipient(self):
        r = run_confirmed("leave_note_for", self.me, person="Ana Diaz", note="Call me")
        self.assertEqual(r["status"], "sent")
        note = LeftNote.objects.get()
        self.assertEqual((note.author, note.recipient, note.body), (self.me, self.ana_user, "Call me"))
        self.assertEqual(Notification.objects.get(user=self.ana_user).kind, "note_for_you")
        self.assertFalse(Notification.objects.filter(user=self.me).exists())

    def test_cannot_leave_a_note_for_yourself(self):
        r = run_confirmed("leave_note_for", self.me, person="Liz Kane", note="hi")
        self.assertEqual(r["status"], "error")
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_cannot_leave_a_note_for_someone_without_an_account(self):
        r = run_confirmed("leave_note_for", self.me, person="Melissa Ramirez", note="hi")
        self.assertEqual(r["status"], "error")
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_an_ambiguous_name_sends_nothing(self):
        r = run_confirmed("leave_note_for", self.me, person="Andrew", note="hi")
        self.assertEqual(r["status"], "ambiguous")
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_an_empty_note_is_refused(self):
        r = run_confirmed("leave_note_for", self.me, person="Ana Diaz", note="   ")
        self.assertEqual(r["status"], "error")
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_schema_refuses_unknown_keys_and_overlong_notes(self):
        self.assertEqual(run_confirmed("leave_note_for", self.me, person="Ana Diaz", note="x", to="y")["status"], "error")
        self.assertEqual(run_confirmed("leave_note_for", self.me, person="Ana Diaz", note="x" * 5000)["status"], "error")
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_the_note_is_not_public(self):
        from team.models import PublicItem

        run_confirmed("leave_note_for", self.me, person="Ana Diaz", note="private")
        self.assertEqual(PublicItem.objects.count(), 0)

    def test_a_saved_skill_can_never_reach_it_even_if_it_lists_it_and_claims_confirmed(self):
        token = policy.active_skill.set(policy.SkillScope("s", frozenset({"leave_note_for"})))
        try:
            r = run_confirmed("leave_note_for", self.me, person="Ana Diaz", note="hi")
        finally:
            policy.active_skill.reset(token)
        self.assertEqual(r["error_code"], "not_allowed_in_skill")
        self.assertEqual(LeftNote.objects.count(), 0)

    def test_is_gated_on_chat_and_voice_and_banned_from_skills(self):
        self.assertIn("leave_note_for", policy.CONFIRM_REQUIRED)
        self.assertIn("leave_note_for", policy.NEVER_SKILL_SAFE)
        self.assertIn("leave_note_for", VOICE_CONFIRM_TOOLS)
        self.assertNotIn("leave_note_for", mcp_server.skill_safe_tools())

    def test_the_spoken_question_names_the_person_and_reads_the_note_back(self):
        spoken = spoken_summary("leave_note_for", {"person": "Ana Diaz", "note": "Call me about Acme"})
        self.assertIn("Ana Diaz", spoken)
        self.assertIn("Call me about Acme", spoken)
