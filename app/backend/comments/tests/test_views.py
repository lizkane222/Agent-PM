"""Tests for the comments API, including reply-notification logic."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from airtable_sync.models import AirtableMeeting
from comments.models import Comment
from comments.views import _notify_reply_author
from realtime.models import AgentActivityEvent

User = get_user_model()


class CommentViewSetAuthTests(APITestCase):
    """Unauthenticated requests must be rejected."""

    def test_list_requires_auth(self):
        resp = self.client.get("/api/v1/comments/comments/")
        self.assertEqual(resp.status_code, 401)

    def test_create_requires_auth(self):
        resp = self.client.post("/api/v1/comments/comments/", {})
        self.assertEqual(resp.status_code, 401)


class CommentCRUDTests(APITestCase):
    """Authenticated comment CRUD."""

    def setUp(self):
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")

    def _make_comment(self, user, **kwargs):
        return Comment.objects.create(
            author=user,
            resource_type="action_item",
            resource_id=1,
            content="original comment",
            **kwargs,
        )

    def test_create_missing_resource_type_returns_400(self):
        self.client.force_authenticate(user=self.alice)
        resp = self.client.post("/api/v1/comments/comments/", {"resource_id": 1, "content": "hi"})
        self.assertEqual(resp.status_code, 400)

    def test_create_missing_resource_id_returns_400(self):
        self.client.force_authenticate(user=self.alice)
        resp = self.client.post(
            "/api/v1/comments/comments/",
            {"resource_type": "action_item", "content": "hi"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_update_own_comment_allowed(self):
        self.client.force_authenticate(user=self.alice)
        comment = self._make_comment(self.alice)
        resp = self.client.patch(
            f"/api/v1/comments/comments/{comment.id}/",
            {"content": "edited"},
        )
        self.assertEqual(resp.status_code, 200)
        comment.refresh_from_db()
        self.assertEqual(comment.content, "edited")

    def test_update_others_comment_not_found(self):
        # Comment authored by bob is not in alice's queryset → 404 (no info leak)
        comment = self._make_comment(self.bob)
        self.client.force_authenticate(user=self.alice)
        resp = self.client.patch(
            f"/api/v1/comments/comments/{comment.id}/",
            {"content": "hacked"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_delete_own_comment_allowed(self):
        self.client.force_authenticate(user=self.alice)
        comment = self._make_comment(self.alice)
        resp = self.client.delete(f"/api/v1/comments/comments/{comment.id}/")
        self.assertEqual(resp.status_code, 204)

    def test_delete_others_comment_not_found(self):
        # Same 404 behaviour — no info leak about other users' comments
        comment = self._make_comment(self.bob)
        self.client.force_authenticate(user=self.alice)
        resp = self.client.delete(f"/api/v1/comments/comments/{comment.id}/")
        self.assertEqual(resp.status_code, 404)


class ReplyNotificationTests(APITestCase):
    """
    _notify_reply_author creates an AgentActivityEvent for the parent commenter.
    perform_create skips notification when replying to your own comment.
    """

    def setUp(self):
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")

        # AirtableMeeting: any authenticated user can comment on one that exists
        self.meeting = AirtableMeeting.objects.create(airtable_id="rec_test_001")

        self.parent = Comment.objects.create(
            author=self.alice,
            resource_type="meeting",
            resource_id=self.meeting.id,
            resource_label="Q3 Review",
            content="parent comment",
        )

    def _post_reply(self, user, content="a reply"):
        self.client.force_authenticate(user=user)
        return self.client.post(
            "/api/v1/comments/comments/",
            {
                "resource_type": "meeting",
                "resource_id": self.meeting.id,
                "resource_label": "Q3 Review",
                "content": content,
                "parent": self.parent.id,
            },
        )

    def test_notify_function_creates_activity_event_for_parent_author(self):
        reply = Comment.objects.create(
            author=self.bob,
            resource_type="meeting",
            resource_id=self.meeting.id,
            content="bob's reply",
            parent=self.parent,
        )
        _notify_reply_author(self.bob, self.parent, reply)

        event = AgentActivityEvent.objects.filter(
            user=self.alice,
            event_type="comment_reply",
        ).first()
        self.assertIsNotNone(event)
        self.assertIn("bob", event.title.lower())
        self.assertIn("Q3 Review", event.title)
        self.assertEqual(event.metadata["resource_type"], "meeting")
        self.assertEqual(event.metadata["reply_id"], reply.id)

    def test_reply_via_api_creates_notification_for_parent_author(self):
        resp = self._post_reply(self.bob, content="api reply")
        self.assertEqual(resp.status_code, 201, resp.data)

        event = AgentActivityEvent.objects.filter(
            user=self.alice,
            event_type="comment_reply",
        ).first()
        self.assertIsNotNone(event)

    def test_self_reply_via_api_does_not_create_notification(self):
        resp = self._post_reply(self.alice, content="alice's self-reply")
        self.assertEqual(resp.status_code, 201, resp.data)

        count = AgentActivityEvent.objects.filter(
            user=self.alice,
            event_type="comment_reply",
        ).count()
        self.assertEqual(count, 0)

    def test_notification_is_idempotent(self):
        reply = Comment.objects.create(
            author=self.bob,
            resource_type="meeting",
            resource_id=self.meeting.id,
            content="bob's reply",
            parent=self.parent,
        )
        _notify_reply_author(self.bob, self.parent, reply)
        _notify_reply_author(self.bob, self.parent, reply)  # second call

        count = AgentActivityEvent.objects.filter(
            user=self.alice,
            event_type="comment_reply",
            client_id=f"reply-{reply.id}",
        ).count()
        self.assertEqual(count, 1)

    def test_top_level_comment_does_not_create_notification(self):
        self.client.force_authenticate(user=self.bob)
        resp = self.client.post(
            "/api/v1/comments/comments/",
            {
                "resource_type": "meeting",
                "resource_id": self.meeting.id,
                "content": "top level, no parent",
            },
        )
        self.assertEqual(resp.status_code, 201, resp.data)

        count = AgentActivityEvent.objects.filter(event_type="comment_reply").count()
        self.assertEqual(count, 0)
