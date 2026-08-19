"""Tests for the comments API, including reply-notification logic."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from airtable_sync.models import AirtableMeeting
from comments.models import Comment
from comments.views import SUMMARY_MAX_IDS, SUMMARY_PREVIEW_LIMIT, _notify_reply_author
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


class CommentSummaryTests(APITestCase):
    """The batched ``/summary/`` route: counts, previews, scoping, validation."""

    def setUp(self):
        self.alice = User.objects.create_user("alice", password="pw")
        self.bob = User.objects.create_user("bob", password="pw")
        # Any authenticated user can see an AirtableMeeting with no account.
        self.m1 = AirtableMeeting.objects.create(airtable_id="rec_sum_001", name="Kickoff")
        self.m2 = AirtableMeeting.objects.create(airtable_id="rec_sum_002", name="Retro")
        self.m3 = AirtableMeeting.objects.create(airtable_id="rec_sum_003", name="Silent")

    def _comment(self, resource_id, content, author=None, parent=None):
        return Comment.objects.create(
            author=author or self.alice,
            resource_type="meeting",
            resource_id=resource_id,
            content=content,
            parent=parent,
        )

    def _get(self, user, params):
        self.client.force_authenticate(user=user)
        return self.client.get("/api/v1/comments/comments/summary/", params)

    def test_requires_auth(self):
        resp = self.client.get("/api/v1/comments/comments/summary/")
        self.assertEqual(resp.status_code, 401)

    def test_missing_resource_type_returns_400(self):
        resp = self._get(self.alice, {"resource_ids": "1"})
        self.assertEqual(resp.status_code, 400)

    def test_unknown_resource_type_returns_400(self):
        resp = self._get(self.alice, {"resource_type": "not_a_thing", "resource_ids": "1"})
        self.assertEqual(resp.status_code, 400)

    def test_no_ids_returns_empty_results(self):
        self._comment(self.m1.id, "hello")
        resp = self._get(self.alice, {"resource_type": "meeting"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["results"], {})

    def test_unparseable_ids_return_empty_results(self):
        self._comment(self.m1.id, "hello")
        resp = self._get(self.alice, {"resource_type": "meeting", "resource_ids": "abc,,-"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["results"], {})

    def test_too_many_ids_returns_400(self):
        ids = ",".join(str(i) for i in range(SUMMARY_MAX_IDS + 1))
        resp = self._get(self.alice, {"resource_type": "meeting", "resource_ids": ids})
        self.assertEqual(resp.status_code, 400)

    def test_batches_multiple_records_in_one_request(self):
        self._comment(self.m1.id, "one")
        self._comment(self.m1.id, "two")
        self._comment(self.m2.id, "three")
        resp = self._get(self.alice, {
            "resource_type": "meeting",
            "resource_ids": f"{self.m1.id},{self.m2.id},{self.m3.id}",
        })
        self.assertEqual(resp.status_code, 200)
        results = resp.data["results"]
        self.assertEqual(results[str(self.m1.id)]["count"], 2)
        self.assertEqual(results[str(self.m2.id)]["count"], 1)
        # A record with no comments is omitted, not returned as a zero entry.
        self.assertNotIn(str(self.m3.id), results)

    def test_count_includes_replies(self):
        parent = self._comment(self.m1.id, "parent")
        self._comment(self.m1.id, "reply", author=self.bob, parent=parent)
        resp = self._get(self.alice, {"resource_type": "meeting", "resource_ids": str(self.m1.id)})
        entry = resp.data["results"][str(self.m1.id)]
        self.assertEqual(entry["count"], 2)
        # Preview is top-level only — replies render inside the panel, not the card.
        self.assertEqual(len(entry["comments"]), 1)
        self.assertEqual(entry["comments"][0]["content"], "parent")

    def test_preview_is_capped_at_limit_and_keeps_the_newest(self):
        for i in range(SUMMARY_PREVIEW_LIMIT + 2):
            self._comment(self.m1.id, f"comment {i}")
        entry = self._get(self.alice, {
            "resource_type": "meeting", "resource_ids": str(self.m1.id),
        }).data["results"][str(self.m1.id)]
        self.assertEqual(entry["count"], SUMMARY_PREVIEW_LIMIT + 2)
        self.assertEqual(len(entry["comments"]), SUMMARY_PREVIEW_LIMIT)
        contents = [c["content"] for c in entry["comments"]]
        # Oldest-first for display, but only the newest LIMIT survive the cap.
        self.assertEqual(contents, ["comment 2", "comment 3", "comment 4"])

    def test_preview_includes_author_display(self):
        self._comment(self.m1.id, "hi", author=self.bob)
        entry = self._get(self.alice, {
            "resource_type": "meeting", "resource_ids": str(self.m1.id),
        }).data["results"][str(self.m1.id)]
        self.assertEqual(entry["comments"][0]["author_display"], "bob")
        self.assertEqual(entry["comments"][0]["author"], self.bob.id)

    def test_hides_records_the_caller_cannot_see(self):
        """A calendar_event owned by bob leaks nothing to alice."""
        from scheduler.models import CalendarEvent
        ev = CalendarEvent.objects.create(
            owner=self.bob, title="Bob's 1:1",
            start_datetime="2026-01-01T10:00:00Z", end_datetime="2026-01-01T11:00:00Z",
        )
        Comment.objects.create(
            author=self.bob, resource_type="calendar_event",
            resource_id=ev.id, content="secret",
        )
        resp = self._get(self.alice, {
            "resource_type": "calendar_event", "resource_ids": str(ev.id),
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["results"], {})

        # ...but bob himself sees it.
        resp = self._get(self.bob, {
            "resource_type": "calendar_event", "resource_ids": str(ev.id),
        })
        self.assertEqual(resp.data["results"][str(ev.id)]["count"], 1)

    def test_resource_type_scopes_the_lookup(self):
        """Same numeric id under a different resource_type must not bleed through."""
        self._comment(self.m1.id, "on a meeting")
        resp = self._get(self.alice, {
            "resource_type": "reminder", "resource_ids": str(self.m1.id),
        })
        self.assertEqual(resp.data["results"], {})
