"""Tests for feedback.FeedbackViewSet — ownership scoping and permission enforcement."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from feedback.models import Feedback

User = get_user_model()

FEEDBACK_URL = "/api/v1/feedback/feedback/"


def feedback_detail_url(pk):
    return f"/api/v1/feedback/feedback/{pk}/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )
    user.is_staff = is_staff
    user.save()
    return user


def _make_feedback(author, description="Bug: button doesn't work"):
    return Feedback.objects.create(author=author, description=description)


class FeedbackListTest(APITestCase):
    """List scoping — owner sees own, staff sees all."""

    def setUp(self):
        self.staff = _make_user("staffadmin", is_staff=True)
        self.user1 = _make_user("user1")
        self.user2 = _make_user("user2")

        self.fb1 = _make_feedback(self.user1, "Crash on save")
        self.fb2 = _make_feedback(self.user2, "Layout broken")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(FEEDBACK_URL)
        self.assertEqual(resp.status_code, 401)

    def test_owner_sees_own_feedback(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(FEEDBACK_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [f["id"] for f in resp.data["results"]]
        self.assertIn(self.fb1.id, ids)
        self.assertNotIn(self.fb2.id, ids)

    def test_staff_sees_all_feedback(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(FEEDBACK_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [f["id"] for f in resp.data["results"]]
        self.assertIn(self.fb1.id, ids)
        self.assertIn(self.fb2.id, ids)


class FeedbackWriteTest(APITestCase):
    """Create — any authenticated user; update/delete — author or staff only."""

    def setUp(self):
        self.staff = _make_user("staffwriter", is_staff=True)
        self.owner = _make_user("fbowner")
        self.other = _make_user("other")
        self.fb = _make_feedback(self.owner)

    def test_authenticated_user_can_create_feedback(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(FEEDBACK_URL, {
            "description": "New issue",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Feedback.objects.filter(description="New issue").exists())

    def test_unauthenticated_create_returns_401(self):
        resp = self.client.post(FEEDBACK_URL, {"description": "Anon"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_owner_can_update_own_feedback(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.patch(feedback_detail_url(self.fb.id), {"status": "resolved"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.fb.refresh_from_db()
        self.assertEqual(self.fb.status, "resolved")

    def test_non_owner_cannot_update_feedback(self):
        self.client.force_authenticate(user=self.other)
        # other can't even see fb (it's owner's), so 404
        resp = self.client.patch(feedback_detail_url(self.fb.id), {"status": "resolved"}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_staff_can_update_any_feedback(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(feedback_detail_url(self.fb.id), {"status": "wont_fix"}, format="json")
        self.assertEqual(resp.status_code, 200)

    def test_owner_can_delete_own_feedback(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.delete(feedback_detail_url(self.fb.id))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Feedback.objects.filter(pk=self.fb.id).exists())

    def test_non_owner_cannot_delete_feedback(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.delete(feedback_detail_url(self.fb.id))
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Feedback.objects.filter(pk=self.fb.id).exists())
