from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


def _make_user(username="searcher", password="pass", is_staff=False):
    u = User.objects.create_user(username=username, password=password, email=f"{username}@example.com")
    u.is_staff = is_staff
    u.save()
    return u


class GlobalSearchAuthTest(APITestCase):
    def test_unauthenticated_returns_401(self):
        res = self.client.get("/api/v1/search/", {"q": "test"})
        self.assertEqual(res.status_code, 401)

    def test_short_query_returns_empty(self):
        user = _make_user()
        self.client.force_authenticate(user=user)
        res = self.client.get("/api/v1/search/", {"q": "a"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["results"], [])

    def test_missing_query_returns_empty(self):
        user = _make_user(username="searcher2")
        self.client.force_authenticate(user=user)
        res = self.client.get("/api/v1/search/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["results"], [])


class GlobalSearchActionItemsTest(APITestCase):
    def setUp(self):
        self.user = _make_user(username="ai_user")
        self.client.force_authenticate(user=self.user)

    def test_action_item_found_without_team_membership(self):
        from airtable_sync.models import AirtableActionItem
        AirtableActionItem.objects.create(
            airtable_id="rec_search_test_001",
            task="Linked integration setup",
            task_details="",
            status="Open",
            priority="Medium",
        )
        res = self.client.get("/api/v1/search/", {"q": "linked integration"})
        self.assertEqual(res.status_code, 200)
        types = [r["type"] for r in res.data["results"]]
        self.assertIn("action_item", types)

    def test_action_item_without_account_still_found(self):
        from airtable_sync.models import AirtableActionItem
        AirtableActionItem.objects.create(
            airtable_id="rec_search_no_acct",
            task="Orphan task for search",
            status="Open",
            priority="Low",
        )
        res = self.client.get("/api/v1/search/", {"q": "orphan task"})
        self.assertEqual(res.status_code, 200)
        titles = [r["title"] for r in res.data["results"]]
        self.assertIn("Orphan task for search", titles)


class GlobalSearchCommentsTest(APITestCase):
    def setUp(self):
        self.user = _make_user(username="comment_searcher")
        self.other = _make_user(username="other_comment_user")
        self.client.force_authenticate(user=self.user)

    def test_own_comment_found(self):
        from comments.models import Comment
        Comment.objects.create(
            author=self.user,
            resource_type="action_item",
            resource_id=1,
            resource_label="Test Action Item",
            content="This is a searchable remark about the deadline",
        )
        res = self.client.get("/api/v1/search/", {"q": "searchable remark"})
        self.assertEqual(res.status_code, 200)
        types = [r["type"] for r in res.data["results"]]
        self.assertIn("comment", types)

    def test_other_users_comment_not_returned(self):
        from comments.models import Comment
        Comment.objects.create(
            author=self.other,
            resource_type="action_item",
            resource_id=2,
            resource_label="Another Item",
            content="Private remark belongs to other user",
        )
        res = self.client.get("/api/v1/search/", {"q": "private remark"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["results"], [])

    def test_comment_result_has_correct_fields(self):
        from comments.models import Comment
        Comment.objects.create(
            author=self.user,
            resource_type="account",
            resource_id=99,
            resource_label="Acme Corp",
            content="Follow up on the renewal discussion",
        )
        res = self.client.get("/api/v1/search/", {"q": "renewal discussion"})
        self.assertEqual(res.status_code, 200)
        comment_results = [r for r in res.data["results"] if r["type"] == "comment"]
        self.assertEqual(len(comment_results), 1)
        r = comment_results[0]
        self.assertEqual(r["type_label"], "Comment")
        self.assertEqual(r["account"], "Acme Corp")
        self.assertEqual(r["url"], "/accounts/99")

    def test_reply_comments_excluded(self):
        from comments.models import Comment
        parent = Comment.objects.create(
            author=self.user,
            resource_type="action_item",
            resource_id=3,
            resource_label="Item",
            content="Parent comment with uniqueword123",
        )
        Comment.objects.create(
            author=self.user,
            resource_type="action_item",
            resource_id=3,
            resource_label="Item",
            content="Reply also contains uniqueword123",
            parent=parent,
        )
        res = self.client.get("/api/v1/search/", {"q": "uniqueword123"})
        self.assertEqual(res.status_code, 200)
        comment_results = [r for r in res.data["results"] if r["type"] == "comment"]
        self.assertEqual(len(comment_results), 1)
        self.assertEqual(comment_results[0]["title"], "Parent comment with uniqueword123")
