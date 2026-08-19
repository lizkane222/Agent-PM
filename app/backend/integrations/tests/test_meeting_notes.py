"""Tests for integrations.meeting_notes and the Gmail helpers it shares.

The Gmail API is replaced by `FakeGmail` (below) rather than mocked call-by-call, so
the tests exercise the real query-building, header-reading and body-decoding path and
only the network is fake.
"""

import base64
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from airtable_sync.models import AirtableAccount, AirtableMeeting
from integrations import gmail_utils, meeting_notes
from integrations.models import OAuthCredential

User = get_user_model()


# ── Fakes and helpers ─────────────────────────────────────────────────────────

def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def gmail_message(msg_id, subject, from_addr, date_str, body, mime_type="text/plain"):
    """A minimal single-part Gmail message resource."""
    return {
        "id": msg_id,
        "payload": {
            "mimeType": mime_type,
            "headers": [
                {"name": "Subject", "value": subject},
                {"name": "From", "value": from_addr},
                {"name": "Date", "value": date_str},
            ],
            "body": {"data": _b64(body)},
        },
    }


class _Exec:
    def __init__(self, value):
        self._value = value

    def execute(self):
        return self._value


class FakeGmail:
    """Stands in for the googleapiclient Gmail service.

    `users()`, `messages()` all return self, matching the builder-style chain the
    real client uses. Records the query it was asked for so tests can assert on it.
    """

    def __init__(self, messages):
        self._messages = {m["id"]: m for m in messages}
        self.last_query = None
        self.last_max_results = None

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, userId=None, q=None, maxResults=None):
        self.last_query = q
        self.last_max_results = maxResults
        return _Exec({"messages": [{"id": mid} for mid in self._messages]})

    def get(self, userId=None, id=None, format=None):
        return _Exec(self._messages[id])


def rfc2822(dt) -> str:
    from email.utils import format_datetime
    return format_datetime(dt)


GONG_FROM = "Gong <no-reply@gong.io>"
ZOOM_FROM = "Zoom <no-reply@zoom.us>"


# ── Title / date matching ─────────────────────────────────────────────────────

class TitleMatchingTests(TestCase):
    def test_strips_vendor_subject_boilerplate(self):
        cases = [
            ("Gong Call Recap: Acme <> Twilio Weekly Sync", "acme twilio"),
            ("Your call recap: Acme Q3 Planning - Mar 3, 2026", "acme q3 planning"),
            ("Meeting Summary with Acme Q3 Planning", "acme q3 planning"),
            ("Zoom AI Companion: Acme Q3 Planning (Recording)", "acme q3 planning"),
            ("Re: Gong Call Recap: Acme Q3 Planning", "acme q3 planning"),
        ]
        for subject, expected in cases:
            with self.subTest(subject=subject):
                self.assertEqual(meeting_notes.normalize_title(subject), expected)

    def test_matches_meeting_name_to_vendor_subject(self):
        self.assertTrue(meeting_notes.titles_match(
            "Acme <> Twilio Weekly Sync", "Gong Call Recap: Acme <> Twilio Weekly Sync"
        ))
        self.assertTrue(meeting_notes.titles_match(
            "Acme Q3 Planning", "Your call recap: Acme Q3 Planning"
        ))

    def test_rejects_a_different_meeting(self):
        self.assertFalse(meeting_notes.titles_match(
            "Acme Q3 Planning", "Gong Call Recap: Beta Corp Kickoff"
        ))

    def test_all_stopword_title_still_matches_itself(self):
        """'Weekly Sync' is entirely stopwords — it must not normalise to empty."""
        self.assertNotEqual(meeting_notes.normalize_title("Weekly Sync"), "")
        self.assertTrue(meeting_notes.titles_match("Weekly Sync", "Gong Call Recap: Weekly Sync"))

    def test_empty_side_never_matches(self):
        self.assertFalse(meeting_notes.titles_match("", "Gong Call Recap: Acme"))
        self.assertFalse(meeting_notes.titles_match("Acme Q3 Planning", ""))

    def test_short_titles_do_not_match_by_containment(self):
        """A 3-letter name inside a longer subject is a coincidence, not a match."""
        self.assertFalse(meeting_notes.titles_match("QBR", "Gong Call Recap: Beta Corp Kickoff QBR Prep Deep Dive"))


class DateMatchingTests(TestCase):
    def setUp(self):
        self.meeting_at = timezone.now() - timedelta(days=2)

    def test_email_shortly_after_meeting_matches(self):
        self.assertTrue(meeting_notes.dates_match(
            self.meeting_at, self.meeting_at + timedelta(hours=2)
        ))

    def test_email_three_days_after_matches(self):
        self.assertTrue(meeting_notes.dates_match(
            self.meeting_at, self.meeting_at + timedelta(days=3)
        ))

    def test_email_four_days_after_does_not_match(self):
        self.assertFalse(meeting_notes.dates_match(
            self.meeting_at, self.meeting_at + timedelta(days=4)
        ))

    def test_email_two_days_before_does_not_match(self):
        self.assertFalse(meeting_notes.dates_match(
            self.meeting_at, self.meeting_at - timedelta(days=2)
        ))

    def test_missing_date_does_not_match(self):
        self.assertFalse(meeting_notes.dates_match(None, self.meeting_at))
        self.assertFalse(meeting_notes.dates_match(self.meeting_at, None))


# ── Gmail body extraction ─────────────────────────────────────────────────────

class GmailBodyExtractionTests(TestCase):
    def test_strip_html_keeps_block_structure_as_newlines(self):
        html = "<div>Recap</div><ul><li>Point one</li><li>Point two</li></ul>"
        text = gmail_utils.strip_html(html)
        self.assertIn("Recap", text)
        self.assertIn("Point one", text)
        self.assertIn("Point two", text)
        # Block ends became line breaks rather than running the words together, so the
        # vendor's bullet structure survives into parseBullets() on the frontend.
        self.assertEqual(text.splitlines(), ["Recap", "Point one", "Point two"])

    def test_strip_html_drops_scripts_and_decodes_entities(self):
        html = "<style>p{color:red}</style><script>evil()</script><p>A &amp; B&nbsp;C</p>"
        text = gmail_utils.strip_html(html)
        self.assertNotIn("evil", text)
        self.assertNotIn("color:red", text)
        self.assertIn("A & B C", text)

    def test_extract_plain_body_prefers_text_plain(self):
        payload = {
            "mimeType": "multipart/alternative",
            "parts": [
                {"mimeType": "text/plain", "body": {"data": _b64("PLAIN VERSION")}},
                {"mimeType": "text/html", "body": {"data": _b64("<p>HTML VERSION</p>")}},
            ],
        }
        self.assertEqual(gmail_utils.extract_plain_body(payload).strip(), "PLAIN VERSION")

    def test_extract_plain_body_falls_back_to_flattened_html(self):
        payload = {
            "mimeType": "multipart/alternative",
            "parts": [
                {"mimeType": "text/plain", "body": {"data": _b64("   ")}},
                {"mimeType": "text/html", "body": {"data": _b64("<p>HTML VERSION</p>")}},
            ],
        }
        self.assertEqual(gmail_utils.extract_plain_body(payload).strip(), "HTML VERSION")

    def test_header_lookup_is_case_insensitive(self):
        msg = {"payload": {"headers": [{"name": "SuBjEcT", "value": "Hello"}]}}
        self.assertEqual(gmail_utils.header(msg, "subject"), "Hello")
        self.assertEqual(gmail_utils.header(msg, "missing"), "")

    def test_malformed_base64_returns_empty_string(self):
        payload = {"mimeType": "text/plain", "body": {"data": "!!!not-base64!!!"}}
        # Should not raise — a single bad part must not sink the scan.
        self.assertIsInstance(gmail_utils.extract_plain_body(payload), str)


# ── Fallback bulleting and URL extraction ─────────────────────────────────────

class FallbackBulletsTests(TestCase):
    def test_existing_bullets_and_headings_are_preserved(self):
        body = "Recap\n- Talked about pricing\nKey Points\n- Needs SSO"
        out = meeting_notes.fallback_bullets(body)
        self.assertEqual(
            out.splitlines(),
            ["Recap", "- Talked about pricing", "Key Points", "- Needs SSO"],
        )

    def test_bare_lines_get_a_bullet_marker(self):
        self.assertEqual(meeting_notes.fallback_bullets("They want SSO"), "- They want SSO")

    def test_email_footers_are_dropped(self):
        body = "Recap\n- Discussed rollout\nUnsubscribe from these emails\n© 2026 Gong"
        out = meeting_notes.fallback_bullets(body)
        self.assertIn("- Discussed rollout", out)
        self.assertNotIn("Unsubscribe", out)
        self.assertNotIn("2026 Gong", out)

    def test_output_is_length_capped(self):
        out = meeting_notes.fallback_bullets("x" * 10000, max_chars=100)
        self.assertLessEqual(len(out), 100)


class ProviderUrlTests(TestCase):
    def test_picks_the_matching_domain(self):
        body = "See https://example.com/other and https://us02web.zoom.us/rec/share/abc"
        self.assertEqual(
            meeting_notes.extract_provider_url(body, ("zoom.us",)),
            "https://us02web.zoom.us/rec/share/abc",
        )

    def test_returns_empty_when_no_match(self):
        self.assertEqual(meeting_notes.extract_provider_url("no links here", ("gong.io",)), "")


class SummarizeEmailTests(TestCase):
    @override_settings(ANTHROPIC_API_KEY="")
    def test_no_api_key_uses_the_vendor_text(self):
        out = meeting_notes.summarize_email("Recap\n- Talked pricing", "Acme Sync", "gong")
        self.assertIn("- Talked pricing", out)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_empty_body_returns_empty(self):
        self.assertEqual(meeting_notes.summarize_email("   ", "Acme Sync", "gong"), "")

    @override_settings(ANTHROPIC_API_KEY="sk-test")
    def test_claude_output_is_used_when_available(self):
        block = MagicMock()
        block.type = "text"
        block.text = "Recap\n- Claude wrote this"
        fake_client = MagicMock()
        fake_client.messages.create.return_value = MagicMock(content=[block])

        with patch("anthropic.Anthropic", return_value=fake_client):
            out = meeting_notes.summarize_email("raw email text", "Acme Sync", "gong")

        self.assertEqual(out, "Recap\n- Claude wrote this")
        self.assertEqual(
            fake_client.messages.create.call_args.kwargs["model"],
            meeting_notes.SUMMARY_MODEL,
        )

    @override_settings(ANTHROPIC_API_KEY="sk-test")
    def test_claude_failure_falls_back_to_vendor_text(self):
        fake_client = MagicMock()
        fake_client.messages.create.side_effect = RuntimeError("boom")

        with patch("anthropic.Anthropic", return_value=fake_client):
            out = meeting_notes.summarize_email("Recap\n- Talked pricing", "Acme Sync", "gong")

        self.assertIn("- Talked pricing", out)


# ── Scoping ───────────────────────────────────────────────────────────────────

class VisibleMeetingsTests(TestCase):
    def setUp(self):
        self.at_account = AirtableAccount.objects.create(airtable_id="recACCT1", name="Acme Corp")
        self.meeting = AirtableMeeting.objects.create(
            airtable_id="recMTG1", account=self.at_account,
            name="Acme Sync", date=timezone.now() - timedelta(days=1),
        )

    def test_team_member_sees_the_accounts_meetings(self):
        from accounts.models import Account
        from team.models import TeamMember
        user = User.objects.create_user("member", password="pass")
        acct = Account.objects.create(company_name="Acme Corp", airtable_id="recACCT1")
        member = TeamMember.objects.create(user=user, full_name="A Member", email="a@example.com")
        acct.team_members.add(member)

        self.assertIn(self.meeting, meeting_notes.visible_meetings_for(user))

    def test_calendar_event_owner_sees_the_linked_meeting(self):
        from scheduler.models import CalendarEvent
        user = User.objects.create_user("owner", password="pass")
        CalendarEvent.objects.create(
            owner=user, title="Acme Sync",
            start_datetime=timezone.now(), end_datetime=timezone.now(),
            agentpm_airtable_id="recMTG1",
        )
        self.assertIn(self.meeting, meeting_notes.visible_meetings_for(user))

    def test_unrelated_user_sees_nothing(self):
        user = User.objects.create_user("outsider", password="pass")
        self.assertEqual(list(meeting_notes.visible_meetings_for(user)), [])

    def test_staff_sees_everything(self):
        staff = User.objects.create_user("boss", password="pass", is_staff=True)
        self.assertIn(self.meeting, meeting_notes.visible_meetings_for(staff))


class CandidateMeetingsTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("staff", password="pass", is_staff=True)
        self.acme = AirtableAccount.objects.create(airtable_id="recA", name="Acme Corp")
        self.beta = AirtableAccount.objects.create(airtable_id="recB", name="Beta Corp")

    def _meeting(self, name, account, days_ago):
        return AirtableMeeting.objects.create(
            airtable_id=f"rec{name.replace(' ', '')}", account=account, name=name,
            date=timezone.now() - timedelta(days=days_ago),
        )

    def test_excludes_meetings_outside_the_lookback_window(self):
        recent = self._meeting("Recent Sync", self.acme, 5)
        old = self._meeting("Old Sync", self.acme, 90)
        found = list(meeting_notes.candidate_meetings(self.staff, days=30))
        self.assertIn(recent, found)
        self.assertNotIn(old, found)

    def test_excludes_future_meetings(self):
        future = AirtableMeeting.objects.create(
            airtable_id="recFuture", account=self.acme, name="Future Sync",
            date=timezone.now() + timedelta(days=3),
        )
        self.assertNotIn(future, list(meeting_notes.candidate_meetings(self.staff, days=30)))

    def test_excludes_meetings_with_no_date(self):
        undated = AirtableMeeting.objects.create(
            airtable_id="recUndated", account=self.acme, name="Undated", date=None
        )
        self.assertNotIn(undated, list(meeting_notes.candidate_meetings(self.staff, days=30)))

    def test_account_name_filter_narrows_to_one_account(self):
        acme_mtg = self._meeting("Acme Sync", self.acme, 2)
        beta_mtg = self._meeting("Beta Sync", self.beta, 2)
        found = list(meeting_notes.candidate_meetings(self.staff, days=30, account_name="acme corp"))
        self.assertIn(acme_mtg, found)
        self.assertNotIn(beta_mtg, found)


# ── End-to-end sync ───────────────────────────────────────────────────────────

@patch("airtable_sync.write_back.get_table", MagicMock())
class SyncMeetingNotesTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("scanner", password="pass", is_staff=True)
        self.account = AirtableAccount.objects.create(airtable_id="recACCT1", name="Acme Corp")
        self.meeting_at = timezone.now() - timedelta(days=2)
        self.meeting = AirtableMeeting.objects.create(
            airtable_id="recMTG1", account=self.account,
            name="Acme Q3 Planning", date=self.meeting_at,
        )

    def _sync(self, messages, **kwargs):
        """Run the scan with a deterministic summariser so assertions are on matching."""
        with patch(
            "integrations.meeting_notes.summarize_email",
            side_effect=lambda body, name, source: f"Recap\n- {source} summary",
        ):
            return meeting_notes.sync_meeting_notes_from_email(
                self.user, gmail=FakeGmail(messages), **kwargs
            )

    def test_gong_recap_fills_gong_notes(self):
        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)),
            "Recap\n- Discussed pricing",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "Recap\n- gong summary")
        self.assertEqual(self.meeting.zoom_notes, "")
        self.assertEqual(len(report["updated"]), 1)
        self.assertEqual(report["updated"][0]["sources"], ["gong"])

    def test_zoom_recap_fills_zoom_notes(self):
        report = self._sync([gmail_message(
            "m1", "Meeting Summary with Acme Q3 Planning", ZOOM_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)),
            "Quick recap\n- Discussed rollout",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.zoom_notes, "Recap\n- zoom summary")
        self.assertEqual(self.meeting.gong_notes, "")
        self.assertEqual(report["updated"][0]["sources"], ["zoom"])

    def test_both_providers_are_stored_with_gong_listed_first(self):
        report = self._sync([
            gmail_message("m1", "Meeting Summary with Acme Q3 Planning", ZOOM_FROM,
                          rfc2822(self.meeting_at + timedelta(hours=2)), "zoom body"),
            gmail_message("m2", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
                          rfc2822(self.meeting_at + timedelta(hours=1)), "gong body"),
        ])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "Recap\n- gong summary")
        self.assertEqual(self.meeting.zoom_notes, "Recap\n- zoom summary")
        # Gong is the preferred source, so it is reported first.
        self.assertEqual(report["updated"][0]["sources"], ["gong", "zoom"])

    def test_existing_gong_notes_are_never_overwritten(self):
        self.meeting.gong_notes = "Hand-written notes"
        self.meeting.save()

        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)), "gong body",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "Hand-written notes")
        self.assertEqual(report["updated"], [])
        self.assertEqual(report["skipped"][0]["reason"], "already_summarized")

    def test_zoom_still_fills_when_only_gong_is_present(self):
        """Per-provider, not per-meeting: an existing Gong recap doesn't block Zoom."""
        self.meeting.gong_notes = "Hand-written Gong notes"
        self.meeting.save()

        self._sync([gmail_message(
            "m1", "Meeting Summary with Acme Q3 Planning", ZOOM_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)), "zoom body",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "Hand-written Gong notes")
        self.assertEqual(self.meeting.zoom_notes, "Recap\n- zoom summary")

    def test_newline_only_notes_count_as_empty_and_are_filled(self):
        """A meeting whose Airtable recap cell was cleared reports "\\n", not "".

        Treating that as an existing summary would skip the meeting on every future run,
        so the import could never recover a recap that was once deleted by hand.
        """
        self.meeting.gong_notes = "\n"
        self.meeting.save()

        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)), "gong body",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "Recap\n- gong summary")
        self.assertEqual(report["updated"][0]["sources"], ["gong"])

    def test_wrong_title_does_not_match(self):
        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Beta Corp Kickoff", GONG_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)), "gong body",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "")
        self.assertEqual(report["skipped"][0]["reason"], "no_matching_email")

    def test_email_outside_the_date_window_does_not_match(self):
        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
            rfc2822(self.meeting_at + timedelta(days=10)), "gong body",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "")
        self.assertEqual(report["updated"], [])

    def test_non_vendor_sender_is_ignored(self):
        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", "Someone <bob@example.com>",
            rfc2822(self.meeting_at + timedelta(hours=1)), "gong body",
        )])

        self.assertEqual(report["scanned_emails"], 0)
        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "")

    def test_unparseable_date_header_is_skipped_not_fatal(self):
        report = self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
            "not a date at all", "gong body",
        )])

        self.assertEqual(report["scanned_emails"], 0)
        self.assertEqual(report["updated"], [])

    def test_closest_email_wins_when_a_provider_sent_two(self):
        with patch(
            "integrations.meeting_notes.summarize_email",
            side_effect=lambda body, name, source: body,
        ):
            meeting_notes.sync_meeting_notes_from_email(self.user, gmail=FakeGmail([
                gmail_message("m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
                              rfc2822(self.meeting_at + timedelta(days=2)), "FAR"),
                gmail_message("m2", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
                              rfc2822(self.meeting_at + timedelta(minutes=20)), "NEAR"),
            ]))

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "NEAR")

    def test_recording_url_is_captured_when_blank(self):
        with patch(
            "integrations.meeting_notes.summarize_email",
            side_effect=lambda body, name, source: "Recap\n- x",
        ):
            meeting_notes.sync_meeting_notes_from_email(self.user, gmail=FakeGmail([
                gmail_message(
                    "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
                    rfc2822(self.meeting_at + timedelta(hours=1)),
                    "Listen at https://us-12345.app.gong.io/call?id=99",
                ),
            ]))

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_url, "https://us-12345.app.gong.io/call?id=99")

    def test_existing_recording_url_is_left_alone(self):
        self.meeting.gong_url = "https://gong.io/original"
        self.meeting.save()

        self._sync([gmail_message(
            "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
            rfc2822(self.meeting_at + timedelta(hours=1)),
            "Listen at https://us-12345.app.gong.io/call?id=99",
        )])

        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_url, "https://gong.io/original")

    def test_summary_cap_is_reported_rather_than_silently_dropping_matches(self):
        second = AirtableMeeting.objects.create(
            airtable_id="recMTG2", account=self.account,
            name="Acme Renewal Review", date=self.meeting_at,
        )
        report = self._sync(
            [
                gmail_message("m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
                              rfc2822(self.meeting_at + timedelta(hours=1)), "a"),
                gmail_message("m2", "Gong Call Recap: Acme Renewal Review", GONG_FROM,
                              rfc2822(self.meeting_at + timedelta(hours=1)), "b"),
            ],
            max_summaries=1,
        )

        self.assertTrue(report["summaries_truncated"])
        self.assertEqual(len(report["updated"]), 1)
        capped = [s for s in report["skipped"] if s["reason"] == "summary_limit_reached"]
        self.assertEqual(len(capped), 1)
        second.refresh_from_db()
        self.assertEqual(second.gong_notes, "")

    def test_days_argument_is_clamped_to_the_ceiling(self):
        report = self._sync([], days=9999)
        self.assertEqual(report["days"], meeting_notes.MAX_LOOKBACK_DAYS)

    def test_search_query_covers_every_provider_domain(self):
        gmail = FakeGmail([])
        with patch("integrations.meeting_notes.summarize_email", return_value=""):
            meeting_notes.sync_meeting_notes_from_email(self.user, gmail=gmail)
        for domain in ("gong.io", "zoom.us", "zoom.com"):
            self.assertIn(f"from:{domain}", gmail.last_query)
        self.assertIn("after:", gmail.last_query)

    def test_no_gmail_credential_raises_gmail_not_connected(self):
        with self.assertRaises(meeting_notes.GmailNotConnected):
            meeting_notes.sync_meeting_notes_from_email(self.user)

    def test_a_non_member_scans_none_of_their_colleagues_meetings(self):
        outsider = User.objects.create_user("outsider2", password="pass")
        with patch("integrations.meeting_notes.summarize_email", return_value="Recap\n- x"):
            report = meeting_notes.sync_meeting_notes_from_email(
                outsider,
                gmail=FakeGmail([gmail_message(
                    "m1", "Gong Call Recap: Acme Q3 Planning", GONG_FROM,
                    rfc2822(self.meeting_at + timedelta(hours=1)), "gong body",
                )]),
            )
        self.assertEqual(report["scanned_meetings"], 0)
        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.gong_notes, "")


class BuildGmailServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("creduser", password="pass")

    def test_returns_none_without_a_credential(self):
        self.assertIsNone(gmail_utils.build_gmail_service(self.user))

    def test_prefers_the_dedicated_gmail_credential_over_the_google_one(self):
        OAuthCredential.objects.create(
            user=self.user, provider="google", access_token="google-token", scopes="a"
        )
        OAuthCredential.objects.create(
            user=self.user, provider="gmail", access_token="gmail-token", scopes="a"
        )
        cred = gmail_utils.find_gmail_credential(self.user)
        self.assertEqual(cred.provider, "gmail")

    def test_falls_back_to_the_combined_google_credential(self):
        OAuthCredential.objects.create(
            user=self.user, provider="google", access_token="google-token", scopes="a"
        )
        cred = gmail_utils.find_gmail_credential(self.user)
        self.assertEqual(cred.provider, "google")

    def test_inactive_credentials_are_ignored(self):
        OAuthCredential.objects.create(
            user=self.user, provider="gmail", access_token="t", scopes="a", is_active=False
        )
        self.assertIsNone(gmail_utils.find_gmail_credential(self.user))
