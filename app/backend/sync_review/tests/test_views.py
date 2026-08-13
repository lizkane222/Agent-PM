"""Tests for sync_review views — RBAC, accept/reject, delete requests."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account, AccountRole
from sync_review.models import SyncDeleteRequest, SyncReviewItem
from team.models import UserProfile

User = get_user_model()

ITEMS_URL = "/api/v1/sync-review/items/"
DELETE_REQUESTS_URL = "/api/v1/sync-review/delete-requests/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="pass", is_staff=is_staff)
    if is_staff:
        UserProfile.objects.create(user=user, staff_view_override=True)
    return user


def _make_account(name):
    return Account.objects.create(company_name=name)


def _make_item(source="confluence", source_id="page-001", account=None, status="pending_human"):
    return SyncReviewItem.objects.create(
        source=source,
        source_id=source_id,
        source_url="https://example.atlassian.net/wiki/page-001",
        content_type="page",
        raw_content={"title": "Test Page"},
        status=status,
        suggested_account=account,
    )


class SyncReviewItemUnauthenticatedTest(APITestCase):
    def test_list_requires_auth(self):
        resp = self.client.get(ITEMS_URL)
        self.assertEqual(resp.status_code, 401)


class SyncReviewItemStaffTest(APITestCase):
    def setUp(self):
        self.staff = _make_user("staff", is_staff=True)
        self.acct = _make_account("Acme")
        self.item = _make_item(account=self.acct)

    def test_staff_can_list_all_items(self):
        _make_item(source_id="page-002", account=_make_account("Other"))
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(ITEMS_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 2)

    def test_staff_can_accept_item(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(f"{ITEMS_URL}{self.item.id}/accept/", {"account_id": self.acct.id})
        self.assertEqual(resp.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, "accepted")

    def test_staff_can_reject_item(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(f"{ITEMS_URL}{self.item.id}/reject/")
        self.assertEqual(resp.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, "rejected")

    def test_accept_missing_account_returns_400(self):
        item_no_account = _make_item(source_id="page-003", status="pending_human")
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(f"{ITEMS_URL}{item_no_account.id}/accept/")
        self.assertEqual(resp.status_code, 400)

    def test_pending_count_endpoint(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(f"{ITEMS_URL}pending-count/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)


class SyncReviewItemScopingTest(APITestCase):
    def setUp(self):
        self.staff = _make_user("staff2", is_staff=True)
        self.reviewer = _make_user("reviewer")
        self.acct = _make_account("Reviewer Corp")
        AccountRole.objects.create(user=self.reviewer, account=self.acct, role="sync_reviewer", assigned_by=self.staff)
        self.item = _make_item(account=self.acct)
        self.other_acct = _make_account("Other Corp")
        self.other_item = _make_item(source_id="page-other", account=self.other_acct)

    def test_reviewer_sees_only_own_account_items(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.get(ITEMS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [i["id"] for i in resp.data["results"]]
        self.assertIn(self.item.id, ids)
        self.assertNotIn(self.other_item.id, ids)

    def test_reviewer_can_accept_own_account_item(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.patch(f"{ITEMS_URL}{self.item.id}/accept/", {"account_id": self.acct.id})
        self.assertEqual(resp.status_code, 200)

    def test_reviewer_cannot_accept_other_account_item(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.patch(f"{ITEMS_URL}{self.other_item.id}/accept/", {"account_id": self.other_acct.id})
        self.assertIn(resp.status_code, [403, 404])


class SyncDeleteRequestTest(APITestCase):
    def setUp(self):
        self.staff = _make_user("staff3", is_staff=True)
        self.owner = _make_user("owner")
        self.reviewer = _make_user("reviewer2")
        self.acct = _make_account("Delete Corp")
        AccountRole.objects.create(user=self.owner, account=self.acct, role="account_owner", assigned_by=self.staff)
        AccountRole.objects.create(user=self.reviewer, account=self.acct, role="sync_reviewer", assigned_by=self.staff)
        self.item = _make_item(source_id="page-del", account=self.acct, status="accepted")

    def test_reviewer_can_request_delete(self):
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(
            f"{ITEMS_URL}{self.item.id}/request-delete/",
            {"reason": "Wrong account"},
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(SyncDeleteRequest.objects.filter(review_item=self.item).exists())

    def test_owner_can_approve_delete_request(self):
        delete_req = SyncDeleteRequest.objects.create(
            review_item=self.item, account=self.acct, requested_by=self.reviewer, reason="Wrong"
        )
        self.client.force_authenticate(user=self.owner)
        resp = self.client.patch(
            f"{DELETE_REQUESTS_URL}{delete_req.id}/resolve/",
            {"decision": "approved"},
        )
        self.assertEqual(resp.status_code, 200)
        delete_req.refresh_from_db()
        self.assertEqual(delete_req.status, "approved")
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, "unassigned")

    def test_reviewer_cannot_resolve_delete_request(self):
        delete_req = SyncDeleteRequest.objects.create(
            review_item=self.item, account=self.acct, requested_by=self.reviewer, reason="Wrong"
        )
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.patch(
            f"{DELETE_REQUESTS_URL}{delete_req.id}/resolve/",
            {"decision": "approved"},
        )
        # reviewer is not an account_owner so their queryset excludes the request → 404
        self.assertIn(resp.status_code, [403, 404])

    def test_request_delete_on_non_accepted_item_returns_400(self):
        pending_item = _make_item(source_id="page-pending", account=self.acct, status="pending_human")
        self.client.force_authenticate(user=self.reviewer)
        resp = self.client.post(f"{ITEMS_URL}{pending_item.id}/request-delete/", {"reason": "Test"})
        self.assertEqual(resp.status_code, 400)
