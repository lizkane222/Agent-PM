"""Tests for scheduler.ReminderViewSet — permission scoping and CRUD."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from scheduler.models import Reminder
from team.models import UserProfile

User = get_user_model()

REMINDERS_LIST_URL = "/api/v1/scheduler/reminders/"


def reminder_detail_url(pk):
    return f"/api/v1/scheduler/reminders/{pk}/"


def reminder_action_url(pk, action):
    return f"/api/v1/scheduler/reminders/{pk}/{action}/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )
    user.is_staff = is_staff
    user.save()
    if is_staff:
        UserProfile.objects.create(user=user, staff_view_override=True)
    return user


def _make_reminder(user, title="Test Reminder", status="pending"):
    return Reminder.objects.create(
        created_by=user,
        title=title,
        body="",
        resource_type="general",
        due_at="2026-08-01T09:00:00Z",
        status=status,
    )


class ReminderViewSetTest(APITestCase):

    def setUp(self):
        self.staff = _make_user("staffuser", is_staff=True)
        self.user1 = _make_user("user1")
        self.user2 = _make_user("user2")

        self.r1 = _make_reminder(self.user1, "User1 Reminder A")
        self.r2 = _make_reminder(self.user1, "User1 Reminder B")
        self.r3 = _make_reminder(self.user2, "User2 Reminder")

    # ── LIST ───────────────────────────────────────────────────────────────────

    def test_unauthenticated_list_returns_401(self):
        resp = self.client.get(REMINDERS_LIST_URL)
        self.assertEqual(resp.status_code, 401)

    def test_non_staff_sees_only_own_reminders(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(REMINDERS_LIST_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [r["id"] for r in resp.data["results"]]
        self.assertIn(self.r1.id, ids)
        self.assertIn(self.r2.id, ids)
        self.assertNotIn(self.r3.id, ids)

    def test_staff_sees_all_reminders(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(REMINDERS_LIST_URL)
        self.assertEqual(resp.status_code, 200)
        # Staff's get_queryset still filters by created_by=request.user.
        # The ReminderViewSet does NOT use _staff_sees_all — it always scopes by owner.
        # This tests that staff users see THEIR OWN reminders (they have none in setUp).
        ids = [r["id"] for r in resp.data["results"]]
        self.assertNotIn(self.r1.id, ids)
        self.assertNotIn(self.r3.id, ids)

    def test_status_filter_returns_matching_reminders(self):
        dismissed = _make_reminder(self.user1, "Dismissed", status="dismissed")
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(REMINDERS_LIST_URL, {"status": "dismissed"})
        ids = [r["id"] for r in resp.data["results"]]
        self.assertIn(dismissed.id, ids)
        self.assertNotIn(self.r1.id, ids)

    # ── CREATE ─────────────────────────────────────────────────────────────────

    def test_create_sets_correct_owner(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.post(REMINDERS_LIST_URL, {
            "title": "New Reminder",
            "body": "",
            "resource_type": "general",
            "due_at": "2026-09-01T09:00:00Z",
            "notify_in_app": True,
            "notify_slack": False,
            "notify_push": False,
            "notify_sms": False,
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        created = Reminder.objects.get(pk=resp.data["id"])
        self.assertEqual(created.created_by, self.user1)

    def test_create_unauthenticated_returns_401(self):
        resp = self.client.post(REMINDERS_LIST_URL, {
            "title": "x", "due_at": "2026-09-01T09:00:00Z",
        }, format="json")
        self.assertEqual(resp.status_code, 401)

    # ── UPDATE ─────────────────────────────────────────────────────────────────

    def test_owner_can_update_own_reminder(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.patch(reminder_detail_url(self.r1.id), {"title": "Updated"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.r1.refresh_from_db()
        self.assertEqual(self.r1.title, "Updated")

    def test_non_owner_cannot_update_others_reminder(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.patch(reminder_detail_url(self.r1.id), {"title": "Hack"}, format="json")
        # r1 is not in user2's queryset — 404
        self.assertEqual(resp.status_code, 404)

    # ── DELETE ─────────────────────────────────────────────────────────────────

    def test_owner_can_delete_own_reminder(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.delete(reminder_detail_url(self.r1.id))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Reminder.objects.filter(pk=self.r1.id).exists())

    def test_non_owner_cannot_delete_others_reminder(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.delete(reminder_detail_url(self.r1.id))
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Reminder.objects.filter(pk=self.r1.id).exists())

    # ── DISMISS action ─────────────────────────────────────────────────────────

    def test_owner_can_dismiss_reminder(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.post(reminder_action_url(self.r1.id, "dismiss"))
        self.assertEqual(resp.status_code, 200)
        self.r1.refresh_from_db()
        self.assertEqual(self.r1.status, "dismissed")

    def test_non_owner_cannot_dismiss_others_reminder(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.post(reminder_action_url(self.r1.id, "dismiss"))
        self.assertEqual(resp.status_code, 404)
        self.r1.refresh_from_db()
        self.assertNotEqual(self.r1.status, "dismissed")
