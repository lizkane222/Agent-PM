"""
Tests for the Cloud Coach MCP tools.

These are dispatched exactly the way the agent dispatches them — through
`mcp_server.dispatch(name, args, user=...)`, which is what sets the `_current_user`
ContextVar the tools read. Calling the functions directly would leave that unset and
prove nothing about the real path.

The `skill_safe` assertion here is deliberately duplicated with
`agents/tests/test_mcp_catalog.py`'s locked `EXPECTED_SKILL_SAFE` set: that test is
owned by another session, and this one states from *this* side that these tools must
stay out of the catalog, so a future `skill_safe=True` breaks a test whose reason is
recorded next to the tool.
"""

from datetime import date, datetime, timedelta, timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from accounts.models import Account, AccountProject
from agents.mcp_server import mcp_server
from scheduler.models import CalendarEvent

from salesforce_sync.models import SalesforceConfig, SalesforceTimeEntry

from .fakes import full_org

User = get_user_model()

MONDAY = date(2026, 8, 31)
SF_USER_ID = "005000000000001AAA"


CLOUD_COACH_TOOLS = ("preview_time_log_week", "log_time_week", "find_cloud_coach_project")


class RegistrationTest(TestCase):
    def test_every_tool_is_registered(self):
        # Registration happens in `SalesforceSyncConfig.ready()`, so this also asserts
        # the AppConfig hook fired — the whole reason no edit to agents/ was needed.
        tools = mcp_server.list_tools()
        for name in CLOUD_COACH_TOOLS:
            self.assertIn(name, tools)

    def test_no_tool_is_skill_safe(self):
        safe = set(mcp_server.skill_safe_tools())
        for name in CLOUD_COACH_TOOLS:
            self.assertNotIn(name, safe)

    def test_every_tool_appears_in_the_derived_system_prompt(self):
        from agents.agent import SYSTEM_PROMPT

        for name in CLOUD_COACH_TOOLS:
            self.assertIn(name, SYSTEM_PROMPT)

    def test_schemas_are_sent_to_claude_with_a_description(self):
        by_name = {s["name"]: s for s in mcp_server.tool_schemas()}
        for name in CLOUD_COACH_TOOLS:
            self.assertTrue(by_name[name]["description"], f"{name} has no description")

    def test_the_write_tool_exposes_no_confirm_argument(self):
        # The spoken gate in realtime/voice_policy.py replaced the interim `confirm=`
        # parameter; leaving it in the schema would invite the model to ask twice.
        props = mcp_server.tool_schemas()
        by_name = {s["name"]: s for s in props}
        self.assertNotIn("confirm", by_name["log_time_week"]["input_schema"]["properties"])

    def test_the_lookup_tool_requires_a_name(self):
        by_name = {s["name"]: s for s in mcp_server.tool_schemas()}
        schema = by_name["find_cloud_coach_project"]["input_schema"]
        self.assertEqual(schema["required"], ["name"])

    def test_registering_twice_is_a_no_op(self):
        from salesforce_sync import agent_tools

        before = len(mcp_server.list_tools())
        agent_tools.register(mcp_server)  # would raise ValueError if it re-decorated
        self.assertEqual(len(mcp_server.list_tools()), before)


class ToolDispatchTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="liz", email="liz@example.com", password="pass"
        )
        SalesforceConfig.objects.create(
            user=self.user,
            instance_url="https://example.my.salesforce.com",
            sf_user_id=SF_USER_ID,
        )
        self.account = Account.objects.create(company_name="Acme")
        AccountProject.objects.create(
            account=self.account, name="Acme Phase 1", sf_project_id="a0B000000000001"
        )
        self.sf = full_org(
            query_results={"FROM Resource__c": {"records": [{"Id": "a0R000000000001"}]}}
        )

    def _event(self, *, hour=9, minutes=60, account=..., **kwargs):
        start = datetime(MONDAY.year, MONDAY.month, MONDAY.day, hour, tzinfo=timezone.utc)
        return CalendarEvent.objects.create(
            owner=self.user,
            account=self.account if account is ... else account,
            title=kwargs.pop("title", "Kickoff"),
            start_datetime=start,
            end_datetime=start + timedelta(minutes=minutes),
            **kwargs,
        )

    # `tool`, not `name`: find_cloud_coach_project takes a `name` argument of its own, and
    # a positional-or-keyword clash here reads as a confusing TypeError from asgiref.
    async def _dispatch(self, tool, **args):
        with mock.patch("salesforce_sync.client.get_client", return_value=self.sf):
            return await mcp_server.dispatch(tool, args, user=self.user)

    async def _dispatch_anon(self, tool, **args):
        return await mcp_server.dispatch(tool, args, user=None)

    # ── preview ──────────────────────────────────────────────────────────────

    async def test_preview_returns_totals_and_writes_nothing(self):
        await self._acreate_event(minutes=90)

        result = await self._dispatch("preview_time_log_week", week_start="2026-08-31")

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["entry_count"], 1)
        self.assertEqual(result["total_hours"], 1.5)
        self.assertEqual(self.sf.composite_call_count, 0)

    async def test_preview_summary_names_every_skip_category(self):
        await self._acreate_event(hour=9, account=None, title="Unlinked")
        await self._acreate_event(hour=11, attended=False, title="Skipped")

        result = await self._dispatch("preview_time_log_week", week_start="2026-08-31")

        self.assertEqual(result["unlinked_count"], 1)
        self.assertEqual(result["not_attended_count"], 1)
        self.assertIn("not linked to an account", result["summary"])
        self.assertIn("marked did not attend", result["summary"])

    async def test_preview_omits_the_per_event_detail_lists(self):
        # A busy week's skip lists run to hundreds of entries and none of it is
        # speakable, so the tool result carries counts only.
        await self._acreate_event(account=None)

        result = await self._dispatch("preview_time_log_week")

        self.assertNotIn("unlinked_events", result)
        self.assertNotIn("not_attended_events", result)

    async def test_preview_rejects_a_garbage_week(self):
        result = await self._dispatch("preview_time_log_week", week_start="last tuesday")

        self.assertEqual(result["status"], "error")
        self.assertIn("ISO date", result["message"])

    async def test_preview_without_a_user_is_not_authorized(self):
        result = await self._dispatch_anon("preview_time_log_week")

        self.assertEqual(result["message"], "Not authorized for this record")

    # ── writing ──────────────────────────────────────────────────────────────
    #
    # There is no `confirm=` argument any more. Voice is gated by
    # realtime.voice_policy.VOICE_CONFIRM_TOOLS (the spoken "say yes, or press 1"), so a
    # second in-tool gate would make the caller confirm twice. That the gate exists is
    # asserted in realtime/tests/test_voice_policy.py.

    async def test_a_call_writes_in_one_composite_call(self):
        await self._acreate_event(minutes=90)

        result = await self._dispatch("log_time_week", week_start="2026-08-31")

        self.assertEqual(result["status"], "logged")
        self.assertEqual(result["written"], 1)
        self.assertEqual(self.sf.composite_call_count, 1)
        self.assertEqual(await self._acount_entries(), 1)

    async def test_an_empty_week_writes_nothing(self):
        result = await self._dispatch("log_time_week", week_start="2026-08-31")

        self.assertEqual(result["written"], 0)
        self.assertEqual(self.sf.composite_call_count, 0)
        self.assertEqual(await self._acount_entries(), 0)

    async def test_a_disconnected_salesforce_is_reported_not_raised(self):
        await self._acreate_event()

        with mock.patch(
            "salesforce_sync.client.get_client",
            side_effect=PermissionError("nope"),
        ):
            result = await mcp_server.dispatch(
                "log_time_week", {"week_start": "2026-08-31"}, user=self.user,
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("not connected", result["message"])

    async def test_a_rejected_write_is_reported_not_raised(self):
        await self._acreate_event()
        sf = full_org(composite_response={"compositeResponse": [
            {"referenceId": "log_1", "httpStatusCode": 400, "body": [{"message": "boom"}]},
        ]})

        with mock.patch("salesforce_sync.client.get_client", return_value=sf):
            result = await mcp_server.dispatch(
                "log_time_week", {"week_start": "2026-08-31"}, user=self.user,
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("rejected", result["message"])

    async def test_log_without_a_user_is_not_authorized(self):
        result = await self._dispatch_anon("log_time_week")

        self.assertEqual(result["message"], "Not authorized for this record")

    # ── find a project by name ───────────────────────────────────────────────

    def _lookup_sf(self, records):
        from .fakes import FULL_PROJECT_FIELDS, FakeSalesforce
        return FakeSalesforce(
            describes={"project_cloud__Project__c": FULL_PROJECT_FIELDS},
            query_results={"FROM project_cloud__Project__c": {"records": records}},
        )

    async def test_lookup_reports_the_users_role_on_a_match(self):
        # The useful half of the answer is not "it exists" but "and you're on it as X".
        self.sf = self._lookup_sf([{
            "Id": "a0B000000000001", "Name": "Autodesk Segment Sync",
            "ccpe_ocp__Account__c": "0011",
            "ccpe_ocp__Account__r": {"Name": "Autodesk"},
            "Solution_Architect_Primary__c": SF_USER_ID,
        }])

        result = await self._dispatch("find_cloud_coach_project", name="autodesk segment")

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["match_count"], 1)
        match = result["matches"][0]
        self.assertTrue(match["isMember"])
        self.assertEqual(match["myRoles"], ["Solution_Architect_Primary__c"])
        self.assertIn("Solution Architect Primary", result["summary"])
        self.assertIn("Autodesk", result["summary"])

    async def test_lookup_says_you_are_not_assigned_when_no_role_holds_you(self):
        self.sf = self._lookup_sf([{
            "Id": "a0B000000000002", "Name": "Someone Elses Project",
            "Project_Manager__c": "005000000000999AAA",
        }])

        result = await self._dispatch("find_cloud_coach_project", name="someone")

        self.assertFalse(result["matches"][0]["isMember"])
        self.assertIn("not assigned", result["summary"])

    async def test_lookup_reports_not_found_rather_than_erroring(self):
        self.sf = self._lookup_sf([])

        result = await self._dispatch("find_cloud_coach_project", name="nope")

        self.assertEqual(result["status"], "not_found")
        self.assertEqual(result["matches"], [])
        self.assertIn("nope", result["summary"])

    async def test_lookup_mentions_the_other_matches(self):
        self.sf = self._lookup_sf([
            {"Id": "a0B1", "Name": "Acme Phase 1"},
            {"Id": "a0B2", "Name": "Acme Phase 2"},
        ])

        result = await self._dispatch("find_cloud_coach_project", name="acme")

        self.assertEqual(result["match_count"], 2)
        self.assertIn("1 other match", result["summary"])

    async def test_lookup_requires_a_name(self):
        result = await self._dispatch("find_cloud_coach_project", name="  ")

        self.assertEqual(result["status"], "error")
        self.assertIn("name is required", result["message"])

    async def test_lookup_without_a_user_is_not_authorized(self):
        result = await self._dispatch_anon("find_cloud_coach_project", name="acme")

        self.assertEqual(result["message"], "Not authorized for this record")

    # ── async ORM helpers ────────────────────────────────────────────────────

    async def _acreate_event(self, **kwargs):
        from asgiref.sync import sync_to_async

        return await sync_to_async(self._event, thread_sensitive=True)(**kwargs)

    async def _acount_entries(self):
        from asgiref.sync import sync_to_async

        return await sync_to_async(
            SalesforceTimeEntry.objects.count, thread_sensitive=True
        )()


class VoiceGateWiringTest(TestCase):
    """
    The interim `salesforce_sync/voice_gate.py` is gone; the spec now lives in
    `realtime/voice_policy.py::VOICE_CONFIRM_TOOLS`. Asserted from this side too, so a
    future edit that drops the entry fails a test sitting next to the tool it protects.
    """

    def test_the_salesforce_write_is_gated_in_voice(self):
        from realtime.voice_policy import VOICE_CONFIRM_TOOLS

        self.assertIn("log_time_week", VOICE_CONFIRM_TOOLS)
        self.assertEqual(VOICE_CONFIRM_TOOLS["log_time_week"].category, "outbound")

    def test_the_read_only_tools_are_not_gated(self):
        # A confirmation prompt before answering "how many hours do I have" would be
        # actively annoying, and nothing is written.
        from realtime.voice_policy import VOICE_CONFIRM_TOOLS

        self.assertNotIn("preview_time_log_week", VOICE_CONFIRM_TOOLS)
        self.assertNotIn("find_cloud_coach_project", VOICE_CONFIRM_TOOLS)

    def test_the_interim_module_is_gone(self):
        with self.assertRaises(ImportError):
            __import__("salesforce_sync.voice_gate")
