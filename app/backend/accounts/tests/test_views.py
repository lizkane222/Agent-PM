"""Tests for AccountProjectViewSet — scoping, CRUD, and new linked-ID fields."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Account, AccountArtifact, AccountProject

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


# ── Admin account de-duplication ──────────────────────────────────────────────

ACCOUNTS_URL = "/api/v1/accounts/accounts/"
ADMIN_ACCOUNT_URL = "/api/v1/accounts/admin-account/"


class AdminAccountDeduplicationTest(APITestCase):
    """A user must never see two Admin accounts.

    "Admin" is a reserved per-user workspace name. A row carrying that name without
    `is_admin_account=True` is a stale mirror of the shared Airtable "ADMIN" record;
    it qualified under the staff branch of `AccountViewSet.get_queryset`
    (`is_admin_account=False`) and appeared alongside the caller's real Admin, so
    staff saw two Admin accounts while non-staff saw one.
    """

    def setUp(self):
        self.staff = _make_staff("admin_dedup_staff")
        self.regular = _make_user("admin_dedup_regular")
        # The stale shared mirror, exactly as it exists in the dev database:
        # uppercase name, not flagged as a personal workspace, no admin_owner.
        self.orphan = Account.objects.create(
            company_name="ADMIN", airtable_id="recADMIN", is_admin_account=False
        )

    def _account_names(self, user):
        self.client.force_authenticate(user=user)
        resp = self.client.get(ACCOUNTS_URL)
        self.assertEqual(resp.status_code, 200)
        return [row["company_name"] for row in resp.data["results"]]

    def _admin_names(self, user):
        return [n for n in self._account_names(user) if n.lower() == "admin"]

    def test_staff_sees_exactly_one_admin(self):
        self.client.force_authenticate(user=self.staff)
        self.client.get(ADMIN_ACCOUNT_URL)  # creates the personal workspace
        self.assertEqual(self._admin_names(self.staff), ["Admin"])

    def test_non_staff_sees_exactly_one_admin(self):
        self.client.force_authenticate(user=self.regular)
        self.client.get(ADMIN_ACCOUNT_URL)
        self.assertEqual(self._admin_names(self.regular), ["Admin"])

    def test_personal_admin_account_is_still_listed(self):
        """The exclusion must key off is_admin_account, not the name alone."""
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(ADMIN_ACCOUNT_URL)
        self.assertEqual(resp.status_code, 200)
        personal_id = resp.data["id"]
        self.assertTrue(resp.data["is_admin_account"])
        listed_ids = [row["id"] for row in self.client.get(ACCOUNTS_URL).data["results"]]
        self.assertIn(personal_id, listed_ids)
        self.assertNotIn(self.orphan.id, listed_ids)

    def test_admin_account_endpoint_returns_the_personal_row(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.get(ADMIN_ACCOUNT_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertNotEqual(resp.data["id"], self.orphan.id)
        self.assertEqual(resp.data["company_name"], "Admin")

    def test_admin_account_endpoint_is_idempotent(self):
        self.client.force_authenticate(user=self.regular)
        first = self.client.get(ADMIN_ACCOUNT_URL).data["id"]
        second = self.client.get(ADMIN_ACCOUNT_URL).data["id"]
        self.assertEqual(first, second)
        self.assertEqual(
            Account.objects.filter(admin_owner=self.regular).count(), 1
        )

    def test_other_users_admin_accounts_are_never_listed(self):
        other = _make_user("admin_dedup_other")
        self.client.force_authenticate(user=other)
        other_admin_id = self.client.get(ADMIN_ACCOUNT_URL).data["id"]

        self.client.force_authenticate(user=self.staff)
        self.client.get(ADMIN_ACCOUNT_URL)
        listed_ids = [row["id"] for row in self.client.get(ACCOUNTS_URL).data["results"]]
        self.assertNotIn(other_admin_id, listed_ids)

    def test_regular_accounts_are_unaffected(self):
        acct = _make_account("Acme")
        acct.team_members.clear()
        self.client.force_authenticate(user=self.staff)
        self.assertIn("Acme", self._account_names(self.staff))


# ── AccountViewSet.artifacts_batch ─────────────────────────────────────────────


ARTIFACTS_BATCH_URL = "/api/v1/accounts/accounts/artifacts-batch/"


def _make_team_member(user):
    from team.models import TeamMember
    return TeamMember.objects.create(
        user=user, full_name=user.username, email=f"{user.username}@example.com"
    )


def _make_artifact(account, uploaded_by, name):
    return AccountArtifact.objects.create(
        account=account, uploaded_by=uploaded_by, artifact_type="link",
        name=name, url="https://example.com/doc",
    )


class AccountArtifactsBatchTest(APITestCase):
    """GET /accounts/accounts/artifacts-batch/?ids=1,2,3 — the batched counterpart to
    the per-account artifacts route. RolePage used to call the detail route once per
    account, which tripped the DRF 200/min user throttle for users on many accounts."""

    def setUp(self):
        # These tests issue many list calls; clear DRF's throttle counters so they
        # neither trip the 200/min user rate nor leak counts into later tests.
        cache.clear()
        self.user = _make_user("artifacts_user")
        self.other = _make_user("artifacts_other")
        self.staff = _make_user("artifacts_staff", is_staff=True)

        self.member = _make_team_member(self.user)
        self.acct1 = _make_account("Acme")
        self.acct2 = _make_account("Beta")
        self.acct1.team_members.add(self.member)
        self.acct2.team_members.add(self.member)
        # An account the user is not on at all.
        self.foreign = _make_account("Foreign", admin_owner=self.other)

        self.a1 = _make_artifact(self.acct1, self.user, "Acme Doc")
        self.a2 = _make_artifact(self.acct2, self.user, "Beta Doc")
        # Uploaded by someone else — a team member should still see it on their account.
        self.a3 = _make_artifact(self.acct2, self.other, "Beta Doc By Other")
        self.foreign_artifact = _make_artifact(self.foreign, self.other, "Foreign Doc")

    def _names(self, ids, user=None):
        self.client.force_authenticate(user=user or self.user)
        resp = self.client.get(ARTIFACTS_BATCH_URL, {"ids": ids})
        self.assertEqual(resp.status_code, 200)
        return {row["name"] for row in resp.json()}

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(ARTIFACTS_BATCH_URL, {"ids": str(self.acct1.id)})
        self.assertEqual(resp.status_code, 401)

    def test_returns_artifacts_across_several_accounts_in_one_request(self):
        names = self._names(f"{self.acct1.id},{self.acct2.id}")
        self.assertEqual(names, {"Acme Doc", "Beta Doc", "Beta Doc By Other"})

    def test_single_id_works(self):
        self.assertEqual(self._names(str(self.acct1.id)), {"Acme Doc"})

    def test_omits_accounts_outside_the_callers_scope(self):
        """The security guard: naming an unreachable account ID in the batch must not
        return its artifacts. Out-of-scope IDs are dropped, not raised on."""
        names = self._names(f"{self.acct1.id},{self.foreign.id}")
        self.assertEqual(names, {"Acme Doc"})
        self.assertNotIn("Foreign Doc", names)

    def test_missing_ids_param_returns_empty_list(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(ARTIFACTS_BATCH_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_empty_ids_param_returns_empty_list(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(ARTIFACTS_BATCH_URL, {"ids": ""})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_unparseable_ids_return_empty_list(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(ARTIFACTS_BATCH_URL, {"ids": "not-an-id"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_whitespace_and_empty_tokens_tolerated(self):
        names = self._names(f" {self.acct1.id} ,,{self.acct2.id},")
        self.assertEqual(names, {"Acme Doc", "Beta Doc", "Beta Doc By Other"})

    def test_staff_sees_artifacts_for_all_named_accounts(self):
        names = self._names(
            f"{self.acct1.id},{self.foreign.id}", user=self.staff
        )
        self.assertIn("Acme Doc", names)
        self.assertIn("Foreign Doc", names)

    def test_element_shape_matches_the_per_account_detail_route(self):
        """RolePage consumes both routes interchangeably, so the element keys must match."""
        self.client.force_authenticate(user=self.user)
        batch = self.client.get(ARTIFACTS_BATCH_URL, {"ids": str(self.acct1.id)}).json()
        detail = self.client.get(f"/api/v1/accounts/accounts/{self.acct1.id}/artifacts/").json()
        self.assertEqual(len(batch), 1)
        self.assertEqual(len(detail), 1)
        self.assertEqual(set(batch[0].keys()), set(detail[0].keys()))
        self.assertEqual(batch[0]["id"], detail[0]["id"])

    def test_response_is_a_flat_list_not_an_envelope(self):
        """Mirrors the detail route — callers read r.data directly, not r.data.results."""
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(ARTIFACTS_BATCH_URL, {"ids": str(self.acct1.id)})
        self.assertIsInstance(resp.json(), list)

    def test_accounts_with_no_artifacts_are_simply_absent(self):
        empty = _make_account("Empty")
        empty.team_members.add(self.member)
        names = self._names(f"{self.acct1.id},{empty.id}")
        self.assertEqual(names, {"Acme Doc"})
