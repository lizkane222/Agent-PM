"""Tests for agents.AgentSessionViewSet — ownership and participant scoping."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from agents.models import AgentSession

User = get_user_model()

SESSIONS_URL = "/api/v1/agents/sessions/"


def _make_user(username):
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )


def _make_session(user, title="Test session"):
    return AgentSession.objects.create(user=user, title=title)


class AgentSessionListTest(APITestCase):
    """List scoping — owner and participants see their sessions; others do not."""

    def setUp(self):
        self.user1 = _make_user("user1")
        self.user2 = _make_user("user2")
        self.user3 = _make_user("user3")

        self.session1 = _make_session(self.user1, "User1 session")
        self.session2 = _make_session(self.user2, "User2 session")
        # user3 is a participant in session1
        self.session1.participants.add(self.user3)

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(SESSIONS_URL)
        self.assertEqual(resp.status_code, 401)

    def test_owner_sees_own_session(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(SESSIONS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertIn(self.session1.id, ids)

    def test_owner_does_not_see_other_session(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(SESSIONS_URL)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertNotIn(self.session2.id, ids)

    def test_participant_sees_shared_session(self):
        self.client.force_authenticate(user=self.user3)
        resp = self.client.get(SESSIONS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertIn(self.session1.id, ids)

    def test_non_participant_does_not_see_session(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.get(SESSIONS_URL)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertNotIn(self.session1.id, ids)


class AgentSessionWriteTest(APITestCase):
    """Create and retrieve — owner-scoped operations."""

    def setUp(self):
        self.owner = _make_user("owner")
        self.other = _make_user("other")
        self.session = _make_session(self.owner)

    def test_authenticated_user_can_create_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(SESSIONS_URL, {"title": "New session"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(AgentSession.objects.filter(title="New session", user=self.owner).exists())

    def test_unauthenticated_create_returns_401(self):
        resp = self.client.post(SESSIONS_URL, {"title": "Anon"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_owner_can_retrieve_own_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.get(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], self.session.id)

    def test_non_owner_cannot_retrieve_session(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.get(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_owner_can_delete_own_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.delete(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AgentSession.objects.filter(pk=self.session.id).exists())

    def test_non_owner_cannot_delete_session(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.delete(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(AgentSession.objects.filter(pk=self.session.id).exists())
