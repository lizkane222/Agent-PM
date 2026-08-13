"""Tests for AccountProjectViewSet — scoping, CRUD, and new linked-ID fields."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account, AccountProject

User = get_user_model()

PROJECTS_URL = "/api/v1/accounts/projects/"


def _make_user(username, is_staff=False):
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass",
        is_staff=is_staff,
    )


def _make_account(name, admin_owner=None):
    return Account.objects.create(company_name=name, admin_owner=admin_owner)


def _make_project(account, name="Test Project", **kwargs):
    return AccountProject.objects.create(account=account, name=name, **kwargs)


class AccountProjectUnauthenticatedTest(APITestCase):
    def test_list_requires_auth(self):
        resp = self.client.get(PROJECTS_URL)
        self.assertEqual(resp.status_code, 401)

    def test_create_requires_auth(self):
        acct = _make_account("Acme")
        resp = self.client.post(PROJECTS_URL, {"account": acct.id, "name": "P1"})
        self.assertEqual(resp.status_code, 401)


class AccountProjectScopingTest(APITestCase):
    def setUp(self):
        self.user1 = _make_user("user1")
        self.user2 = _make_user("user2")
        self.acct1 = _make_account("Acme", admin_owner=self.user1)
        self.acct2 = _make_account("Beta", admin_owner=self.user2)
        self.p1 = _make_project(self.acct1, "Project Alpha")
        self.p2 = _make_project(self.acct2, "Project Beta")

    def test_user_sees_own_account_projects(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(PROJECTS_URL)
        self.assertEqual(resp.status_code, 200)
        names = [p["name"] for p in resp.data["results"]]
        self.assertIn("Project Alpha", names)

    def test_user_does_not_see_other_account_projects(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(PROJECTS_URL)
        names = [p["name"] for p in resp.data["results"]]
        self.assertNotIn("Project Beta", names)

    def test_staff_sees_all(self):
        staff = _make_user("staff", is_staff=True)
        self.client.force_authenticate(user=staff)
        resp = self.client.get(PROJECTS_URL)
        self.assertEqual(resp.status_code, 200)
        names = [p["name"] for p in resp.data["results"]]
        self.assertIn("Project Alpha", names)
        self.assertIn("Project Beta", names)


class AccountProjectCreateTest(APITestCase):
    def setUp(self):
        self.user = _make_user("owner")
        self.acct = _make_account("Acme", admin_owner=self.user)

    def test_create_project(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(PROJECTS_URL, {
            "account": self.acct.id,
            "name": "New Project",
            "description": "A description",
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["name"], "New Project")

    def test_create_sets_correct_account(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(PROJECTS_URL, {"account": self.acct.id, "name": "P"})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["account"], self.acct.id)

    def test_cannot_create_on_unrelated_account(self):
        other = _make_user("other")
        other_acct = _make_account("Other Corp", admin_owner=other)
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(PROJECTS_URL, {"account": other_acct.id, "name": "Sneaky"})
        self.assertIn(resp.status_code, [403, 404])


class AccountProjectUpdateTest(APITestCase):
    def setUp(self):
        self.user = _make_user("owner")
        self.acct = _make_account("Acme", admin_owner=self.user)
        self.project = _make_project(self.acct, "Original Name")

    def test_update_own_project(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resp = self.client.patch(url, {"name": "Renamed"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["name"], "Renamed")

    def test_update_other_project_denied(self):
        other = _make_user("other")
        other_acct = _make_account("Other Corp", admin_owner=other)
        other_project = _make_project(other_acct, "Their Project")
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{other_project.id}/"
        resp = self.client.patch(url, {"name": "Hijack"})
        self.assertIn(resp.status_code, [403, 404])


class AccountProjectLinkedFieldsTest(APITestCase):
    """New action_ids / meeting_ids / goal_ids / resources / url fields persist correctly."""

    def setUp(self):
        self.user = _make_user("owner")
        self.acct = _make_account("Acme", admin_owner=self.user)
        self.project = _make_project(self.acct, "Alpha")

    def test_linked_fields_default_empty(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["action_ids"], [])
        self.assertEqual(resp.data["meeting_ids"], [])
        self.assertEqual(resp.data["goal_ids"], [])
        self.assertEqual(resp.data["resources"], [])
        self.assertEqual(resp.data["url"], "")

    def test_patch_action_ids_persists(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resp = self.client.patch(url, {"action_ids": ["rec123", "rec456"]}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["action_ids"], ["rec123", "rec456"])
        # Confirm persisted to DB
        self.project.refresh_from_db()
        self.assertEqual(self.project.action_ids, ["rec123", "rec456"])

    def test_patch_meeting_ids_persists(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resp = self.client.patch(url, {"meeting_ids": ["meet1"]}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.meeting_ids, ["meet1"])

    def test_patch_url_persists(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resp = self.client.patch(url, {"url": "https://example.com"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.url, "https://example.com")

    def test_patch_resources_persists(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resources = [{"id": "r1", "label": "Doc", "url": "https://docs.example.com"}]
        resp = self.client.patch(url, {"resources": resources}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.resources, resources)

    def test_create_with_linked_fields(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.post(PROJECTS_URL, {
            "account": self.acct.id,
            "name": "New",
            "action_ids": ["recABC"],
            "meeting_ids": [],
            "goal_ids": [],
            "resources": [],
            "url": "https://example.com",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["action_ids"], ["recABC"])
        self.assertEqual(resp.data["url"], "https://example.com")


class AccountProjectDeleteTest(APITestCase):
    def setUp(self):
        self.user = _make_user("owner")
        self.acct = _make_account("Acme", admin_owner=self.user)
        self.project = _make_project(self.acct, "To Delete")

    def test_delete_own_project(self):
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{self.project.id}/"
        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AccountProject.objects.filter(pk=self.project.id).exists())

    def test_delete_other_project_denied(self):
        other = _make_user("other")
        other_acct = _make_account("Other Corp", admin_owner=other)
        other_project = _make_project(other_acct, "Theirs")
        self.client.force_authenticate(user=self.user)
        url = f"{PROJECTS_URL}{other_project.id}/"
        resp = self.client.delete(url)
        self.assertIn(resp.status_code, [403, 404])


# ── AccountRole tests ──────────────────────────────────────────────────────────

from accounts.models import AccountRole
from team.models import UserProfile

ROLES_URL = "/api/v1/accounts/roles/"


def _make_staff(username):
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="pass", is_staff=True)
    UserProfile.objects.create(user=user, staff_view_override=True)
    return user


class AccountRoleUnauthenticatedTest(APITestCase):
    def test_list_requires_auth(self):
        resp = self.client.get(ROLES_URL)
        self.assertEqual(resp.status_code, 401)

    def test_create_requires_auth(self):
        acct = _make_account("Corp A")
        user = _make_user("anon")
        resp = self.client.post(ROLES_URL, {"user": user.id, "account": acct.id, "role": "sync_reviewer"})
        self.assertEqual(resp.status_code, 401)


class AccountRoleStaffTest(APITestCase):
    def setUp(self):
        self.staff = _make_staff("staff1")
        self.regular = _make_user("reg1")
        self.acct = _make_account("Acme Corp")

    def test_staff_can_create_role(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(ROLES_URL, {"user": self.regular.id, "account": self.acct.id, "role": "sync_reviewer"})
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(AccountRole.objects.filter(user=self.regular, account=self.acct, role="sync_reviewer").exists())

    def test_staff_can_delete_role(self):
        self.client.force_authenticate(user=self.staff)
        role = AccountRole.objects.create(user=self.regular, account=self.acct, role="sync_reviewer", assigned_by=self.staff)
        resp = self.client.delete(f"{ROLES_URL}{role.id}/")
        self.assertEqual(resp.status_code, 204)

    def test_staff_sees_all_roles(self):
        other_user = _make_user("other1")
        other_acct = _make_account("Other Corp")
        AccountRole.objects.create(user=self.regular, account=self.acct, role="sync_reviewer", assigned_by=self.staff)
        AccountRole.objects.create(user=other_user, account=other_acct, role="account_owner", assigned_by=self.staff)
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(ROLES_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 2)


class AccountRoleNonStaffTest(APITestCase):
    def setUp(self):
        self.staff = _make_staff("staff2")
        self.user1 = _make_user("user_a")
        self.user2 = _make_user("user_b")
        self.acct = _make_account("Corp B")
        AccountRole.objects.create(user=self.user1, account=self.acct, role="sync_reviewer", assigned_by=self.staff)

    def test_non_staff_cannot_create_role(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.post(ROLES_URL, {"user": self.user2.id, "account": self.acct.id, "role": "sync_reviewer"})
        self.assertEqual(resp.status_code, 403)

    def test_non_staff_cannot_delete_role(self):
        self.client.force_authenticate(user=self.user1)
        role = AccountRole.objects.get(user=self.user1, account=self.acct)
        resp = self.client.delete(f"{ROLES_URL}{role.id}/")
        self.assertEqual(resp.status_code, 403)
