"""
The guard tests must still exist, still be tests, and still say what they say.

A rule in CLAUDE.md does not stop a future change deleting the test that enforces it, or renaming
``test_reschedule_does_NOT_notify_guests`` back to ``test_reschedule_notifies_guests``. This reads
the test sources and fails if the incident-pinning tests are removed, renamed, skipped or have
their key assertions inverted.

If this test fails, do NOT edit it to pass. It means someone weakened the governance that stops
the app emailing a customer thousands of times. Stop and ask the user.
"""

import ast
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[2]

# file -> test method names that must exist (and must not be skipped).
REQUIRED = {
    "scheduler/tests/test_views.py": [
        "test_reschedule_does_NOT_notify_guests",
        "test_omitted_flag_does_NOT_email_guests",
        "test_guests_are_emailed_when_send_invites_is_true",
    ],
    "scheduler/tests/test_guest_notifications.py": [
        "test_moving_a_meeting_never_emails_the_guests",
        "test_moving_a_meeting_a_hundred_times_emails_nobody",
        "test_create_with_guests_and_NO_send_invites_flag_emails_nobody",
    ],
    "integrations/tests/test_invite_gate.py": [
        "test_q1_an_invite_already_sent_is_never_sent_again",
        "test_a_recurring_instance_never_sends",
        "test_an_event_beyond_the_horizon_never_sends",
        "test_once_anyone_was_emailed_a_newcomer_is_not_notified_because_google_would_re_email_everyone",
    ],
    "integrations/tests/test_google_calendar_gateway.py": [
        "test_a_hundred_writes_notify_at_most_once",
        "test_a_sync_loop_rewriting_the_same_event_emails_at_most_once",
        "test_730_instances_of_one_series_email_nobody",
        "test_an_event_years_away_is_never_notified",
    ],
    "integrations/tests/test_incremental_sync.py": ["test_a_hundred_sync_runs_send_no_notifications"],
    "integrations/tests/test_no_direct_google_writes.py": [
        "test_every_google_calendar_write_goes_through_the_gateway",
    ],
    "integrations/tests/test_google_scopes.py": ["test_no_flow_requests_the_ability_to_send_email"],
    "agents/tests/test_outbound_approval.py": [
        "test_every_outbound_tool_requires_approval_on_chat",
        "test_every_outbound_tool_requires_approval_on_voice",
        "test_a_skill_cannot_run_any_outbound_tool_even_if_it_lists_it",
    ],
}

# Names that must NOT come back: they assert the behaviour that caused the incident.
FORBIDDEN_NAMES = {
    "test_reschedule_notifies_guests",
    "test_omitted_flag_defaults_to_sending_when_there_are_guests",
}


def _tests_in(path: Path) -> dict[str, ast.FunctionDef]:
    tree = ast.parse(path.read_text())
    return {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _is_skipped(node) -> bool:
    for d in node.decorator_list:
        text = ast.unparse(d)
        if "skip" in text or "expectedFailure" in text:
            return True
    return False


class GovernanceTestsStillExistTests(SimpleTestCase):
    def test_every_required_guard_test_exists_and_is_not_skipped(self):
        problems = []
        for rel, names in REQUIRED.items():
            path = BACKEND / rel
            if not path.exists():
                problems.append(f"{rel}: FILE DELETED")
                continue
            found = _tests_in(path)
            for name in names:
                if name not in found:
                    problems.append(f"{rel}: {name} is missing (deleted or renamed)")
                elif _is_skipped(found[name]):
                    problems.append(f"{rel}: {name} is skipped")
        self.assertEqual(problems, [], "\n".join(problems))

    def test_the_old_unsafe_test_names_have_not_come_back(self):
        path = BACKEND / "scheduler/tests/test_views.py"
        back = FORBIDDEN_NAMES & set(_tests_in(path))
        self.assertFalse(back, f"restored a test that asserts the incident behaviour: {sorted(back)}")

    def _asserted_values(self, name: str) -> list[str]:
        """Constants compared inside assertEqual/assertNotEqual of the named test (not comments)."""
        node = _tests_in(BACKEND / "scheduler/tests/test_views.py")[name]
        out = []
        for call in ast.walk(node):
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) \
                    and call.func.attr in ("assertEqual", "assertNotEqual"):
                out.extend(repr(a.value) for a in call.args if isinstance(a, ast.Constant))
        return out

    def test_the_move_test_still_asserts_none_and_not_all(self):
        # Reads the ASSERTIONS, not the text: the test's comment quotes the old "all" on purpose.
        values = self._asserted_values("test_reschedule_does_NOT_notify_guests")
        self.assertIn("'none'", values)
        self.assertNotIn("'all'", values, "the move test must assert sendUpdates is NOT 'all'")

    def test_the_omitted_flag_test_still_asserts_none(self):
        values = self._asserted_values("test_omitted_flag_does_NOT_email_guests")
        self.assertIn("'none'", values)
        self.assertNotIn("'all'", values)

    def test_the_assertion_reader_actually_finds_assertions(self):
        # An extractor that returns nothing would make the two tests above fail or pass vacuously.
        self.assertTrue(self._asserted_values("test_reschedule_does_NOT_notify_guests"))

    def test_the_default_for_an_absent_send_invites_is_still_no(self):
        from scheduler.views import _send_invites_flag

        class E:
            attendees = [{"email": "a@x.com"}]
            owner = None

        self.assertFalse(_send_invites_flag({}, E()))
        self.assertFalse(_send_invites_flag(None, E()))

    def test_the_master_switch_defaults_off(self):
        from django.conf import settings
        import os

        # The env may turn it on locally; the DEFAULT in code must be off.
        src = (BACKEND / "core/settings.py").read_text()
        self.assertIn('os.getenv("GOOGLE_GUEST_NOTIFICATIONS", "off")', src)

    def test_claude_md_still_carries_the_governance_section(self):
        text = (BACKEND.parents[1] / "CLAUDE.md").read_text()
        for needle in ("Outbound communication governance", "NEVER restore the old behaviour",
                       "test_reschedule_does_NOT_notify_guests"):
            self.assertIn(needle, text, f"CLAUDE.md lost: {needle}")
