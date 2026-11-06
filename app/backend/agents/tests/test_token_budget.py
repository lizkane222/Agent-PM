"""Daily token budgets: conversion, limits, enforcement on chat/voice/skills, admin API."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from agents import token_budget as tb
from agents.models import AgentMessage, AgentSession, RoleTokenDefault, TokenAlert, TokenPricing, UserTokenBudget
from agents.tests.test_views import SEND_URL, _consume, _fake_orchestrator, _usage
from skills.models import AgentSkill
from team.models import Notification, UserProfile

User = get_user_model()
BASE = "/api/v1/agents/token-budgets/"


def make_user(name, *, staff=False, title="", tz="UTC"):
    u = User.objects.create_user(name, f"{name}@example.com", "pw", is_staff=staff)
    UserProfile.objects.update_or_create(user=u, defaults={"title": title, "timezone": tz})
    return u


def spend(user, input_tokens, output_tokens=0, when=None):
    s = AgentSession.objects.filter(user=user).first() or AgentSession.objects.create(user=user, title="t")
    m = AgentMessage.objects.create(session=s, role="assistant", content="x",
                                    input_tokens=input_tokens, output_tokens=output_tokens)
    if when is not None:
        AgentMessage.objects.filter(pk=m.pk).update(created_at=when)
    return m


class TitleRoleParityTests(TestCase):
    """Mirrors getTitleRole in twilio-agent-pm-shared; same cases, same specificity order."""

    CASES = {
        "Senior Solutions Architect": "SA", "SA, Segment": "SA",
        "Technical Account Manager": "TAM", "Customer Success Manager": "CSM",
        "Program Manager": "PgM", "Project Manager": "PgM", "Product Manager": "PM",
        "Engineering Manager": "MA", "Account Executive": "AE", "Software Engineer": "ENG",
        "Designer": "other", "": "other", None: "other",
    }

    def test_cases(self):
        for title, role in self.CASES.items():
            self.assertEqual(tb.title_role(title), role, title)

    def test_user_without_profile_is_other(self):
        self.assertEqual(tb.role_of(User.objects.create_user("noprofile", password="x")), "other")


class ConversionTests(TestCase):
    def setUp(self):
        self.p = tb.get_pricing()   # defaults: $3 in, $15 out, 20% output

    def test_blended_rate_is_defined_by_the_output_share(self):
        self.assertEqual(tb.blended_usd_per_million(self.p), Decimal("5.4000"))   # 3*0.8 + 15*0.2

    def test_tokens_to_dollars_and_back(self):
        self.assertEqual(tb.tokens_to_usd(1_000_000, self.p), Decimal("5.4000"))
        self.assertEqual(tb.tokens_to_usd(20_000, self.p), Decimal("0.1080"))
        self.assertEqual(tb.usd_to_tokens("0.108", self.p), 20_000)
        self.assertEqual(tb.usd_to_tokens(5.4, self.p), 1_000_000)

    def test_actual_usage_is_priced_exactly_not_blended(self):
        self.assertEqual(tb.usage_usd(1_000_000, 0, self.p), Decimal("3.0000"))
        self.assertEqual(tb.usage_usd(0, 1_000_000, self.p), Decimal("15.0000"))
        self.assertEqual(tb.usage_usd(500_000, 100_000, self.p), Decimal("3.0000"))

    def test_changing_the_rate_changes_the_conversion(self):
        self.p.input_usd_per_million = Decimal("10")
        self.p.save()
        self.assertEqual(tb.blended_usd_per_million(tb.get_pricing()), Decimal("11.0000"))

    def test_zero_rate_cannot_convert_dollars(self):
        self.p.input_usd_per_million = Decimal("0")
        self.p.output_usd_per_million = Decimal("0")
        with self.assertRaises(ValueError):
            tb.usd_to_tokens(1, self.p)


class StatusTests(TestCase):
    def setUp(self):
        self.u = make_user("budgeted", title="Solutions Architect")

    def test_nothing_is_limited_until_an_admin_sets_a_number(self):
        spend(self.u, 5_000_000)
        st = tb.status_for(self.u)
        self.assertEqual((st.state, st.warn, st.block), ("ok", None, None))

    def test_role_default_applies(self):
        RoleTokenDefault.objects.create(role="SA", warn_tokens=1000, block_tokens=2000)
        spend(self.u, 900)
        self.assertEqual(tb.status_for(self.u).state, "ok")
        spend(self.u, 100)
        self.assertEqual(tb.status_for(self.u).state, "warn")
        spend(self.u, 1000)
        st = tb.status_for(self.u)
        self.assertEqual((st.state, st.reason), ("blocked", "block_limit"))

    def test_a_different_roles_default_does_not_apply(self):
        RoleTokenDefault.objects.create(role="CSM", warn_tokens=10, block_tokens=20)
        spend(self.u, 500)
        self.assertEqual(tb.status_for(self.u).state, "ok")

    def test_user_override_beats_role_but_blank_falls_back_to_role(self):
        RoleTokenDefault.objects.create(role="SA", warn_tokens=1000, block_tokens=2000)
        UserTokenBudget.objects.create(user=self.u, warn_tokens=50)       # block left blank
        b = tb.effective_budget(self.u)
        self.assertEqual((b.warn, b.warn_source, b.block, b.block_source), (50, "user", 2000, "role"))

    def test_restricting_turns_the_warn_limit_into_a_block(self):
        RoleTokenDefault.objects.create(role="SA", warn_tokens=1000, block_tokens=9000)
        UserTokenBudget.objects.create(user=self.u, block_at_warn=True)
        spend(self.u, 1000)
        st = tb.status_for(self.u)
        self.assertEqual((st.state, st.reason), ("blocked", "warn_limit_restricted"))
        self.assertIn("an admin has set it to stop", tb.blocked_message(st))

    def test_only_the_users_own_assistant_turns_today_count(self):
        RoleTokenDefault.objects.create(role="SA", warn_tokens=100, block_tokens=200)
        other = make_user("other")
        spend(other, 10_000)
        s = AgentSession.objects.create(user=self.u, title="t")
        AgentMessage.objects.create(session=s, role="user", content="q", input_tokens=10_000, output_tokens=0)
        self.assertEqual(tb.status_for(self.u).used, 0)

    def test_the_day_is_the_users_own_local_day(self):
        la = make_user("la", title="Solutions Architect", tz="America/Los_Angeles")
        RoleTokenDefault.objects.create(role="SA", warn_tokens=100, block_tokens=200)
        start, _ = tb.day_bounds(la, tb.local_today(la))
        spend(la, 500, when=start - timedelta(minutes=1))   # last minute of yesterday, local
        self.assertEqual(tb.status_for(la).used, 0)
        spend(la, 40, when=start + timedelta(minutes=1))
        self.assertEqual(tb.status_for(la).used, 40)

    def test_extra_tokens_counts_a_turn_still_in_flight(self):
        RoleTokenDefault.objects.create(role="SA", warn_tokens=100, block_tokens=1000)
        self.assertEqual(tb.status_for(self.u, extra_tokens=150).state, "warn")


class AlertTests(TestCase):
    def setUp(self):
        self.admin = make_user("boss", staff=True)
        self.u = make_user("hitter", title="Solutions Architect")
        RoleTokenDefault.objects.create(role="SA", warn_tokens=100, block_tokens=200)

    def test_warn_notifies_admins_and_the_user_once_per_day(self):
        spend(self.u, 150)
        for _ in range(3):
            tb.note_state(self.u, tb.status_for(self.u))
        self.assertEqual(TokenAlert.objects.filter(user=self.u, level="warn").count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.admin, kind="token_budget").count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.u, kind="token_budget").count(), 1)

    def test_an_ok_state_records_nothing(self):
        tb.note_state(self.u, tb.status_for(self.u))
        self.assertFalse(TokenAlert.objects.exists())

    def test_block_is_its_own_alert_with_its_own_notification(self):
        spend(self.u, 150)
        tb.note_state(self.u, tb.status_for(self.u))
        spend(self.u, 100)
        tb.note_state(self.u, tb.status_for(self.u))
        self.assertEqual(set(TokenAlert.objects.values_list("level", flat=True)), {"warn", "block"})
        self.assertEqual(Notification.objects.filter(user=self.admin, kind="token_budget").count(), 2)

    def test_a_user_is_not_notified_as_their_own_admin_twice(self):
        spend(self.admin, 150)
        RoleTokenDefault.objects.create(role="other", warn_tokens=100, block_tokens=200)
        tb.note_state(self.admin, tb.status_for(self.admin))
        self.assertEqual(Notification.objects.filter(user=self.admin, kind="token_budget").count(), 1)


class ChatEnforcementTests(APITestCase):
    def setUp(self):
        self.u = make_user("chatter", title="Solutions Architect")
        self.client.force_authenticate(self.u)
        RoleTokenDefault.objects.create(role="SA", warn_tokens=100, block_tokens=200)

    def test_blocked_user_is_refused_before_anything_is_created(self):
        spend(self.u, 250)
        sessions, msgs = AgentSession.objects.count(), AgentMessage.objects.count()
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=["hi"])) as orch:
            resp = self.client.post(SEND_URL, {"message": "hello"}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "token_budget_blocked")
        self.assertIn("daily token limit", resp.data["detail"])
        self.assertEqual((AgentSession.objects.count(), AgentMessage.objects.count()), (sessions, msgs))
        self.assertTrue(TokenAlert.objects.filter(user=self.u, level="block").exists())

    def test_user_under_the_limit_streams_normally_with_an_ok_budget(self):
        items = ["Hello", _usage(input_tokens=10, output_tokens=5)]
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=items)):
            body = _consume(self.client.post(SEND_URL, {"message": "hi"}, format="json")).decode()
        self.assertIn('"budget": {"state": "ok"', body)

    def test_the_turn_that_crosses_the_warn_line_says_so_and_is_not_cut_off(self):
        spend(self.u, 90)
        items = ["Full answer", _usage(input_tokens=30, output_tokens=10)]
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=items)):
            body = _consume(self.client.post(SEND_URL, {"message": "hi"}, format="json")).decode()
        self.assertIn("Full answer", body)
        self.assertIn('"state": "warn"', body)
        self.assertTrue(TokenAlert.objects.filter(user=self.u, level="warn").exists())
        self.assertTrue(AgentMessage.objects.filter(role="assistant", content="Full answer").exists())

    def test_warn_state_does_not_block_the_next_message(self):
        spend(self.u, 120)
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=["ok", _usage()])):
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            _consume(resp)
        self.assertEqual(resp.status_code, 200)

    def test_restricted_user_is_blocked_at_the_warn_limit(self):
        UserTokenBudget.objects.create(user=self.u, block_at_warn=True)
        spend(self.u, 120)
        resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["budget"]["reason"], "warn_limit_restricted")

    def test_someone_elses_usage_does_not_block_me(self):
        spend(make_user("heavy", title="Solutions Architect"), 10_000)
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=["ok", _usage()])):
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            _consume(resp)
        self.assertEqual(resp.status_code, 200)


class SkillLaunchEnforcementTests(APITestCase):
    def setUp(self):
        self.u = make_user("launcher", title="Solutions Architect")
        self.client.force_authenticate(self.u)
        RoleTokenDefault.objects.create(role="SA", warn_tokens=100, block_tokens=200)
        self.skill = AgentSkill.objects.create(name="s", description="d", instructions="i",
                                               status="approved", created_by=self.u)

    def test_run_and_voice_start_refuse_when_blocked(self):
        spend(self.u, 500)
        for path in ("run", "voice-start"):
            r = self.client.post(f"/api/v1/skills/agent-skills/{self.skill.pk}/{path}/", {}, format="json")
            self.assertEqual(r.status_code, 403, path)
            self.assertEqual(r.data["code"], "token_budget_blocked")

    def test_run_works_under_the_limit(self):
        r = self.client.post(f"/api/v1/skills/agent-skills/{self.skill.pk}/run/", {}, format="json")
        self.assertEqual(r.status_code, 200)


class AdminApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin1", staff=True)
        self.basic = make_user("basic1", title="Customer Success Manager")
        self.client.force_authenticate(self.admin)

    def test_every_route_is_closed_to_anonymous_and_to_non_admins(self):
        routes = [("get", BASE), ("put", BASE + "pricing/"), ("put", BASE + "roles/SA/"),
                  ("put", f"{BASE}users/{self.basic.pk}/"), ("delete", f"{BASE}users/{self.basic.pk}/")]
        self.client.force_authenticate(None)
        for verb, url in routes:
            self.assertEqual(getattr(self.client, verb)(url, {}, format="json").status_code, 401, url)
        self.client.force_authenticate(self.basic)
        for verb, url in routes:
            self.assertEqual(getattr(self.client, verb)(url, {}, format="json").status_code, 403, url)

    def test_overview_lists_every_role_and_user_with_both_units(self):
        r = self.client.get(BASE)
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x["role"] for x in r.data["roles"]], tb.ROLE_ORDER)
        self.assertEqual(r.data["period"], "daily")
        self.assertEqual(r.data["pricing"]["blended_usd_per_million"], "5.4000")
        row = next(u for u in r.data["users"] if u["username"] == "basic1")
        self.assertEqual(row["role"], "CSM")
        self.assertEqual(row["warn"], {"tokens": None, "usd": None})

    def test_role_default_can_be_set_in_tokens_and_reports_dollars(self):
        r = self.client.put(BASE + "roles/SA/", {"warn_tokens": 20_000, "block_tokens": 100_000}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["warn"], {"tokens": 20_000, "usd": "0.1080"})
        self.assertEqual(r.data["block"]["usd"], "0.5400")

    def test_role_default_can_be_set_in_dollars_and_is_stored_as_tokens(self):
        r = self.client.put(BASE + "roles/SA/", {"warn_usd": "0.108", "block_usd": 0.54}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(RoleTokenDefault.objects.get(role="SA").warn_tokens, 20_000)
        self.assertEqual(RoleTokenDefault.objects.get(role="SA").block_tokens, 100_000)

    def test_dollars_convert_at_the_rate_in_force_when_typed(self):
        self.client.put(BASE + "pricing/", {"input_usd_per_million": "10", "output_usd_per_million": "10"}, format="json")
        self.client.put(BASE + "roles/SA/", {"warn_usd": "1"}, format="json")
        self.assertEqual(RoleTokenDefault.objects.get(role="SA").warn_tokens, 100_000)

    def test_bad_input_is_refused(self):
        cases = [
            {"warn_tokens": 5, "warn_usd": 1},            # both units
            {"warn_tokens": -1},
            {"warn_tokens": 1.5},
            {"warn_tokens": "abc"},
            {"warn_usd": "abc"},
            {"warn_tokens": True},
            {"warn_tokens": 10**12},
            {"warn_tokens": 500, "block_tokens": 100},     # warn above block
        ]
        for body in cases:
            self.assertEqual(self.client.put(BASE + "roles/SA/", body, format="json").status_code, 400, body)
        self.assertFalse(RoleTokenDefault.objects.filter(warn_tokens__isnull=False).exists())

    def test_null_clears_a_limit_and_unknown_role_is_404(self):
        self.client.put(BASE + "roles/SA/", {"warn_tokens": 5}, format="json")
        self.client.put(BASE + "roles/SA/", {"warn_tokens": None}, format="json")
        self.assertIsNone(RoleTokenDefault.objects.get(role="SA").warn_tokens)
        self.assertEqual(self.client.put(BASE + "roles/NOPE/", {}, format="json").status_code, 404)

    def test_user_override_restrict_and_clear(self):
        self.client.put(BASE + "roles/CSM/", {"warn_tokens": 1000, "block_tokens": 5000}, format="json")
        r = self.client.put(f"{BASE}users/{self.basic.pk}/", {"warn_tokens": 400, "block_at_warn": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["warn"]["tokens"], r.data["warn_source"], r.data["block"]["tokens"],
                          r.data["block_source"], r.data["block_at_warn"]), (400, "user", 5000, "role", True))
        self.assertEqual(self.client.delete(f"{BASE}users/{self.basic.pk}/").status_code, 204)
        self.assertEqual(tb.effective_budget(self.basic).warn, 1000)
        self.assertFalse(tb.effective_budget(self.basic).block_at_warn)

    def test_user_override_cannot_invert_against_the_role_default(self):
        self.client.put(BASE + "roles/CSM/", {"warn_tokens": 1000, "block_tokens": 5000}, format="json")
        r = self.client.put(f"{BASE}users/{self.basic.pk}/", {"warn_tokens": 9000}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_block_at_warn_must_be_a_boolean(self):
        r = self.client.put(f"{BASE}users/{self.basic.pk}/", {"block_at_warn": "yes"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_consistently_hit_is_visible_to_the_admin(self):
        today = tb.local_today(self.basic)
        for i in range(3):
            TokenAlert.objects.create(user=self.basic, day=today - timedelta(days=i), level="warn")
        TokenAlert.objects.create(user=self.basic, day=today, level="block")
        TokenAlert.objects.create(user=self.basic, day=today - timedelta(days=30), level="warn")  # outside window
        row = next(u for u in self.client.get(BASE).data["users"] if u["username"] == "basic1")
        self.assertEqual((row["days_at_limit_14"], row["days_blocked_14"]), (3, 1))

    def test_pricing_validation(self):
        self.assertEqual(self.client.put(BASE + "pricing/", {"output_share": "1.5"}, format="json").status_code, 400)
        self.assertEqual(self.client.put(BASE + "pricing/", {"input_usd_per_million": "-1"}, format="json").status_code, 400)
        self.assertEqual(self.client.put(BASE + "pricing/", {"input_usd_per_million": "x"}, format="json").status_code, 400)
        zero = {"input_usd_per_million": "0", "output_usd_per_million": "0"}
        self.assertEqual(self.client.put(BASE + "pricing/", zero, format="json").status_code, 400)
        self.assertEqual(TokenPricing.objects.get(pk=1).input_usd_per_million, Decimal("3"))

    def test_me_shows_only_my_own_state(self):
        RoleTokenDefault.objects.create(role="CSM", warn_tokens=100, block_tokens=200)
        spend(self.basic, 150)
        spend(self.admin, 99_999)
        self.client.force_authenticate(self.basic)
        r = self.client.get(BASE + "me/")
        self.assertEqual((r.status_code, r.data["state"], r.data["used"]), (200, "warn", 150))
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(BASE + "me/").status_code, 401)


class FailOpenTests(APITestCase):
    """A broken budget check must not take chat down; it must be loud in the log."""

    def setUp(self):
        self.u = make_user("failopen", title="Solutions Architect")
        self.client.force_authenticate(self.u)

    def test_chat_still_works_and_the_fault_is_logged(self):
        with patch("agents.token_budget.status_for", side_effect=RuntimeError("no such table")), \
             patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=["still here", _usage()])), \
             self.assertLogs("agents.token_budget", level="ERROR") as logs:
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            body = _consume(resp).decode()
        self.assertEqual(resp.status_code, 200)
        self.assertIn("still here", body)
        self.assertIn("Token budget check failed", logs.output[0])

    def test_gate_status_reports_ok_on_failure_but_status_for_still_raises(self):
        with patch("agents.token_budget.effective_budget", side_effect=RuntimeError("boom")):
            with self.assertLogs("agents.token_budget", level="ERROR"):
                self.assertEqual(tb.gate_status(self.u).state, "ok")
            with self.assertRaises(RuntimeError):
                tb.status_for(self.u)
