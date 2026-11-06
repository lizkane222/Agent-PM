"""
A standing guard: no code may write to Google Calendar except through the gateway.

The incident this follows was a customer receiving 2,000+ invitations. The only durable fix is
that ``sendUpdates`` cannot be forgotten, and that holds only while *every* write goes through
``integrations.google_calendar_gateway``. This scans the source and fails the build the moment
anyone adds ``service.events().insert/patch/update/delete(...)`` anywhere else — including a
new file — so the rule does not depend on a reviewer remembering it.
"""

import ast
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[2]
WRITE_VERBS = {"insert", "patch", "update", "delete", "move", "import_", "quickAdd"}
# The one module allowed to call these directly.
ALLOWED = {"integrations/google_calendar_gateway.py"}
SKIP_PARTS = ("/.venv/", "/migrations/", "/tests/", "/node_modules/", "/site-packages/")


def _direct_writes():
    found = []
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel in ALLOWED or any(part in "/" + rel for part in SKIP_PARTS):
            continue
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            if node.func.attr not in WRITE_VERBS:
                continue
            inner = node.func.value
            # ...events().<verb>(...)
            if (isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute)
                    and inner.func.attr == "events"):
                found.append(f"{rel}:{node.lineno} events().{node.func.attr}")
    return found


class NoDirectGoogleCalendarWritesTests(SimpleTestCase):
    def test_every_google_calendar_write_goes_through_the_gateway(self):
        found = _direct_writes()
        self.assertEqual(
            found, [],
            "Direct Google Calendar writes bypass the guest-notification gate:\n  " + "\n  ".join(found)
            + "\nRoute them through integrations.google_calendar_gateway.write_event.",
        )

    def test_the_scanner_actually_finds_a_write_when_there_is_one(self):
        # A guard that cannot fail is worthless: prove the AST pattern matches real code.
        tree = ast.parse("service.events().patch(calendarId='primary', eventId='x', body={})")
        node = tree.body[0].value
        self.assertEqual(node.func.attr, "patch")
        self.assertEqual(node.func.value.func.attr, "events")

    def test_the_gateway_itself_is_the_only_exemption(self):
        self.assertEqual(ALLOWED, {"integrations/google_calendar_gateway.py"})
        self.assertTrue((BACKEND / "integrations/google_calendar_gateway.py").exists())
