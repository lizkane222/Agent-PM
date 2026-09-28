"""
Tests for `salesforce_sync.project_members` — adding a person to a Cloud Coach project.

The precedence ladder is the whole design, and none of it can be verified against the live
org, so every rung is pinned here:

    already a member       -> no write
    Resource Assignment    -> preferred when the org has it (creates, disturbs nothing)
    first EMPTY role slot  -> otherwise
    all slots populated    -> no write, reported

`test_a_populated_role_field_is_never_overwritten` is the one that matters most.
`Project_Manager__c` is a real named role on a record the whole team shares; clobbering it
to satisfy a drag-and-drop would be worse than not pushing at all.
"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account, AccountProject, ProjectMember
from team.models import TeamMember

from salesforce_sync.models import (
    SalesforceConfig,
    SalesforceProject,
    SalesforceTeamMember,
)
from salesforce_sync.project_members import (
    ALREADY_MEMBER,
    ERROR,
    MECHANISM_RESOURCE_ASSIGNMENT,
    MECHANISM_ROLE_FIELD,
    NO_FREE_SLOT,
    NO_MECHANISM,
    NO_SF_USER,
    PUSHED,
    push_member_to_project,
    resolve_sf_user_id,
    sync_project_members,
)

from .fakes import FULL_PROJECT_FIELDS, FakeSalesforce

User = get_user_model()

PROJECT_ID = "a0B000000000001"
MEMBER_SF_ID = "005000000000042AAA"
OTHER_SF_ID = "005000000000999AAA"

RA_OBJECT = "project_cloud__Resource_Assignment__c"
RA_FIELDS = [
    "Id", "project_cloud__Project_ID__c", "project_cloud__User__c",
    "project_cloud__Start__c", "project_cloud__End__c",
]


def _project_record(**roles):
    """A Project row with every role slot empty unless named in `roles`."""
    record = {"Id": PROJECT_ID, "Name": "Acme Rollout"}
    for field in FULL_PROJECT_FIELDS:
        if field.endswith("__c") and not field.startswith(("ccpe_", "project_cloud__")):
            record[field] = None
    record.update(roles)
    return record


def _sf(
    *,
    project_record=None,
    has_resource_assignment=False,
    existing_assignment=False,
    user_query=None,
):
    describes = {"project_cloud__Project__c": FULL_PROJECT_FIELDS}
    if has_resource_assignment:
        describes[RA_OBJECT] = RA_FIELDS
    queries = {
        "FROM project_cloud__Project__c": {
            "records": [project_record if project_record is not None else _project_record()]
        },
        f"FROM {RA_OBJECT}": {"records": [{"Id": "a0R1"}] if existing_assignment else []},
    }
    if user_query is not None:
        queries["FROM User"] = user_query
    return FakeSalesforce(describes=describes, query_results=queries)


class MemberPushTestBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pw-not-a-secret"
        )
        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://example.my.salesforce.com",
            sf_user_id="005000000000001AAA",
        )
        self.member = TeamMember.objects.create(
            full_name="Jane Doe", email="jane@example.com", status="active"
        )
        # The mirror `sync_project_roles` writes, so no email query is needed by default.
        project = SalesforceProject.objects.create(sf_id=PROJECT_ID, name="Acme Rollout")
        SalesforceTeamMember.objects.create(
            sf_id=f"role:{PROJECT_ID}:Project_Manager__c",
            project=project,
            sf_user_id=MEMBER_SF_ID,
            email="jane@example.com",
            name="Jane Doe",
            role="Project_Manager__c",
        )

    def push(self, sf, **kwargs):
        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            return push_member_to_project(self.user, PROJECT_ID, self.member, **kwargs)


class ResolveSfUserIdTest(MemberPushTestBase):
    def test_prefers_the_local_mirror_over_a_query(self):
        sf = _sf()

        self.assertEqual(resolve_sf_user_id(sf, self.member), MEMBER_SF_ID)
        self.assertEqual(sf.queries, [])

    def test_falls_back_to_an_email_query(self):
        SalesforceTeamMember.objects.all().delete()
        sf = _sf(user_query={"records": [{"Id": MEMBER_SF_ID}]})

        self.assertEqual(resolve_sf_user_id(sf, self.member), MEMBER_SF_ID)
        self.assertIn("jane@example.com", sf.queries[0])
        self.assertIn("IsActive = true", sf.queries[0])

    def test_matches_the_mirror_by_local_member_id_too(self):
        SalesforceTeamMember.objects.all().update(email="", local_member_id=self.member.pk)
        sf = _sf()

        self.assertEqual(resolve_sf_user_id(sf, self.member), MEMBER_SF_ID)

    def test_returns_blank_when_no_salesforce_user_exists(self):
        SalesforceTeamMember.objects.all().delete()
        sf = _sf(user_query={"records": []})

        self.assertEqual(resolve_sf_user_id(sf, self.member), "")

    def test_a_member_with_no_email_and_no_mirror_resolves_to_blank(self):
        SalesforceTeamMember.objects.all().delete()
        self.member.email = ""
        sf = _sf()

        self.assertEqual(resolve_sf_user_id(sf, self.member), "")
        self.assertEqual(sf.queries, [])


class PrecedenceLadderTest(MemberPushTestBase):
    def test_already_holding_a_role_writes_nothing(self):
        # Makes a repeated drag idempotent.
        sf = _sf(project_record=_project_record(Project_Manager__c=MEMBER_SF_ID))

        result = self.push(sf)

        self.assertEqual(result["status"], ALREADY_MEMBER)
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])

    def test_an_existing_resource_assignment_writes_nothing(self):
        sf = _sf(has_resource_assignment=True, existing_assignment=True)

        result = self.push(sf)

        self.assertEqual(result["status"], ALREADY_MEMBER)
        self.assertEqual(result["mechanism"], MECHANISM_RESOURCE_ASSIGNMENT)
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])

    def test_resource_assignment_is_preferred_when_the_org_has_it(self):
        # Creating a child record disturbs nothing, so it beats touching the Project.
        sf = _sf(has_resource_assignment=True)

        result = self.push(sf)

        self.assertEqual(result["status"], PUSHED)
        self.assertEqual(result["mechanism"], MECHANISM_RESOURCE_ASSIGNMENT)
        posts = sf.restful_calls_of_kind("POST")
        self.assertEqual(len(posts), 1)
        path, _, body = posts[0]
        self.assertEqual(path, f"sobjects/{RA_OBJECT}")
        self.assertEqual(body["project_cloud__Project_ID__c"], PROJECT_ID)
        self.assertEqual(body["project_cloud__User__c"], MEMBER_SF_ID)
        # The Project record itself is untouched.
        self.assertEqual(sf.restful_calls_of_kind("PATCH"), [])

    def test_falls_back_to_the_first_empty_role_slot(self):
        sf = _sf()  # no Resource Assignment object in this org

        result = self.push(sf)

        self.assertEqual(result["status"], PUSHED)
        self.assertEqual(result["mechanism"], MECHANISM_ROLE_FIELD)
        self.assertEqual(result["field"], "Deliverability__c")  # first in schema order
        patches = sf.restful_calls_of_kind("PATCH")
        self.assertEqual(len(patches), 1)
        path, _, body = patches[0]
        self.assertEqual(path, f"sobjects/project_cloud__Project__c/{PROJECT_ID}")
        self.assertEqual(body, {"Deliverability__c": MEMBER_SF_ID})

    def test_a_populated_role_field_is_never_overwritten(self):
        # The single most important assertion in this module.
        sf = _sf(project_record=_project_record(
            Deliverability__c=OTHER_SF_ID,
            Engagement_Manager__c=OTHER_SF_ID,
        ))

        result = self.push(sf)

        self.assertEqual(result["status"], PUSHED)
        self.assertEqual(result["field"], "Launch_Engineer__c")  # the next *empty* one
        _, _, body = sf.restful_calls_of_kind("PATCH")[0]
        self.assertNotIn("Deliverability__c", body)
        self.assertNotIn("Engagement_Manager__c", body)

    def test_all_slots_full_reports_and_writes_nothing(self):
        full = _project_record(**{
            f: OTHER_SF_ID for f in FULL_PROJECT_FIELDS
            if f.endswith("__c") and not f.startswith(("ccpe_", "project_cloud__"))
        })
        sf = _sf(project_record=full)

        result = self.push(sf)

        self.assertEqual(result["status"], NO_FREE_SLOT)
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])
        self.assertIn("already filled", result["message"])

    def test_an_org_with_neither_mechanism_reports_no_mechanism(self):
        sf = FakeSalesforce(
            describes={"project_cloud__Project__c": ["Id", "Name"]},
            query_results={"FROM project_cloud__Project__c": {"records": [{"Id": PROJECT_ID, "Name": "P"}]}},
        )

        result = self.push(sf)

        self.assertEqual(result["status"], NO_MECHANISM)
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])


class PushEdgeCaseTest(MemberPushTestBase):
    def test_dry_run_resolves_the_plan_without_writing(self):
        sf = _sf()

        result = self.push(sf, dry_run=True)

        self.assertEqual(result["status"], PUSHED)
        self.assertEqual(result["field"], "Deliverability__c")
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])

    def test_no_salesforce_user_is_reported_not_raised(self):
        SalesforceTeamMember.objects.all().delete()
        sf = _sf(user_query={"records": []})

        result = self.push(sf)

        self.assertEqual(result["status"], NO_SF_USER)
        self.assertIn("jane@example.com", result["message"])
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])

    def test_a_missing_project_is_reported(self):
        sf = _sf()
        sf.query_results["FROM project_cloud__Project__c"] = {"records": []}

        result = self.push(sf)

        self.assertEqual(result["status"], ERROR)
        self.assertIn("no longer exists", result["message"])

    def test_a_non_salesforce_project_id_is_rejected_before_any_call(self):
        sf = _sf()
        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            result = push_member_to_project(self.user, "local-7", self.member)

        self.assertEqual(result["status"], ERROR)
        self.assertEqual(sf.queries, [])

    def test_a_disconnected_salesforce_is_reported_not_raised(self):
        with mock.patch(
            "salesforce_sync.client.get_client", side_effect=PermissionError("nope")
        ):
            result = push_member_to_project(self.user, PROJECT_ID, self.member)

        self.assertEqual(result["status"], ERROR)
        self.assertIn("not connected", result["message"])

    def test_a_rejected_write_reports_without_leaking_salesforce_detail(self):
        # Only the write raises — the describe and query path must still work, or the
        # failure would come from planning rather than from the PATCH under test.
        sf = _sf()
        sf.restful = _raise_only_on_write(sf)

        result = self.push(sf)

        self.assertEqual(result["status"], ERROR)
        self.assertNotIn("INSUFFICIENT_ACCESS", result["message"])
        self.assertIn("Jane Doe", result["message"])


def _raise_only_on_write(sf):
    """Wrap `restful` so describes still work but POST/PATCH raise."""
    original = sf.restful

    def wrapper(path, method="GET", json=None, **kwargs):
        if method in ("POST", "PATCH"):
            raise RuntimeError("INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY")
        return original(path, method=method, json=json, **kwargs)

    return wrapper


class SyncProjectMembersTest(MemberPushTestBase):
    def setUp(self):
        super().setUp()
        self.account = Account.objects.create(company_name="Acme")
        self.project = AccountProject.objects.create(
            account=self.account, name="Acme Rollout", sf_project_id=PROJECT_ID
        )
        ProjectMember.objects.create(project=self.project, team_member=self.member)

    def _sync(self, sf, **kwargs):
        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            return sync_project_members(self.user, self.project, **kwargs)

    def test_dry_run_reports_the_plan_for_every_member_without_writing(self):
        sf = _sf()

        result = self._sync(sf, dry_run=True)

        self.assertTrue(result["dry_run"])
        self.assertEqual(result["member_count"], 1)
        self.assertEqual(result["counts"], {PUSHED: 1})
        self.assertEqual(sf.restful_calls_of_kind("POST", "PATCH"), [])

    def test_a_real_run_writes(self):
        sf = _sf()

        result = self._sync(sf)

        self.assertFalse(result["dry_run"])
        self.assertEqual(result["counts"], {PUSHED: 1})
        self.assertEqual(len(sf.restful_calls_of_kind("PATCH")), 1)

    def test_a_project_with_no_salesforce_id_reports_rather_than_calling_out(self):
        self.project.sf_project_id = ""
        self.project.save(update_fields=["sf_project_id"])
        sf = _sf()

        result = self._sync(sf)

        self.assertEqual(result["status"], ERROR)
        self.assertEqual(sf.queries, [])
        self.assertIn("no Salesforce project id", result["message"])

    def test_counts_roll_up_mixed_outcomes(self):
        already = TeamMember.objects.create(
            full_name="Al Ready", email="al@example.com", status="active"
        )
        ProjectMember.objects.create(project=self.project, team_member=already)
        sf = _sf(project_record=_project_record(Project_Manager__c=MEMBER_SF_ID))

        result = self._sync(sf, dry_run=True)

        self.assertEqual(result["member_count"], 2)
        self.assertEqual(result["counts"].get(ALREADY_MEMBER), 1)
        self.assertEqual(result["counts"].get(NO_SF_USER), 1)
