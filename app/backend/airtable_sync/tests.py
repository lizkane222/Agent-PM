"""
Tests for gong-notes CRUD and Airtable write-through on AirtableMeeting.

Airtable API calls are always mocked — tests verify:
  1. Django DB is updated correctly.
  2. The Airtable client is called with the right arguments.
  3. Edge cases (stub meetings, missing events, promotion to real ID).
"""

from unittest.mock import MagicMock, patch, call
import uuid

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from django.test import TestCase

from .models import AirtableAccount, AirtableMeeting

User = get_user_model()


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_user(username="testuser"):
    return User.objects.create_user(username=username, password="pass")


def make_airtable_account(airtable_id="recACCT001"):
    return AirtableAccount.objects.create(
        airtable_id=airtable_id,
        name="Acme Corp",
    )


def make_meeting(airtable_id="recMTG001", account=None, name="Q2 Review", gong_notes=""):
    return AirtableMeeting.objects.create(
        airtable_id=airtable_id,
        account=account,
        name=name,
        date=timezone.now(),
        gong_notes=gong_notes,
    )


def make_calendar_event(owner, title="Sync", agentpm_airtable_id=""):
    from scheduler.models import CalendarEvent
    return CalendarEvent.objects.create(
        owner=owner,
        title=title,
        start_datetime=timezone.now(),
        end_datetime=timezone.now(),
        agentpm_airtable_id=agentpm_airtable_id,
    )


# ── write_back unit tests ─────────────────────────────────────────────────────

class PushMeetingGongNotesUnitTests(TestCase):
    """Tests for write_back.push_meeting_gong_notes — no HTTP, pure function."""

    def setUp(self):
        self.account = make_airtable_account()

    @patch("airtable_sync.write_back.get_table")
    def test_real_meeting_updates_airtable(self, mock_get_table):
        """A meeting with a real airtable_id calls table.update with Gong Notes."""
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG001", account=self.account, gong_notes="Notes here")

        from .write_back import push_meeting_gong_notes
        result = push_meeting_gong_notes(meeting)

        self.assertTrue(result)
        mock_table.update.assert_called_once_with("recMTG001", {"Gong Notes": "Notes here"})
        mock_table.create.assert_not_called()

    @patch("airtable_sync.write_back.get_table")
    def test_stub_meeting_creates_airtable_record_and_promotes(self, mock_get_table):
        """A local- stub meeting creates a new Airtable record and replaces the stub ID."""
        fake_record_id = "recNEW999"
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": fake_record_id}
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="local-42-abcd1234", account=self.account, gong_notes="Pasted notes")

        from .write_back import push_meeting_gong_notes
        result = push_meeting_gong_notes(meeting)

        self.assertTrue(result)
        # create was called, not update
        mock_table.create.assert_called_once()
        created_fields = mock_table.create.call_args[0][0]
        self.assertEqual(created_fields["Gong Notes"], "Pasted notes")
        self.assertEqual(created_fields["Name"], "Q2 Review")
        mock_table.update.assert_not_called()

        # Django record is promoted to the real ID
        meeting.refresh_from_db()
        self.assertEqual(meeting.airtable_id, fake_record_id)

    @patch("airtable_sync.write_back.get_table")
    def test_stub_promotion_updates_calendar_event_link(self, mock_get_table):
        """After stub promotion, any CalendarEvent pointing to the old stub ID is updated."""
        user = make_user("caluser")
        old_stub = f"local-{uuid.uuid4().hex[:8]}"
        event = make_calendar_event(user, agentpm_airtable_id=old_stub)

        fake_record_id = "recPROMOTED"
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": fake_record_id}
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id=old_stub, gong_notes="Notes")

        from .write_back import push_meeting_gong_notes
        push_meeting_gong_notes(meeting)

        event.refresh_from_db()
        self.assertEqual(event.agentpm_airtable_id, fake_record_id)

    @patch("airtable_sync.write_back.get_table")
    def test_airtable_failure_returns_false(self, mock_get_table):
        """When Airtable raises, push_meeting_gong_notes returns False without re-raising."""
        mock_table = MagicMock()
        mock_table.update.side_effect = Exception("Airtable 422")
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG001", gong_notes="Notes")

        from .write_back import push_meeting_gong_notes
        result = push_meeting_gong_notes(meeting)

        self.assertFalse(result)
        # Django record is unchanged (gong_notes still saved before push)
        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "Notes")

    def test_missing_airtable_id_returns_false(self):
        """Meeting with no airtable_id returns False immediately."""
        meeting = AirtableMeeting(pk=None, airtable_id="", gong_notes="x")
        from .write_back import push_meeting_gong_notes
        result = push_meeting_gong_notes(meeting)
        self.assertFalse(result)


# ── API endpoint tests ────────────────────────────────────────────────────────

class GongNotesByPkAPITests(TestCase):
    """PATCH /airtable/meetings/<pk>/gong-notes/ — saves by Django PK."""

    def setUp(self):
        self.user = make_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.account = make_airtable_account()

    @patch("airtable_sync.write_back.get_table")
    def test_save_gong_notes_django_and_airtable(self, mock_get_table):
        """Notes are saved to Django and pushed to Airtable."""
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG001", account=self.account)

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/gong-notes/",
            {"gong_notes": "Summary bullet 1\nSummary bullet 2"},
            format="json",
        )

        self.assertEqual(resp.status_code, 200)

        # Django saved
        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "Summary bullet 1\nSummary bullet 2")

        # Airtable called
        mock_table.update.assert_called_once_with(
            "recMTG001", {"Gong Notes": "Summary bullet 1\nSummary bullet 2"}
        )

    @patch("airtable_sync.write_back.get_table")
    def test_overwrite_existing_notes(self, mock_get_table):
        """Pasting new notes overwrites the old ones in both stores."""
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG001", gong_notes="Old notes")

        self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/gong-notes/",
            {"gong_notes": "New notes"},
            format="json",
        )

        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "New notes")
        mock_table.update.assert_called_with("recMTG001", {"Gong Notes": "New notes"})

    @patch("airtable_sync.write_back.get_table")
    def test_clear_notes(self, mock_get_table):
        """Sending empty string clears the notes field."""
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG001", gong_notes="Some notes")

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/gong-notes/",
            {"gong_notes": ""},
            format="json",
        )

        self.assertEqual(resp.status_code, 200)
        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "")

    def test_404_for_unknown_meeting(self):
        """Returns 404 when the meeting PK does not exist."""
        resp = self.client.patch(
            "/api/v1/airtable/meetings/999999/gong-notes/",
            {"gong_notes": "Notes"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

    def test_401_unauthenticated(self):
        """Unauthenticated requests are rejected."""
        meeting = make_meeting(airtable_id="recMTG001")
        unauth = APIClient()
        resp = unauth.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/gong-notes/",
            {"gong_notes": "Notes"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)


class GongNotesByEventAPITests(TestCase):
    """PATCH /airtable/meetings/by-event/<event_id>/gong-notes/ — saves via CalendarEvent."""

    def setUp(self):
        self.user = make_user("evtuser")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.account = make_airtable_account()

    @patch("airtable_sync.write_back.get_table")
    def test_saves_to_linked_meeting(self, mock_get_table):
        """When the event already has a linked AirtableMeeting, saves to it."""
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTGEVT")
        event = make_calendar_event(self.user, agentpm_airtable_id="recMTGEVT")

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/by-event/{event.pk}/gong-notes/",
            {"gong_notes": "Via event"},
            format="json",
        )

        self.assertEqual(resp.status_code, 200)
        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "Via event")
        mock_table.update.assert_called_once_with("recMTGEVT", {"Gong Notes": "Via event"})

    @patch("airtable_sync.write_back.get_table")
    def test_creates_stub_when_no_meeting_linked(self, mock_get_table):
        """When the event has no linked meeting, a stub is created and notes are saved."""
        fake_airtable_id = "recCREATED"
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": fake_airtable_id}
        mock_get_table.return_value = mock_table

        event = make_calendar_event(self.user, title="New Event", agentpm_airtable_id="")

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/by-event/{event.pk}/gong-notes/",
            {"gong_notes": "Fresh notes"},
            format="json",
        )

        self.assertEqual(resp.status_code, 200)

        # A meeting was created in Django
        meeting = AirtableMeeting.objects.get(name="New Event")
        self.assertEqual(meeting.gong_notes, "Fresh notes")

        # The stub was promoted to the real Airtable ID
        meeting.refresh_from_db()
        self.assertEqual(meeting.airtable_id, fake_airtable_id)

        # Event was linked back
        event.refresh_from_db()
        self.assertEqual(event.agentpm_airtable_id, fake_airtable_id)

    @patch("airtable_sync.write_back.get_table")
    def test_second_paste_reuses_existing_meeting(self, mock_get_table):
        """Second paste to the same event reuses the meeting created by the first paste."""
        fake_id = "recREUSED"
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": fake_id}
        mock_get_table.return_value = mock_table

        event = make_calendar_event(self.user, agentpm_airtable_id="")

        # First paste — creates stub then promotes
        self.client.patch(
            f"/api/v1/airtable/meetings/by-event/{event.pk}/gong-notes/",
            {"gong_notes": "First paste"},
            format="json",
        )
        mock_table.reset_mock()

        # Second paste — event now has the real ID linked
        event.refresh_from_db()
        self.assertEqual(event.agentpm_airtable_id, fake_id)

        self.client.patch(
            f"/api/v1/airtable/meetings/by-event/{event.pk}/gong-notes/",
            {"gong_notes": "Second paste"},
            format="json",
        )

        # create should NOT have been called again — only update
        mock_table.create.assert_not_called()
        mock_table.update.assert_called_once_with(fake_id, {"Gong Notes": "Second paste"})

    def test_404_for_unknown_event(self):
        resp = self.client.patch(
            "/api/v1/airtable/meetings/by-event/999999/gong-notes/",
            {"gong_notes": "Notes"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)


# ── Response shape tests ──────────────────────────────────────────────────────

class GongNotesResponseShapeTests(TestCase):
    """Verify the response body contains the expected fields."""

    def setUp(self):
        self.user = make_user("shapeuser")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch("airtable_sync.write_back.get_table")
    def test_response_contains_meeting_fields(self, mock_get_table):
        mock_get_table.return_value = MagicMock()
        meeting = make_meeting(airtable_id="recMTG001", name="Shape Test")

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/gong-notes/",
            {"gong_notes": "Test content"},
            format="json",
        )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("id", data)
        self.assertIn("airtable_id", data)
        self.assertIn("gong_notes", data)
        self.assertEqual(data["gong_notes"], "Test content")
        self.assertEqual(data["name"], "Shape Test")
