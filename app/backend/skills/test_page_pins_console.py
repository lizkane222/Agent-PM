"""Skills pinned to pages, and the skill-run Console (attribution, capture, API)."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from agents.mcp_server import mcp_server
from agents.models import AgentMessage, AgentSession
from agents.tests.test_views import SEND_URL, _consume, _usage
from agents.tool_policy import active_skill_run
from skills import skill_console as sc
from skills.models import AgentSkill, SkillPagePin, SkillRun, SkillRunEvent

User = get_user_model()
PINS = "/api/v1/skills/page-pins/"
RUNS = "/api/v1/skills/runs/"


def user(name, staff=False):
    return User.objects.create_user(name, f"{name}@example.com", "pw", is_staff=staff)


def skill(owner, name="weekly-update", status="approved", visibility="private", **kw):
    return AgentSkill.objects.create(name=name, description="d", instructions="Do it.", status=status,
                                     visibility=visibility, created_by=owner, **kw)


class PagePinTests(APITestCase):
    def setUp(self):
        self.alice, self.bob, self.admin = user("alice"), user("bob"), user("boss", staff=True)
        self.mine = skill(self.alice)
        self.client.force_authenticate(self.alice)

    def pin(self, page="calendar", skill_obj=None, **extra):
        return self.client.post(PINS, {"page": page, "skill_id": (skill_obj or self.mine).pk, **extra}, format="json")

    def listing(self, page="calendar"):
        return self.client.get(PINS, {"page": page})

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(PINS, {"page": "calendar"}).status_code, 401)
        self.assertEqual(self.client.post(PINS, {}, format="json").status_code, 401)

    def test_unknown_page_is_refused_everywhere(self):
        self.assertEqual(self.listing("nope").status_code, 400)
        self.assertEqual(self.client.get(PINS).status_code, 400)
        self.assertEqual(self.pin("nope").status_code, 400)

    def test_every_supported_page_can_be_pinned(self):
        for page in ("calendar", "action-items", "reminders", "account-detail", "layouts", "activity-log"):
            self.assertEqual(self.pin(page).status_code, 201, page)
            self.assertEqual(len(self.listing(page).data["results"]), 1, page)

    def test_a_pin_is_personal_and_page_specific(self):
        self.pin("calendar")
        self.assertEqual(len(self.listing("calendar").data["results"]), 1)
        self.assertEqual(self.listing("reminders").data["results"], [])
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.listing("calendar").data["results"], [])

    def test_pinning_twice_is_idempotent(self):
        self.assertEqual(self.pin().status_code, 201)
        self.assertEqual(self.pin().status_code, 200)
        self.assertEqual(SkillPagePin.objects.count(), 1)

    def test_the_list_carries_what_the_page_needs_to_run_the_skill(self):
        self.pin()
        row = self.listing().data["results"][0]
        self.assertEqual((row["scope"], row["can_remove"]), ("mine", True))
        self.assertEqual(row["skill"]["name"], "weekly-update")
        for key in ("status", "templates", "context_defaults", "attachments"):
            self.assertIn(key, row["skill"])

    def test_only_runnable_skills_can_be_pinned(self):
        draft = skill(self.alice, name="not-ready", status="draft")
        theirs = skill(self.bob, name="bobs-private")
        for s in (draft, theirs):
            self.assertEqual(self.pin(skill_obj=s).status_code, 404, s.name)
        self.assertEqual(self.client.post(PINS, {"page": "calendar", "skill_id": "abc"}, format="json").status_code, 404)
        self.assertEqual(self.client.post(PINS, {"page": "calendar"}, format="json").status_code, 404)
        self.assertFalse(SkillPagePin.objects.exists())

    def test_a_public_approved_skill_of_someone_else_can_be_pinned(self):
        pub = skill(self.bob, name="shared-one", visibility="public")
        self.assertEqual(self.pin(skill_obj=pub).status_code, 201)

    def test_a_pinned_skill_that_stops_being_runnable_disappears_quietly(self):
        self.pin()
        self.mine.status = "draft"
        self.mine.save()
        self.assertEqual(self.listing().data["results"], [])
        self.mine.delete()
        self.assertEqual(self.listing().data["results"], [])

    def test_non_admins_cannot_pin_for_everyone(self):
        self.assertEqual(self.pin(everyone=True).status_code, 403)
        self.assertFalse(SkillPagePin.objects.exists())

    def test_everyone_flag_must_be_a_boolean(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.pin(skill_obj=skill(self.admin, name="a-skill"), everyone="yes").status_code, 400)

    def test_an_admin_pin_for_everyone_shows_for_every_user_but_only_the_admin_can_remove_it(self):
        s = skill(self.admin, name="org-wide", visibility="public")
        self.client.force_authenticate(self.admin)
        pin_id = self.pin(skill_obj=s, everyone=True).data["id"]
        for u, can in ((self.alice, False), (self.bob, False), (self.admin, True)):
            self.client.force_authenticate(u)
            row = self.listing().data["results"][0]
            self.assertEqual((row["scope"], row["can_remove"]), ("everyone", can), u.username)
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 403)
        self.assertTrue(SkillPagePin.objects.filter(pk=pin_id).exists())
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 204)

    def test_an_admin_can_still_pin_just_for_themselves(self):
        s = skill(self.admin, name="mine-only")
        self.client.force_authenticate(self.admin)
        self.pin(skill_obj=s)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.listing().data["results"], [])

    def test_an_everyone_pin_absorbs_a_personal_pin_of_the_same_skill(self):
        s = skill(self.admin, name="both-ways", visibility="public")
        self.pin(skill_obj=s)                                       # alice pins it herself
        self.client.force_authenticate(self.admin)
        self.pin(skill_obj=s, everyone=True)                        # then the admin pins it for all
        self.client.force_authenticate(self.alice)
        rows = self.listing().data["results"]
        self.assertEqual([r["scope"] for r in rows], ["everyone"])  # shown once, as the everyone-pin
        resp = self.pin(skill_obj=s)                                # pinning again returns the everyone-pin
        self.assertEqual((resp.status_code, resp.data["scope"]), (200, "everyone"))

    def test_remove_own_pin_but_not_someone_elses(self):
        pin_id = self.pin().data["id"]
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 404)
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 204)
        self.assertEqual(self.client.delete(f"{PINS}{pin_id}/").status_code, 404)

    def test_profile_pin_is_untouched(self):
        self.mine.pinned_to_users.add(self.alice)
        self.assertEqual(self.listing().data["results"], [])


class SummaryTests(SimpleTestCase):
    def test_free_text_and_contact_fields_are_sized_not_stored(self):
        out = sc.summarize_args({"content": "Call Dana about the secret renewal terms", "email": "dana@example.com a@b.co",
                                 "task_details": "x" * 50, "account_name": "Acme Corp", "limit": 5})
        self.assertEqual(out["content"], "<40 characters>")
        self.assertTrue(out["email"].startswith("<") and "dana" not in out["email"])
        self.assertEqual(out["account_name"], "Acme Corp")        # an account name is not private
        self.assertEqual(out["limit"], 5)

    def test_short_private_values_and_long_plain_ones(self):
        self.assertEqual(sc.summarize_args({"note": "hi"})["note"], "hi")
        self.assertTrue(sc.summarize_args({"query": "q" * 200})["query"].endswith("…"))

    def test_containers_and_junk(self):
        out = sc.summarize_args({"ids": [1, 2, 3], "one": [1], "nested": {"a": 1}, "obj": object()})
        self.assertEqual((out["ids"], out["one"], out["nested"], out["obj"]), ("[3 items]", "[1 item]", "{…}", "object"))
        self.assertEqual(sc.summarize_args("not a dict"), {})
        self.assertEqual(len(sc.summarize_args({str(i): i for i in range(50)})), 20)


class ExtractRecordTests(SimpleTestCase):
    def test_rest_bridge_shape(self):
        r = sc.extract_record("create_reminder", {"status": "created", "reminder": {"id": 7, "title": "Call Dana", "url": "/reminders"}})
        self.assertEqual((r["type"], r["id"], r["label"], r["url"], r["created"]), ("reminder", "7", "Call Dana", "/reminders", True))

    def test_older_top_level_shape_prefers_the_airtable_id(self):
        r = sc.extract_record("create_action_item", {"status": "created", "id": 3, "airtable_id": "recABC", "task": "Send SOW", "url": "/a"})
        self.assertEqual((r["id"], r["label"]), ("recABC", "Send SOW"))

    def test_updates_are_flagged_as_not_created(self):
        r = sc.extract_record("update_account", {"status": "updated", "account": {"id": 2, "company_name": "Acme"}})
        self.assertFalse(r["created"])
        self.assertEqual(r["label"], "Acme")

    def test_reads_errors_and_junk_are_not_records(self):
        for result in ({"status": "ok", "results": []}, {"status": "error", "error_code": "x"}, [], None, "text", {"status": "created"}):
            self.assertIsNone(sc.extract_record("t", result), result)


class RunLifecycleTests(TestCase):
    def setUp(self):
        self.u, self.other = user("runner"), user("someone")
        self.s = skill(self.u)

    def test_create_writes_a_launch_line_and_safe_params(self):
        run = sc.create_run(self.u, self.s, surface="chat", page="calendar", params={"free_text": "secret " * 40, "accounts": 2})
        self.assertEqual((run.skill_name, run.surface, run.page, run.status), ("weekly-update", "chat", "calendar", "launched"))
        self.assertEqual(run.events.get().kind, "launched")
        self.assertEqual(run.params["accounts"], 2)
        self.assertNotIn("secret secret", str(run.params))

    def test_claim_accepts_only_my_recent_unfinished_run(self):
        run = sc.create_run(self.u, self.s, surface="chat")
        self.assertEqual(sc.claim_run(self.u, str(run.pk)), run)
        self.assertIsNone(sc.claim_run(self.other, str(run.pk)))
        for bad in (None, "", "not-a-uuid", 5, "00000000-0000-0000-0000-000000000000"):
            self.assertIsNone(sc.claim_run(self.u, bad), bad)
        SkillRun.objects.filter(pk=run.pk).update(started_at=timezone.now() - timedelta(hours=7))
        self.assertIsNone(sc.claim_run(self.u, str(run.pk)))

    def test_a_finished_run_cannot_be_claimed_again(self):
        run = sc.create_run(self.u, self.s, surface="chat")
        sc.finish_run(run.pk, input_tokens=10, output_tokens=5)
        self.assertIsNone(sc.claim_run(self.u, str(run.pk)))
        run.refresh_from_db()
        self.assertEqual((run.status, run.input_tokens, run.output_tokens), ("completed", 10, 5))
        self.assertIsNotNone(run.finished_at)

    def test_finish_is_idempotent_and_can_mark_failure(self):
        run = sc.create_run(self.u, self.s, surface="chat")
        sc.finish_run(run.pk, failed=True)
        sc.finish_run(run.pk)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertEqual(run.events.filter(kind="finished").count(), 1)

    def test_finish_with_a_bad_id_never_raises(self):
        sc.finish_run("garbage")


class DispatchHookTests(TestCase):
    """MCPServer.dispatch writes a Console line only while a skill run is active."""

    def setUp(self):
        self.u = user("hooker")
        self.run = sc.create_run(self.u, skill(self.u), surface="chat")

    def call(self, result, tool="create_reminder", run_id="UNSET", **kw):
        rid = str(self.run.pk) if run_id == "UNSET" else run_id

        async def go():
            token = active_skill_run.set(rid)
            try:
                with patch.object(type(mcp_server), "_dispatch", AsyncMock(return_value=result)):
                    return await mcp_server.dispatch(tool, {"title": "Call Dana back about renewal", "limit": 3}, user=self.u, **kw)
            finally:
                active_skill_run.reset(token)

        return async_to_sync(go)()

    def events(self):
        return list(self.run.events.filter(kind="tool"))

    def test_the_result_is_returned_unchanged(self):
        result = {"status": "created", "reminder": {"id": 1, "title": "x"}}
        self.assertIs(self.call(result), result)

    def test_a_created_record_is_logged_with_its_link_and_counted(self):
        self.call({"status": "created", "reminder": {"id": 9, "title": "Call Dana", "url": "/reminders"}})
        ev = self.events()[0]
        self.assertEqual((ev.tool_name, ev.status, ev.record_type, ev.record_id, ev.record_label, ev.record_url),
                         ("create_reminder", "created", "reminder", "9", "Call Dana", "/reminders"))
        self.run.refresh_from_db()
        self.assertEqual((self.run.tool_count, self.run.records_created, self.run.records_updated, self.run.status),
                         (1, 1, 0, "running"))

    def test_updates_and_plain_reads(self):
        self.call({"status": "updated", "account": {"id": 2, "company_name": "Acme"}}, tool="update_account")
        self.call({"status": "ok", "results": [1, 2]}, tool="search_records")
        self.run.refresh_from_db()
        self.assertEqual((self.run.tool_count, self.run.records_created, self.run.records_updated), (2, 0, 1))
        self.assertEqual([e.status for e in self.events()], ["updated", "ok"])

    def test_arguments_are_stored_summarised_not_verbatim(self):
        self.call({"status": "ok"})
        args = self.events()[0].args
        self.assertEqual(args["limit"], 3)
        self.assertEqual(args["title"], "Call Dana back about renewal")      # titles are fine; free text is not
        self.call({"status": "ok"}, tool="add_account_note")                  # same args, still safe

    def test_policy_refusals_are_logged_as_errors(self):
        self.call({"status": "error", "error_code": "rate_limited", "message": "Slow down."})
        ev = self.events()[0]
        self.assertEqual((ev.status, ev.error_code, ev.summary), ("error", "rate_limited", "Slow down."))

    def test_an_approval_prompt_is_not_something_the_skill_did(self):
        self.call({"status": "error", "error_code": "confirmation_required", "message": "Confirm?"})
        self.assertEqual(self.events(), [])

    def test_without_a_run_the_console_is_not_even_consulted(self):
        before = SkillRunEvent.objects.count()
        with patch("skills.skill_console.record_tool_event", new=AsyncMock()) as rec:
            self.call({"status": "created", "reminder": {"id": 1}}, run_id=None)
        rec.assert_not_awaited()                   # ordinary chat pays nothing for the Console
        self.assertEqual(SkillRunEvent.objects.count(), before)

    def test_a_failing_console_never_breaks_the_tool(self):
        result = {"status": "ok"}
        with patch("skills.skill_console._record_sync", side_effect=RuntimeError("db down")):
            self.assertIs(self.call(result), result)

    def test_an_unknown_run_id_is_ignored(self):
        before = SkillRunEvent.objects.count()
        self.call({"status": "ok"}, run_id="00000000-0000-0000-0000-000000000000")
        self.assertEqual(SkillRunEvent.objects.count(), before)

    def test_a_run_stops_logging_at_the_event_cap(self):
        SkillRun.objects.filter(pk=self.run.pk).update(tool_count=sc.MAX_EVENTS_PER_RUN)
        self.call({"status": "ok"})
        self.assertEqual(self.events(), [])

    def test_the_real_dispatch_path_is_covered_too_refusals_included(self):
        async def go():
            token = active_skill_run.set(str(self.run.pk))
            try:
                return await mcp_server.dispatch("no_such_tool", {}, user=self.u)
            finally:
                active_skill_run.reset(token)

        out = async_to_sync(go)()
        self.assertEqual(out["error_code"], "unknown_tool")
        self.assertEqual(self.events()[0].error_code, "unknown_tool")


class OrchestratorContextTests(SimpleTestCase):
    def test_dispatch_in_scope_sets_the_run_for_the_tool_and_resets_after(self):
        from agents.agent import AgentOrchestrator

        seen = []

        async def fake_dispatch(name, arguments, user=None, **kw):
            seen.append(active_skill_run.get())
            return {"status": "ok"}

        async def go():
            orch = AgentOrchestrator(client=SimpleNamespace())
            orch.skill_run_id = "run-123"
            with patch.object(mcp_server, "dispatch", fake_dispatch):
                await orch._dispatch_in_scope("search_records", {}, SimpleNamespace(pk=1))
            return active_skill_run.get()

        after = asyncio.run(go())
        self.assertEqual(seen, ["run-123"])
        self.assertIsNone(after)


class FakeOrch:
    """Stands in for AgentOrchestrator and records how it was called."""

    calls: list = []
    items: list = []
    raises: Exception | None = None

    def __init__(self, *a, **kw):
        self.model = "test"

    async def run(self, user_message, history, user=None, **kw):
        type(self).calls.append(kw)
        for item in type(self).items:
            yield item
        if type(self).raises:
            raise type(self).raises


class ChatAttributionTests(APITestCase):
    def setUp(self):
        self.u, self.other = user("chatty"), user("nosy")
        self.s = skill(self.u)
        self.client.force_authenticate(self.u)
        FakeOrch.calls, FakeOrch.items, FakeOrch.raises = [], ["Done.", _usage(input_tokens=30, output_tokens=12)], None

    def send(self, **body):
        with patch("agents.views.AgentOrchestrator", FakeOrch):
            resp = self.client.post(SEND_URL, {"message": "/weekly-update go", **body}, format="json")
            _consume(resp)
        return resp

    def test_my_run_is_attached_and_closed_with_the_turns_tokens(self):
        run = sc.create_run(self.u, self.s, surface="chat")
        self.send(skill_run_id=str(run.pk))
        self.assertEqual(FakeOrch.calls[0], {"skill_run_id": str(run.pk)})
        run.refresh_from_db()
        self.assertEqual((run.status, run.input_tokens, run.output_tokens), ("completed", 30, 12))

    def test_someone_elses_run_is_ignored_and_untouched(self):
        run = sc.create_run(self.other, skill(self.other, name="theirs"), surface="chat")
        self.send(skill_run_id=str(run.pk))
        self.assertEqual(FakeOrch.calls[0], {})
        run.refresh_from_db()
        self.assertEqual(run.status, "launched")

    def test_ordinary_chat_is_unchanged(self):
        self.send()
        self.assertEqual(FakeOrch.calls[0], {})
        self.send(skill_run_id="")
        self.send(skill_run_id=None)
        self.send(skill_run_id="garbage")
        self.assertEqual(FakeOrch.calls, [{}, {}, {}, {}])
        self.assertFalse(SkillRun.objects.exists())

    def test_a_failed_turn_marks_the_run_failed(self):
        run = sc.create_run(self.u, self.s, surface="chat")
        FakeOrch.raises = RuntimeError("model fell over")
        self.send(skill_run_id=str(run.pk))
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")

    def test_a_finished_run_is_not_reused_by_a_second_message(self):
        run = sc.create_run(self.u, self.s, surface="chat")
        self.send(skill_run_id=str(run.pk))
        self.send(skill_run_id=str(run.pk))
        self.assertEqual(FakeOrch.calls, [{"skill_run_id": str(run.pk)}, {}])


class LaunchEndpointTests(APITestCase):
    def setUp(self):
        self.u = user("launcher")
        self.s = skill(self.u)
        self.client.force_authenticate(self.u)

    def test_run_opens_a_console_run_and_returns_its_id(self):
        r = self.client.post(f"/api/v1/skills/agent-skills/{self.s.pk}/run/", {"page": "calendar", "free_text": "go"}, format="json")
        self.assertEqual(r.status_code, 200)
        run = SkillRun.objects.get(pk=r.data["run_id"])
        self.assertEqual((run.user, run.surface, run.page, run.skill), (self.u, "chat", "calendar", self.s))
        self.assertIn("prompt", r.data)                         # the old response shape is a subset

    def test_voice_start_carries_the_run_into_the_launch_context(self):
        from skills.voice_launch import consume_launch_context

        r = self.client.post(f"/api/v1/skills/agent-skills/{self.s.pk}/voice-start/", {}, format="json")
        run = SkillRun.objects.get(pk=r.data["run_id"])
        self.assertEqual(run.surface, "voice")
        self.assertEqual(consume_launch_context(self.u, r.data["key"])["run_id"], str(run.pk))

    def test_a_failed_launch_opens_no_run(self):
        draft = skill(self.u, name="draft-one", status="draft")
        self.client.post(f"/api/v1/skills/agent-skills/{draft.pk}/run/", {}, format="json")
        self.assertFalse(SkillRun.objects.exists())

    def test_a_console_failure_does_not_fail_the_launch(self):
        with patch("skills.skill_console.create_run", side_effect=RuntimeError("db")):
            r = self.client.post(f"/api/v1/skills/agent-skills/{self.s.pk}/run/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data["run_id"])


class VoiceRunTests(TestCase):
    def test_the_agent_picks_up_the_run_and_confirmed_actions_are_attributed(self):
        from realtime.voice_agent import VoiceAgent, dispatch_confirmed

        u = user("caller")
        agent = VoiceAgent(user=u, client=object(), active_workflow={"skill_name": "x", "script": "S", "allowed_tools": [], "run_id": "r-1"})
        self.assertEqual(agent.skill_run_id, "r-1")
        self.assertIsNone(VoiceAgent(user=u, client=object()).skill_run_id)

        seen = []

        async def fake(name, args, user=None, confirmed=False):
            seen.append(active_skill_run.get())
            return {"status": "ok"}

        async def go():
            with patch.object(mcp_server, "dispatch", fake):
                await dispatch_confirmed("send_sms", {}, u, skill_run_id="r-2")
                await dispatch_confirmed("send_sms", {}, u)
            return active_skill_run.get()

        after = asyncio.run(go())
        self.assertEqual(seen, ["r-2", None])
        self.assertIsNone(after)

    def test_the_call_closes_its_run_with_the_tokens_the_call_used(self):
        from realtime.consumers import _finish_console_run

        u = user("caller2")
        run = sc.create_run(u, skill(u), surface="voice")
        sess = AgentSession.objects.create(user=u, title="Voice")
        AgentMessage.objects.create(session=sess, role="assistant", content="a", input_tokens=100, output_tokens=20)
        AgentMessage.objects.create(session=sess, role="assistant", content="b", input_tokens=50, output_tokens=5)
        AgentMessage.objects.create(session=sess, role="user", content="c", input_tokens=999, output_tokens=999)
        _finish_console_run(str(run.pk), sess.pk)
        run.refresh_from_db()
        self.assertEqual((run.status, run.input_tokens, run.output_tokens), ("completed", 150, 25))


class ConsoleApiTests(APITestCase):
    def setUp(self):
        self.a, self.b, self.admin = user("a1"), user("b1"), user("boss2", staff=True)
        self.run_a = sc.create_run(self.a, skill(self.a, name="a-skill"), surface="chat")
        self.run_b = sc.create_run(self.b, skill(self.b, name="b-skill"), surface="chat")
        self.client.force_authenticate(self.a)

    def ids(self, **params):
        return {r["id"] for r in self.client.get(RUNS, params).data["results"]}

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(RUNS).status_code, 401)
        self.assertEqual(self.client.get(f"{RUNS}{self.run_a.pk}/").status_code, 401)

    def test_a_user_sees_only_their_own_runs_and_scope_all_does_not_widen_it(self):
        self.assertEqual(self.ids(), {str(self.run_a.pk)})
        self.assertEqual(self.ids(scope="all"), {str(self.run_a.pk)})

    def test_an_admin_can_opt_in_to_everyones(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.ids(), set())
        self.assertEqual(self.ids(scope="all"), {str(self.run_a.pk), str(self.run_b.pk)})
        row = next(r for r in self.client.get(RUNS, {"scope": "all"}).data["results"] if r["id"] == str(self.run_b.pk))
        self.assertEqual(row["user_username"], "b1")

    def test_detail_includes_the_timeline_and_is_owner_scoped(self):
        SkillRunEvent.objects.create(run=self.run_a, kind="tool", tool_name="create_reminder", status="created",
                                     record_type="reminder", record_id="4", record_label="Call Dana", record_url="/reminders")
        r = self.client.get(f"{RUNS}{self.run_a.pk}/")
        self.assertEqual([e["kind"] for e in r.data["events"]], ["launched", "tool"])
        self.assertEqual(r.data["events"][1]["record"], {"type": "reminder", "id": "4", "label": "Call Dana", "url": "/reminders"})
        self.assertIsNone(r.data["events"][0]["record"])
        self.assertEqual(self.client.get(f"{RUNS}{self.run_b.pk}/").status_code, 404)

    def test_the_list_is_newest_first_and_can_filter_by_skill(self):
        newer = sc.create_run(self.a, self.run_a.skill, surface="voice")
        rows = self.client.get(RUNS).data["results"]
        self.assertEqual(rows[0]["id"], str(newer.pk))
        other_skill = skill(self.a, name="second-skill")
        sc.create_run(self.a, other_skill, surface="chat")
        self.assertEqual(len(self.client.get(RUNS, {"skill": self.run_a.skill_id}).data["results"]), 2)

    def test_runs_survive_deleting_their_skill(self):
        self.run_a.skill.delete()
        row = self.client.get(RUNS).data["results"][0]
        self.assertIsNone(row["skill"])
        self.assertEqual(row["skill_name"], "a-skill")
