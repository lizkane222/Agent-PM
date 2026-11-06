"""
The Google permissions this app asks for are a security boundary.

A customer received 2,000+ calendar invitation emails from the user's Google account. Code can
be made safe, but a broad OAuth grant remains a standing capability: if any bug (or any future
edit) emailed from the account, Google would allow it. Asking for the narrowest scopes removes
that possibility at Google's level instead of relying on our code being right.

These tests pin the contract so a later edit cannot quietly widen it.
"""

from django.test import SimpleTestCase

from integrations import views

SEND = "https://www.googleapis.com/auth/gmail.send"
GMAIL_FULL = "https://mail.google.com/"
CALENDAR_FULL = "https://www.googleapis.com/auth/calendar"
CALENDAR_RO = "https://www.googleapis.com/auth/calendar.readonly"
CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events"
CALENDAR_FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy"
GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify"

ALL_FLOWS = {
    "calendar": views.GOOGLE_SCOPES,
    "gmail": views.GMAIL_SCOPES,
    "drive": views.GOOGLE_DRIVE_SCOPES,
}


class NoScopeCanSendMailTests(SimpleTestCase):
    def test_no_flow_requests_the_ability_to_send_email(self):
        for flow, scopes in ALL_FLOWS.items():
            with self.subTest(flow=flow):
                self.assertNotIn(SEND, scopes, "gmail.send can email from the user's address")
                self.assertNotIn(GMAIL_FULL, scopes, "full Gmail access includes sending")

    def test_no_scope_anywhere_mentions_sending(self):
        for flow, scopes in ALL_FLOWS.items():
            for scope in scopes:
                with self.subTest(flow=flow, scope=scope):
                    self.assertNotIn("send", scope.lower())


class CalendarFlowIsNarrowTests(SimpleTestCase):
    def test_the_calendar_flow_asks_only_for_events_and_free_busy(self):
        scopes = set(views.GOOGLE_SCOPES)
        self.assertIn(CALENDAR_EVENTS, scopes)
        self.assertIn(CALENDAR_FREEBUSY, scopes)

    def test_the_calendar_flow_does_not_request_full_calendar_access(self):
        # `calendar` additionally grants calendar settings, sharing and ACLs, which nothing needs.
        self.assertNotIn(CALENDAR_FULL, views.GOOGLE_SCOPES)

    def test_the_calendar_flow_has_no_redundant_readonly_scope(self):
        self.assertNotIn(CALENDAR_RO, views.GOOGLE_SCOPES)

    def test_the_calendar_flow_may_carry_gmail_modify_for_the_documented_fallback(self):
        # DELIBERATE, and flagged for the product owner: `integrations/gmail_utils.py` documents
        # that "some accounts only ever authorised the combined Google credential (Calendar +
        # Gmail)", and find_gmail_credential() falls back to it. Dropping gmail.modify here would
        # silently break Gmail for those users. It cannot send mail (that is gmail.send, banned
        # above), so keeping it does not reopen the incident. Remove it only together with a
        # migration plan for those users.
        gmail_like = [s for s in views.GOOGLE_SCOPES if "gmail" in s or "mail.google" in s]
        self.assertEqual(gmail_like, [GMAIL_MODIFY])


class GmailFlowIsNarrowTests(SimpleTestCase):
    def test_the_gmail_flow_can_modify_labels_but_not_send(self):
        self.assertIn(GMAIL_MODIFY, views.GMAIL_SCOPES)
        self.assertNotIn(SEND, views.GMAIL_SCOPES)

    def test_the_gmail_flow_does_not_request_calendar(self):
        self.assertEqual([s for s in views.GMAIL_SCOPES if "calendar" in s], [])


class EveryApiCallIsCoveredByARequestedScopeTests(SimpleTestCase):
    """Narrowing is only safe if nothing the app does needs a scope it no longer asks for."""

    def test_the_calendar_methods_the_code_uses_are_covered(self):
        # events.list / watch / insert / patch / update / delete -> calendar.events
        # freebusy.query                                           -> calendar.freebusy
        covered = set(views.GOOGLE_SCOPES)
        for needed in (CALENDAR_EVENTS, CALENDAR_FREEBUSY):
            self.assertIn(needed, covered)

    def test_the_gmail_methods_the_code_uses_are_covered(self):
        # threads.get/list, history.list, watch, getProfile, labels.*, messages.modify -> gmail.modify
        self.assertIn(GMAIL_MODIFY, views.GMAIL_SCOPES)
