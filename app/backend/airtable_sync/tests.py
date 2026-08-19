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
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase
from django.test import TestCase

from .models import AirtableAccount, AirtableActionItem, AirtableMeeting

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
        self.user = User.objects.create_user("pkuser", password="pass", is_staff=True)
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
        self.user = User.objects.create_user("shapeuser", password="pass", is_staff=True)
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


# ── Action item visibility (Admin privacy rule) ───────────────────────────────

class AirtableActionItemVisibilityTests(APITestCase):
    """AirtableActionItemViewSet.get_queryset — the Admin-account privacy filter.

    Items under an account named "Admin" are private to their assignee. Items with a
    BLANK assignee have no owner, so they are shared and visible to everyone. Before
    the fix, blank-assignee Admin items failed every branch of the filter and were
    unreachable for every user.
    """

    LIST_URL = "/api/v1/airtable/action-items/"

    def setUp(self):
        # These tests issue many list calls; clear DRF's throttle counters so they
        # neither trip the 200/min user rate nor leak counts into later tests.
        cache.clear()
        self.admin_account = AirtableAccount.objects.create(airtable_id="recADMIN", name="ADMIN")
        self.acme_account = AirtableAccount.objects.create(airtable_id="recACME", name="Acme Corp")

        self.alice = self._make_user_with_collab("alice", "usrAlice")
        self.bob = self._make_user_with_collab("bob", "usrBob")
        self.nocollab = self._make_user_with_collab("nocollab", "")
        self.staffer = self._make_user_with_collab("staffer", "usrStaff", is_staff=True)

        self.admin_blank = self._make_item("recAdminBlank", self.admin_account, "")
        self.admin_alice = self._make_item("recAdminAlice", self.admin_account, "usrAlice")
        self.admin_bob = self._make_item("recAdminBob", self.admin_account, "usrBob")
        self.acme_item = self._make_item("recAcme", self.acme_account, "")
        self.no_account_item = self._make_item("recNoAcct", None, "")

    def _make_user_with_collab(self, username, collab_id, is_staff=False):
        from team.models import UserProfile
        user = User.objects.create_user(username=username, password="pass", is_staff=is_staff)
        UserProfile.objects.create(user=user, airtable_collaborator_id=collab_id)
        return user

    def _make_item(self, airtable_id, account, assignee_airtable_id):
        return AirtableActionItem.objects.create(
            airtable_id=airtable_id,
            account=account,
            task=f"Task {airtable_id}",
            assignee_airtable_id=assignee_airtable_id,
        )

    def _visible_ids(self, user):
        self.client.force_authenticate(user=user)
        resp = self.client.get(self.LIST_URL)
        self.assertEqual(resp.status_code, 200)
        return {row["airtable_id"] for row in resp.json()}

    def test_401_unauthenticated(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(self.LIST_URL)
        self.assertEqual(resp.status_code, 401)

    def test_response_is_a_bare_list(self):
        """pagination_class = None — callers index .data directly, not .data.results."""
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.LIST_URL)
        self.assertIsInstance(resp.json(), list)

    def test_unassigned_admin_item_is_visible_to_its_assignee_peer(self):
        """The regression test: a blank-assignee Admin item must not vanish."""
        self.assertIn("recAdminBlank", self._visible_ids(self.alice))

    def test_user_sees_own_admin_item_but_not_another_users(self):
        visible = self._visible_ids(self.alice)
        self.assertIn("recAdminAlice", visible)
        self.assertNotIn("recAdminBob", visible)

    def test_other_user_sees_blank_admin_item_but_not_alices(self):
        visible = self._visible_ids(self.bob)
        self.assertIn("recAdminBlank", visible)
        self.assertIn("recAdminBob", visible)
        self.assertNotIn("recAdminAlice", visible)

    def test_user_without_collaborator_id_sees_blank_admin_item_only(self):
        visible = self._visible_ids(self.nocollab)
        self.assertIn("recAdminBlank", visible)
        self.assertNotIn("recAdminAlice", visible)
        self.assertNotIn("recAdminBob", visible)

    def test_non_admin_and_no_account_items_are_always_visible(self):
        for user in (self.alice, self.bob, self.nocollab):
            visible = self._visible_ids(user)
            self.assertIn("recAcme", visible)
            self.assertIn("recNoAcct", visible)

    def test_staff_does_not_bypass_admin_privacy(self):
        """Deliberate: staff must not see another user's private Admin items."""
        visible = self._visible_ids(self.staffer)
        self.assertIn("recAdminBlank", visible)
        self.assertNotIn("recAdminAlice", visible)
        self.assertNotIn("recAdminBob", visible)

    def test_status_filter_composes_with_admin_exclusion(self):
        AirtableActionItem.objects.filter(airtable_id="recAdminBlank").update(status="Done")
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.LIST_URL, {"status": "Done"})
        self.assertEqual(resp.status_code, 200)
        ids = {row["airtable_id"] for row in resp.json()}
        self.assertEqual(ids, {"recAdminBlank"})

    def test_account_name_filter_composes_with_admin_exclusion(self):
        self.client.force_authenticate(user=self.alice)
        resp = self.client.get(self.LIST_URL, {"account_name": "ADMIN"})
        self.assertEqual(resp.status_code, 200)
        ids = {row["airtable_id"] for row in resp.json()}
        self.assertEqual(ids, {"recAdminBlank", "recAdminAlice"})


class ActionItemStepViewSetTests(APITestCase):
    """/api/v1/airtable/steps/ — the checklist API.

    The model, serializer, viewset and route were all missing: only migration 0011 was ever
    committed, so the table existed while every step request 404'd. The frontend's hook
    tests passed regardless because MSW mocked the endpoint.
    """

    LIST_URL = "/api/v1/airtable/steps/"

    def setUp(self):
        cache.clear()
        from team.models import UserProfile
        self.user = User.objects.create_user("stepuser", password="pass", is_staff=True)
        UserProfile.objects.create(user=self.user, airtable_collaborator_id="usrMINE", staff_view_override=False)
        self.client.force_authenticate(user=self.user)
        self.account = AirtableAccount.objects.create(airtable_id="recACCT", name="Acme Corp")
        self.item = self._item("", "recItem")
        self.other_item = self._item("", "recOther")

    def _item(self, assignee, airtable_id, account=None):
        return AirtableActionItem.objects.create(
            airtable_id=airtable_id,
            account=self.account if account is None else account,
            task="Task",
            assignee_airtable_id=assignee,
        )

    def _step(self, item, title, order=0, status="Open"):
        from airtable_sync.models import ActionItemStep
        return ActionItemStep.objects.create(action_item=item, title=title, order=order, status=status)

    def test_401_unauthenticated(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.LIST_URL).status_code, 401)

    def test_list_is_scoped_to_the_requested_action_item(self):
        self._step(self.item, "Mine")
        self._step(self.other_item, "Theirs")

        resp = self.client.get(self.LIST_URL, {"action_item": self.item.pk})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual([s["title"] for s in resp.json()], ["Mine"])

    def test_list_is_ordered_by_order_then_creation(self):
        self._step(self.item, "third", order=2)
        self._step(self.item, "first", order=0)
        self._step(self.item, "second", order=1)

        resp = self.client.get(self.LIST_URL, {"action_item": self.item.pk})

        self.assertEqual([s["title"] for s in resp.json()], ["first", "second", "third"])

    def test_response_is_a_bare_list(self):
        """pagination_class = None — stepsApi.list reads r.data directly."""
        self._step(self.item, "One")
        self.assertIsInstance(self.client.get(self.LIST_URL, {"action_item": self.item.pk}).json(), list)

    def test_create_step(self):
        resp = self.client.post(
            self.LIST_URL,
            {"action_item": self.item.pk, "title": "Draft the doc", "order": 0},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["title"], "Draft the doc")
        self.assertEqual(resp.data["status"], "Open")
        self.assertEqual(self.item.steps.count(), 1)

    def test_check_a_step_off(self):
        step = self._step(self.item, "Draft the doc")
        resp = self.client.patch(f"{self.LIST_URL}{step.pk}/", {"status": "Done"}, format="json")
        self.assertEqual(resp.status_code, 200)
        step.refresh_from_db()
        self.assertEqual(step.status, "Done")

    def test_uncheck_a_step(self):
        step = self._step(self.item, "Draft the doc", status="Done")
        self.client.patch(f"{self.LIST_URL}{step.pk}/", {"status": "Open"}, format="json")
        step.refresh_from_db()
        self.assertEqual(step.status, "Open")

    def test_rename_a_step(self):
        step = self._step(self.item, "Old title")
        self.client.patch(f"{self.LIST_URL}{step.pk}/", {"title": "New title"}, format="json")
        step.refresh_from_db()
        self.assertEqual(step.title, "New title")

    def test_invalid_status_is_rejected(self):
        step = self._step(self.item, "Draft")
        resp = self.client.patch(f"{self.LIST_URL}{step.pk}/", {"status": "Bogus"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_delete_a_step(self):
        step = self._step(self.item, "Draft")
        resp = self.client.delete(f"{self.LIST_URL}{step.pk}/")
        self.assertIn(resp.status_code, (200, 204))
        self.assertEqual(self.item.steps.count(), 0)

    def test_deleting_the_action_item_cascades_to_its_steps(self):
        from airtable_sync.models import ActionItemStep
        self._step(self.item, "Draft")
        self.item.delete()
        self.assertEqual(ActionItemStep.objects.count(), 0)

    # ── Permission parity with the parent action item ────────────────────────────

    def test_cannot_create_a_step_on_another_users_item(self):
        theirs = self._item("usrOTHER", "recTheirs")
        resp = self.client.post(
            self.LIST_URL, {"action_item": theirs.pk, "title": "Nope", "order": 0}, format="json"
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(theirs.steps.count(), 0)

    def test_cannot_modify_a_step_on_another_users_item(self):
        theirs = self._item("usrOTHER", "recTheirs")
        step = self._step(theirs, "Theirs")
        resp = self.client.patch(f"{self.LIST_URL}{step.pk}/", {"status": "Done"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_cannot_delete_a_step_on_another_users_item(self):
        theirs = self._item("usrOTHER", "recTheirs")
        step = self._step(theirs, "Theirs")
        self.assertEqual(self.client.delete(f"{self.LIST_URL}{step.pk}/").status_code, 403)

    def test_can_create_a_step_on_an_item_assigned_to_me(self):
        mine = self._item("usrMINE", "recMine")
        resp = self.client.post(
            self.LIST_URL, {"action_item": mine.pk, "title": "Yes", "order": 0}, format="json"
        )
        self.assertEqual(resp.status_code, 201)

    def test_cannot_reparent_a_step_onto_another_users_item(self):
        theirs = self._item("usrOTHER", "recTheirs")
        step = self._step(self.item, "Mine")
        resp = self.client.patch(f"{self.LIST_URL}{step.pk}/", {"action_item": theirs.pk}, format="json")
        self.assertEqual(resp.status_code, 403)
        step.refresh_from_db()
        self.assertEqual(step.action_item_id, self.item.pk)

    def test_steps_on_another_users_private_admin_item_are_not_listed(self):
        """Step visibility follows item visibility, so the Admin privacy rule applies."""
        admin_acct = AirtableAccount.objects.create(airtable_id="recADMIN", name="ADMIN")
        private = self._item("usrOTHER", "recAdminTheirs", account=admin_acct)
        shared = self._item("", "recAdminShared", account=admin_acct)
        self._step(private, "Private step")
        self._step(shared, "Shared step")

        titles = {s["title"] for s in self.client.get(self.LIST_URL).json()}

        self.assertIn("Shared step", titles)
        self.assertNotIn("Private step", titles)


class ActionItemStepReorderTests(APITestCase):
    """POST /api/v1/airtable/steps/reorder/ — drag-to-reorder the checklist."""

    URL = "/api/v1/airtable/steps/reorder/"

    def setUp(self):
        cache.clear()
        from team.models import UserProfile
        self.user = User.objects.create_user("reorderer", password="pass", is_staff=True)
        UserProfile.objects.create(user=self.user, airtable_collaborator_id="usrMINE", staff_view_override=False)
        self.client.force_authenticate(user=self.user)
        self.account = AirtableAccount.objects.create(airtable_id="recACCT", name="Acme Corp")
        self.item = AirtableActionItem.objects.create(
            airtable_id="recItem", account=self.account, task="Task", assignee_airtable_id="",
        )
        self.a = self._step("a", 0)
        self.b = self._step("b", 1)
        self.c = self._step("c", 2)

    def _step(self, title, order, item=None):
        from airtable_sync.models import ActionItemStep
        return ActionItemStep.objects.create(
            action_item=item or self.item, title=title, order=order,
        )

    def _titles_in_order(self):
        resp = self.client.get("/api/v1/airtable/steps/", {"action_item": self.item.pk})
        return [s["title"] for s in resp.json()]

    def test_401_unauthenticated(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post(self.URL, {}, format="json").status_code, 401)

    def test_reorders_the_checklist(self):
        resp = self.client.post(
            self.URL,
            {"action_item": self.item.pk, "ids": [self.c.pk, self.a.pk, self.b.pk]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual([s["title"] for s in resp.data], ["c", "a", "b"])
        self.assertEqual(self._titles_in_order(), ["c", "a", "b"])

    def test_assigns_contiguous_order_values_from_zero(self):
        self.client.post(
            self.URL, {"action_item": self.item.pk, "ids": [self.c.pk, self.b.pk, self.a.pk]}, format="json"
        )
        for step, expected in ((self.c, 0), (self.b, 1), (self.a, 2)):
            step.refresh_from_db()
            self.assertEqual(step.order, expected)

    def test_a_step_added_concurrently_is_appended_not_rejected(self):
        late = self._step("late arrival", 99)
        resp = self.client.post(
            self.URL,
            {"action_item": self.item.pk, "ids": [self.b.pk, self.a.pk, self.c.pk]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._titles_in_order(), ["b", "a", "c", "late arrival"])
        late.refresh_from_db()
        self.assertEqual(late.order, 3)

    def test_rejects_a_step_from_another_action_item(self):
        other_item = AirtableActionItem.objects.create(
            airtable_id="recOther", account=self.account, task="Other", assignee_airtable_id="",
        )
        foreign = self._step("foreign", 0, item=other_item)

        resp = self.client.post(
            self.URL, {"action_item": self.item.pk, "ids": [self.a.pk, foreign.pk]}, format="json"
        )

        self.assertEqual(resp.status_code, 400)
        self.assertIn("do not belong", resp.data["error"])
        # Nothing moved.
        self.assertEqual(self._titles_in_order(), ["a", "b", "c"])

    def test_rejects_duplicate_ids(self):
        resp = self.client.post(
            self.URL, {"action_item": self.item.pk, "ids": [self.a.pk, self.a.pk]}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("duplicates", resp.data["error"])

    def test_rejects_a_non_list_ids_payload(self):
        resp = self.client.post(self.URL, {"action_item": self.item.pk, "ids": "nope"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_404_for_an_unknown_action_item(self):
        resp = self.client.post(self.URL, {"action_item": 999999, "ids": []}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_cannot_reorder_another_users_checklist(self):
        theirs = AirtableActionItem.objects.create(
            airtable_id="recTheirs", account=self.account, task="Theirs", assignee_airtable_id="usrOTHER",
        )
        s1 = self._step("t1", 0, item=theirs)
        s2 = self._step("t2", 1, item=theirs)

        resp = self.client.post(
            self.URL, {"action_item": theirs.pk, "ids": [s2.pk, s1.pk]}, format="json"
        )

        self.assertEqual(resp.status_code, 403)
        s1.refresh_from_db()
        self.assertEqual(s1.order, 0)


class ActionItemAttachmentUploadTests(APITestCase):
    """POST /airtable/action-items/<pk>/attachments/ — who may attach a file.

    Regression: attaching to an UNASSIGNED item used to 403, even though the very same
    caller could rename/re-status that item through /fields/. Most items in the dev DB are
    unassigned, so the file picker silently did nothing for nearly all of them.
    """

    def setUp(self):
        cache.clear()
        from team.models import UserProfile
        # Mirrors the real dev user: is_staff, but staff_view_override off, so
        # _staff_sees_all() is False and the assignee rule actually applies.
        self.user = User.objects.create_user("attacher", password="pass", is_staff=True)
        UserProfile.objects.create(user=self.user, airtable_collaborator_id="usrMINE", staff_view_override=False)
        self.client.force_authenticate(user=self.user)
        self.account = AirtableAccount.objects.create(airtable_id="recACCT", name="Acme Corp")

    def _item(self, assignee, airtable_id):
        return AirtableActionItem.objects.create(
            airtable_id=airtable_id, account=self.account, task="Task", assignee_airtable_id=assignee,
        )

    def _upload(self, item, filename="notes.pdf", content=b"%PDF-1.4 x"):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return self.client.post(
            f"/api/v1/airtable/action-items/{item.pk}/attachments/",
            {
                "artifact_type": "file",
                "name": filename,
                "file": SimpleUploadedFile(filename, content, content_type="application/pdf"),
            },
            format="multipart",
        )

    def test_upload_to_unassigned_item_is_allowed(self):
        """The regression: nobody owns an unassigned item, so anyone who sees it may attach."""
        item = self._item("", "recUnassigned")
        resp = self._upload(item)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(item.attachments.count(), 1)
        self.assertEqual(resp.data["artifact_type"], "file")
        self.assertEqual(resp.data["name"], "notes.pdf")
        self.assertTrue(resp.data["file_url"])

    def test_upload_to_own_item_is_allowed(self):
        item = self._item("usrMINE", "recMine")
        self.assertEqual(self._upload(item).status_code, 201)

    def test_upload_to_another_users_item_is_denied(self):
        """Unchanged boundary — an assigned item still belongs to its assignee."""
        item = self._item("usrOTHER", "recTheirs")
        resp = self._upload(item)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(item.attachments.count(), 0)

    def test_uploaded_attachment_appears_in_the_list_response(self):
        """What the modal re-reads on open — the file must come back, not just 201."""
        item = self._item("", "recRoundTrip")
        self._upload(item)
        resp = self.client.get(f"/api/v1/airtable/action-items/{item.pk}/attachments/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([a["name"] for a in resp.json()], ["notes.pdf"])

    def test_blocked_extension_is_rejected_with_a_message(self):
        item = self._item("", "recBlocked")
        resp = self._upload(item, filename="payload.svg", content=b"<svg/>")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not permitted", resp.data["error"])

    def test_oversize_file_is_rejected_with_a_message(self):
        item = self._item("", "recBig")
        resp = self._upload(item, filename="huge.pdf", content=b"x" * (25 * 1024 * 1024 + 1))
        self.assertEqual(resp.status_code, 400)
        self.assertIn("too large", resp.data["error"].lower())

    def test_deleting_an_attachment_on_an_unassigned_item_is_allowed(self):
        item = self._item("", "recDel")
        attach_id = self._upload(item).data["id"]
        resp = self.client.delete(
            f"/api/v1/airtable/action-items/{item.pk}/attachments/{attach_id}/"
        )
        self.assertIn(resp.status_code, (200, 204))
        self.assertEqual(item.attachments.count(), 0)


class AirtableMeetingAccountNameFilterTests(APITestCase):
    """AirtableMeetingViewSet ?account_name= — the fallback used by unlinked accounts.

    An accounts.Account with no airtable_id (notably a per-user Admin account) cannot scope
    by `?account=recXXX`, so AccountDetailPage falls back to the account's name.
    """

    LIST_URL = "/api/v1/airtable/meetings/"

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="mtguser", password="pass")
        self.client.force_authenticate(user=self.user)
        self.admin_account = AirtableAccount.objects.create(airtable_id="recADMIN", name="ADMIN")
        self.acme_account = AirtableAccount.objects.create(airtable_id="recACME", name="Acme Corp")
        make_meeting(airtable_id="recMtgAdmin", account=self.admin_account, name="Admin sync")
        make_meeting(airtable_id="recMtgAcme", account=self.acme_account, name="Acme sync")

    def _names(self, **params):
        resp = self.client.get(self.LIST_URL, params)
        self.assertEqual(resp.status_code, 200)
        return {row["airtable_id"] for row in resp.json()["results"]}

    def test_account_name_filter_scopes_to_that_account(self):
        self.assertEqual(self._names(account_name="ADMIN"), {"recMtgAdmin"})

    def test_account_name_filter_is_case_insensitive(self):
        # The app-side account is titled "Admin"; the Airtable record is "ADMIN".
        self.assertEqual(self._names(account_name="Admin"), {"recMtgAdmin"})

    def test_unknown_account_name_returns_nothing(self):
        self.assertEqual(self._names(account_name="Nope Ltd"), set())

    def test_no_params_returns_all(self):
        self.assertEqual(self._names(), {"recMtgAdmin", "recMtgAcme"})


class ClientPageSizePaginationTests(APITestCase):
    """?page_size= must widen the account list endpoints past the default PAGE_SIZE of 50."""

    def setUp(self):
        from team.models import UserProfile
        cache.clear()
        self.user = User.objects.create_user(username="pager", password="pass", is_staff=True)
        UserProfile.objects.create(user=self.user, airtable_collaborator_id="usrPager")
        self.client.force_authenticate(user=self.user)
        for i in range(60):
            AirtableAccount.objects.create(airtable_id=f"recPAGE{i:03d}", name=f"Account {i:03d}")

    def test_airtable_accounts_default_page_size_is_50(self):
        resp = self.client.get("/api/v1/airtable/accounts/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["results"]), 50)

    def test_airtable_accounts_honours_page_size(self):
        resp = self.client.get("/api/v1/airtable/accounts/", {"page_size": "500"})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["count"], 60)
        self.assertEqual(len(body["results"]), 60)

    def test_app_accounts_honours_page_size(self):
        from accounts.models import Account
        for i in range(60):
            Account.objects.create(company_name=f"App Co {i:03d}")
        resp = self.client.get("/api/v1/accounts/accounts/", {"page_size": "500"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["results"]), 60)


# ── Scheduler mirror: Admin account routing ───────────────────────────────────

class ResolveSchedulerAccountTests(TestCase):
    """`_resolve_scheduler_account` — where a mirrored scheduler.ActionItem lands.

    There is no shared Django counterpart to the Airtable "ADMIN" account: admin
    accounts are per-user workspaces (`accounts.Account.is_admin_account=True`).
    Items under it therefore route to their assignee's own Admin account. Without
    this, mirroring resolved Admin items by airtable_id and re-attached them to the
    stale shared "ADMIN" row on every sync.
    """

    def setUp(self):
        from team.models import UserProfile

        self.admin_account = AirtableAccount.objects.create(
            airtable_id="recADMINACCT", name="ADMIN"
        )
        self.acme_account = AirtableAccount.objects.create(
            airtable_id="recACMEACCT", name="Acme Corp"
        )
        self.alice = User.objects.create_user(username="mirror_alice", password="pass")
        UserProfile.objects.create(user=self.alice, airtable_collaborator_id="usrAlice")

    def _make_item(self, airtable_id, account, assignee_airtable_id=""):
        return AirtableActionItem.objects.create(
            airtable_id=airtable_id,
            account=account,
            task=f"Task {airtable_id}",
            assignee_airtable_id=assignee_airtable_id,
        )

    def test_admin_item_resolves_to_assignees_personal_admin_account(self):
        from airtable_sync.sync import _resolve_scheduler_account

        item = self._make_item("recAdminAlice", self.admin_account, "usrAlice")
        resolved = _resolve_scheduler_account(item)

        self.assertIsNotNone(resolved)
        self.assertTrue(resolved.is_admin_account)
        self.assertEqual(resolved.admin_owner, self.alice)
        self.assertEqual(resolved.company_name, "Admin")

    def test_admin_item_creates_the_personal_admin_account_on_first_use(self):
        from accounts.models import Account as DjangoAccount
        from airtable_sync.sync import _resolve_scheduler_account

        self.assertFalse(DjangoAccount.objects.filter(admin_owner=self.alice).exists())
        _resolve_scheduler_account(self._make_item("recAdminNew", self.admin_account, "usrAlice"))
        self.assertEqual(DjangoAccount.objects.filter(admin_owner=self.alice).count(), 1)

    def test_admin_item_never_resolves_to_a_shared_admin_row(self):
        """A stale shared "ADMIN" Account must not be picked up by airtable_id."""
        from accounts.models import Account as DjangoAccount
        from airtable_sync.sync import _resolve_scheduler_account

        orphan = DjangoAccount.objects.create(
            company_name="ADMIN", airtable_id="recADMINACCT", is_admin_account=False
        )
        resolved = _resolve_scheduler_account(
            self._make_item("recAdminAlice2", self.admin_account, "usrAlice")
        )
        self.assertNotEqual(resolved.id, orphan.id)
        self.assertEqual(resolved.admin_owner, self.alice)

    def test_unassigned_admin_item_resolves_to_no_account(self):
        """Blank assignee means no owner, so there is no workspace to attach to."""
        from airtable_sync.sync import _resolve_scheduler_account

        item = self._make_item("recAdminBlank2", self.admin_account, "")
        self.assertIsNone(_resolve_scheduler_account(item))

    def test_admin_item_with_unknown_collaborator_resolves_to_no_account(self):
        from airtable_sync.sync import _resolve_scheduler_account

        item = self._make_item("recAdminGhost", self.admin_account, "usrNobody")
        self.assertIsNone(_resolve_scheduler_account(item))

    def test_non_admin_item_still_resolves_by_airtable_id(self):
        from accounts.models import Account as DjangoAccount
        from airtable_sync.sync import _resolve_scheduler_account

        acme = DjangoAccount.objects.create(
            company_name="Acme Corp", airtable_id="recACMEACCT"
        )
        item = self._make_item("recAcme2", self.acme_account, "usrAlice")
        self.assertEqual(_resolve_scheduler_account(item), acme)

    def test_item_with_no_account_resolves_to_none(self):
        from airtable_sync.sync import _resolve_scheduler_account

        self.assertIsNone(_resolve_scheduler_account(self._make_item("recNoAcct2", None)))

    def test_mirror_action_item_attaches_admin_item_to_assignees_workspace(self):
        from airtable_sync.sync import mirror_action_item_to_scheduler
        from scheduler.models import ActionItem as SchedulerActionItem

        item = self._make_item("recAdminMirror", self.admin_account, "usrAlice")
        mirror_action_item_to_scheduler(item)

        mirrored = SchedulerActionItem.objects.get(airtable_record_id="recAdminMirror")
        self.assertEqual(mirrored.assigned_to, self.alice)
        self.assertTrue(mirrored.account.is_admin_account)
        self.assertEqual(mirrored.account.admin_owner, self.alice)

    def test_mirror_action_item_leaves_unassigned_admin_item_account_blank(self):
        from airtable_sync.sync import mirror_action_item_to_scheduler
        from scheduler.models import ActionItem as SchedulerActionItem

        item = self._make_item("recAdminMirrorBlank", self.admin_account, "")
        mirror_action_item_to_scheduler(item)

        mirrored = SchedulerActionItem.objects.get(airtable_record_id="recAdminMirrorBlank")
        self.assertIsNone(mirrored.account)
        self.assertIsNone(mirrored.assigned_to)


# ── AirtableMeetingViewSet — batched filters ───────────────────────────────────


class AirtableMeetingBatchedFilterTests(APITestCase):
    """?account= and ?calendar_event_id= accept comma-separated batches so callers
    rendering many accounts or events issue one request instead of one apiece —
    the fan-out that used to trip the DRF 200/min user throttle."""

    LIST_URL = "/api/v1/airtable/meetings/"

    def setUp(self):
        # These tests issue many list calls; clear DRF's throttle counters so they
        # neither trip the 200/min user rate nor leak counts into later tests.
        cache.clear()
        self.user = User.objects.create_user(username="meetings_user", password="pass")

        self.acct_a = AirtableAccount.objects.create(airtable_id="recA", name="Account A")
        self.acct_b = AirtableAccount.objects.create(airtable_id="recB", name="Account B")
        self.acct_c = AirtableAccount.objects.create(airtable_id="recC", name="Account C")

        self.m_a = self._make_meeting("recMeetA", self.acct_a)
        self.m_b = self._make_meeting("recMeetB", self.acct_b)
        self.m_c = self._make_meeting("recMeetC", self.acct_c)
        self.m_orphan = self._make_meeting("recMeetOrphan", None)

        self.client.force_authenticate(user=self.user)

    def _make_meeting(self, airtable_id, account):
        return AirtableMeeting.objects.create(
            airtable_id=airtable_id,
            account=account,
            name=f"Meeting {airtable_id}",
            date=timezone.now(),
        )

    def _ids(self, params):
        resp = self.client.get(self.LIST_URL, params)
        self.assertEqual(resp.status_code, 200)
        return {row["airtable_id"] for row in resp.json()["results"]}

    def _make_event(self, airtable_id):
        from scheduler.models import CalendarEvent
        return CalendarEvent.objects.create(
            owner=self.user,
            title="Event",
            start_datetime=timezone.now(),
            end_datetime=timezone.now(),
            agentpm_airtable_id=airtable_id,
        )

    # ── ?account= ─────────────────────────────────────────────────────────────

    def test_single_numeric_account_unchanged(self):
        self.assertEqual(self._ids({"account": str(self.acct_a.pk)}), {"recMeetA"})

    def test_single_airtable_id_account_unchanged(self):
        self.assertEqual(self._ids({"account": "recA"}), {"recMeetA"})

    def test_batched_numeric_accounts(self):
        params = {"account": f"{self.acct_a.pk},{self.acct_b.pk}"}
        self.assertEqual(self._ids(params), {"recMeetA", "recMeetB"})

    def test_batched_airtable_id_accounts(self):
        self.assertEqual(self._ids({"account": "recA,recB"}), {"recMeetA", "recMeetB"})

    def test_batched_mixed_pk_and_airtable_id_accounts(self):
        """A batch may mix both ID forms — the frontend joins whatever it holds."""
        params = {"account": f"{self.acct_a.pk},recB"}
        self.assertEqual(self._ids(params), {"recMeetA", "recMeetB"})

    def test_batched_accounts_exclude_unlisted_and_orphan_meetings(self):
        params = {"account": f"{self.acct_a.pk},{self.acct_b.pk}"}
        ids = self._ids(params)
        self.assertNotIn("recMeetC", ids)
        self.assertNotIn("recMeetOrphan", ids)

    def test_results_carry_account_for_client_side_attribution(self):
        """CalendarPage attributes each meeting by its own `account` field rather
        than by result index, so that field must be present and correct."""
        resp = self.client.get(
            self.LIST_URL, {"account": f"{self.acct_a.pk},{self.acct_b.pk}"}
        )
        by_id = {r["airtable_id"]: r["account"] for r in resp.json()["results"]}
        self.assertEqual(by_id["recMeetA"], self.acct_a.pk)
        self.assertEqual(by_id["recMeetB"], self.acct_b.pk)

    def test_unresolvable_account_returns_empty_not_everything(self):
        self.assertEqual(self._ids({"account": "recDOESNOTEXIST"}), set())

    def test_partially_resolvable_account_batch_returns_the_matches(self):
        params = {"account": f"{self.acct_a.pk},recNOPE"}
        self.assertEqual(self._ids(params), {"recMeetA"})

    def test_whitespace_and_empty_tokens_tolerated_in_account_batch(self):
        params = {"account": f" {self.acct_a.pk} ,,recB,"}
        self.assertEqual(self._ids(params), {"recMeetA", "recMeetB"})

    # ── ?calendar_event_id= ───────────────────────────────────────────────────

    def test_single_calendar_event_id_unchanged(self):
        ev = self._make_event("recMeetA")
        self.assertEqual(self._ids({"calendar_event_id": str(ev.pk)}), {"recMeetA"})

    def test_batched_calendar_event_ids(self):
        ev1 = self._make_event("recMeetA")
        ev2 = self._make_event("recMeetB")
        params = {"calendar_event_id": f"{ev1.pk},{ev2.pk}"}
        self.assertEqual(self._ids(params), {"recMeetA", "recMeetB"})

    def test_batched_calendar_events_skip_those_without_a_link(self):
        """An event with no agentpm_airtable_id contributes nothing, but must not
        void the whole batch."""
        ev_linked = self._make_event("recMeetA")
        ev_unlinked = self._make_event("")
        params = {"calendar_event_id": f"{ev_linked.pk},{ev_unlinked.pk}"}
        self.assertEqual(self._ids(params), {"recMeetA"})

    def test_calendar_event_batch_with_no_links_returns_empty(self):
        ev = self._make_event("")
        self.assertEqual(self._ids({"calendar_event_id": str(ev.pk)}), set())

    def test_nonexistent_calendar_event_returns_empty(self):
        self.assertEqual(self._ids({"calendar_event_id": "999999"}), set())

    def test_unparseable_calendar_event_returns_empty_not_everything(self):
        self.assertEqual(self._ids({"calendar_event_id": "not-an-id"}), set())

    # ── Pagination ───────────────────────────────────────────────────────────

    def test_page_size_widens_batched_response(self):
        """Batched requests span many accounts and would otherwise be silently
        truncated at the project-default PAGE_SIZE of 50."""
        for i in range(60):
            self._make_meeting(f"recBulk{i}", self.acct_a)
        resp = self.client.get(
            self.LIST_URL, {"account": str(self.acct_a.pk), "page_size": "500"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["results"]), 61)

    def test_response_keeps_the_drf_envelope(self):
        """Attaching ClientPageSizePagination must not change the response shape —
        callers read .data.results."""
        resp = self.client.get(self.LIST_URL, {"account": str(self.acct_a.pk)})
        body = resp.json()
        self.assertIn("results", body)
        self.assertIn("count", body)

    def test_401_unauthenticated(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(self.LIST_URL, {"account": "recA,recB"})
        self.assertEqual(resp.status_code, 401)


# ── Zoom notes: storage, endpoints, and write-back isolation ───────────────────

class PushMeetingZoomNotesUnitTests(TestCase):
    """write_back.push_meeting_zoom_notes — isolated from the Gong push."""

    def setUp(self):
        self.account = make_airtable_account()

    @patch("airtable_sync.write_back.get_table")
    def test_real_meeting_updates_zoom_columns(self, mock_get_table):
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG001", account=self.account)
        meeting.zoom_notes = "Zoom recap"
        meeting.zoom_url = "https://zoom.us/rec/abc"
        meeting.save()

        from .write_back import push_meeting_zoom_notes
        self.assertTrue(push_meeting_zoom_notes(meeting))

        mock_table.update.assert_called_once_with(
            "recMTG001",
            {"Zoom Notes": "Zoom recap", "Zoom URL": "https://zoom.us/rec/abc"},
        )
        mock_table.create.assert_not_called()

    @patch("airtable_sync.write_back.get_table")
    def test_zoom_url_omitted_when_blank(self, mock_get_table):
        """A blank URL is left out so it can't clear an existing Airtable value."""
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG002")
        meeting.zoom_notes = "Just notes"
        meeting.save()

        from .write_back import push_meeting_zoom_notes
        push_meeting_zoom_notes(meeting)

        mock_table.update.assert_called_once_with("recMTG002", {"Zoom Notes": "Just notes"})

    @patch("airtable_sync.write_back.get_table")
    def test_missing_airtable_column_returns_false_without_raising(self, mock_get_table):
        """An Airtable base with no 'Zoom Notes' column degrades, it doesn't explode."""
        mock_table = MagicMock()
        mock_table.update.side_effect = Exception("UNKNOWN_FIELD_NAME: Zoom Notes")
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="recMTG003")
        meeting.zoom_notes = "Zoom recap"
        meeting.save()

        from .write_back import push_meeting_zoom_notes
        self.assertFalse(push_meeting_zoom_notes(meeting))

        # The local copy is still there — that's the point of isolating the call.
        meeting.refresh_from_db()
        self.assertEqual(meeting.zoom_notes, "Zoom recap")

    @patch("airtable_sync.write_back.get_table")
    def test_gong_create_payload_never_carries_zoom_fields(self, mock_get_table):
        """Stub promotion must not send Zoom keys — a missing column would fail the
        whole create and lose the Gong notes with it."""
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": "recPROMO1"}
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="local-9-deadbeef", gong_notes="Gong notes")
        meeting.zoom_notes = "Zoom recap"
        meeting.zoom_url = "https://zoom.us/rec/xyz"
        meeting.save()

        from .write_back import push_meeting_gong_notes
        self.assertTrue(push_meeting_gong_notes(meeting))

        created_fields = mock_table.create.call_args[0][0]
        self.assertEqual(created_fields["Gong Notes"], "Gong notes")
        self.assertNotIn("Zoom Notes", created_fields)
        self.assertNotIn("Zoom URL", created_fields)

    @patch("airtable_sync.write_back.get_table")
    def test_stub_meeting_is_promoted_before_zoom_update(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": "recPROMO2"}
        mock_get_table.return_value = mock_table

        meeting = make_meeting(airtable_id="local-7-cafebabe")
        meeting.zoom_notes = "Zoom recap"
        meeting.save()

        from .write_back import push_meeting_zoom_notes
        self.assertTrue(push_meeting_zoom_notes(meeting))

        meeting.refresh_from_db()
        self.assertEqual(meeting.airtable_id, "recPROMO2")
        mock_table.update.assert_called_once_with("recPROMO2", {"Zoom Notes": "Zoom recap"})


class ZoomNotesAPITests(TestCase):
    """PATCH /airtable/meetings/<pk>/zoom-notes/ and the by-event variant."""

    def setUp(self):
        self.user = User.objects.create_user("zoomuser", password="pass", is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.account = make_airtable_account()

    def test_401_unauthenticated_by_pk(self):
        self.client.force_authenticate(user=None)
        meeting = make_meeting(airtable_id="recMTG001")
        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/zoom-notes/",
            {"zoom_notes": "x"}, format="json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_401_unauthenticated_by_event(self):
        self.client.force_authenticate(user=None)
        event = make_calendar_event(self.user)
        resp = self.client.patch(
            f"/api/v1/airtable/meetings/by-event/{event.pk}/zoom-notes/",
            {"zoom_notes": "x"}, format="json",
        )
        self.assertEqual(resp.status_code, 401)

    @patch("airtable_sync.write_back.get_table")
    def test_save_zoom_notes_leaves_gong_notes_alone(self, mock_get_table):
        mock_get_table.return_value = MagicMock()
        meeting = make_meeting(airtable_id="recMTG001", account=self.account, gong_notes="Gong recap")

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/zoom-notes/",
            {"zoom_notes": "Zoom recap"}, format="json",
        )

        self.assertEqual(resp.status_code, 200)
        meeting.refresh_from_db()
        self.assertEqual(meeting.zoom_notes, "Zoom recap")
        self.assertEqual(meeting.gong_notes, "Gong recap")

    @patch("airtable_sync.write_back.get_table")
    def test_save_gong_notes_leaves_zoom_notes_alone(self, mock_get_table):
        mock_get_table.return_value = MagicMock()
        meeting = make_meeting(airtable_id="recMTG001", account=self.account)
        meeting.zoom_notes = "Zoom recap"
        meeting.save()

        self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/gong-notes/",
            {"gong_notes": "Gong recap"}, format="json",
        )

        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "Gong recap")
        self.assertEqual(meeting.zoom_notes, "Zoom recap")

    @patch("airtable_sync.write_back.get_table")
    def test_by_event_creates_stub_and_saves_zoom_notes(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.create.return_value = {"id": "recSTUBZOOM"}
        mock_get_table.return_value = mock_table

        event = make_calendar_event(self.user, title="Acme Sync")

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/by-event/{event.pk}/zoom-notes/",
            {"zoom_notes": "Zoom recap"}, format="json",
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["zoom_notes"], "Zoom recap")
        event.refresh_from_db()
        self.assertEqual(event.agentpm_airtable_id, "recSTUBZOOM")

    def test_by_event_404_for_unknown_event(self):
        resp = self.client.patch(
            "/api/v1/airtable/meetings/by-event/999999/zoom-notes/",
            {"zoom_notes": "x"}, format="json",
        )
        self.assertEqual(resp.status_code, 404)

    @patch("airtable_sync.write_back.get_table")
    def test_non_member_gets_404_not_403(self, mock_get_table):
        """Scoping matches the Gong path: no membership, no existence leak."""
        mock_get_table.return_value = MagicMock()
        outsider = User.objects.create_user("outsider", password="pass")
        self.client.force_authenticate(user=outsider)
        meeting = make_meeting(airtable_id="recMTG001", account=self.account)

        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/zoom-notes/",
            {"zoom_notes": "x"}, format="json",
        )
        self.assertEqual(resp.status_code, 404)

    @patch("airtable_sync.write_back.get_table")
    def test_serializer_exposes_both_note_fields(self, mock_get_table):
        mock_get_table.return_value = MagicMock()
        meeting = make_meeting(airtable_id="recMTG001", account=self.account)
        resp = self.client.patch(
            f"/api/v1/airtable/meetings/{meeting.pk}/zoom-notes/",
            {"zoom_notes": "Zoom recap"}, format="json",
        )
        body = resp.json()
        for key in ("gong_notes", "gong_url", "zoom_notes", "zoom_url"):
            self.assertIn(key, body)


class SyncMeetingsZoomFieldTests(TestCase):
    """sync_meetings must not blank locally-held Zoom notes when Airtable is silent."""

    @patch("airtable_sync.sync.get_table")
    def test_blank_airtable_zoom_notes_preserve_local_value(self, mock_get_table):
        meeting = make_meeting(airtable_id="recMTG001")
        meeting.zoom_notes = "Locally imported recap"
        meeting.save()

        mock_table = MagicMock()
        mock_table.all.return_value = [{
            "id": "recMTG001",
            "fields": {"Name": "Q2 Review", "Gong Notes": ""},
        }]
        mock_get_table.return_value = mock_table

        from .sync import sync_meetings
        sync_meetings()

        meeting.refresh_from_db()
        self.assertEqual(meeting.zoom_notes, "Locally imported recap")

    @patch("airtable_sync.sync.get_table")
    def test_airtable_zoom_notes_are_pulled_in(self, mock_get_table):
        meeting = make_meeting(airtable_id="recMTG001")

        mock_table = MagicMock()
        mock_table.all.return_value = [{
            "id": "recMTG001",
            "fields": {
                "Name": "Q2 Review",
                "Zoom Notes": "From Airtable",
                "Zoom URL": "https://zoom.us/rec/1",
            },
        }]
        mock_get_table.return_value = mock_table

        from .sync import sync_meetings
        sync_meetings()

        meeting.refresh_from_db()
        self.assertEqual(meeting.zoom_notes, "From Airtable")
        self.assertEqual(meeting.zoom_url, "https://zoom.us/rec/1")

    @patch("airtable_sync.sync.get_table")
    def test_newline_only_airtable_notes_do_not_overwrite_local_notes(self, mock_get_table):
        """Airtable richText reports "\\n" for a cleared cell and never drops the key.

        A truthiness test would treat that as content, overwrite the locally-imported
        recap with "\\n", and — since "\\n" is itself truthy — make the meeting look
        already-summarised to the recap-email scanner, which would skip it forever.
        """
        meeting = make_meeting(airtable_id="recMTG001", gong_notes="Locally imported Gong recap")
        meeting.zoom_notes = "Locally imported Zoom recap"
        meeting.save()

        mock_table = MagicMock()
        mock_table.all.return_value = [{
            "id": "recMTG001",
            "fields": {"Name": "Q2 Review", "Gong Notes": "\n", "Zoom Notes": "\n", "Zoom URL": "  "},
        }]
        mock_get_table.return_value = mock_table

        from .sync import sync_meetings
        sync_meetings()

        meeting.refresh_from_db()
        self.assertEqual(meeting.gong_notes, "Locally imported Gong recap")
        self.assertEqual(meeting.zoom_notes, "Locally imported Zoom recap")
        self.assertEqual(meeting.zoom_url, "")
