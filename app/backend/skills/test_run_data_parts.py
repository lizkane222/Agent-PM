"""
A skill run whose data does not fit in one chat message: the data is staged on the run and the agent
reads it a part at a time (`get_skill_run_data`). Nothing is lost, nothing leaks to another user.
"""

import uuid

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from agents.mcp_server import mcp_server
from agents.serializers import AgentMessageInputSerializer
from skills import run_assembly as ra
from skills.models import AgentSkill, AgentSkillAttachment, SkillRun

User = get_user_model()
URL = "/api/v1/skills/agent-skills/"
CHAT_LIMIT = AgentMessageInputSerializer().fields["message"].max_length


def make_skill(owner, doc_chars=0, **kw):
    s = AgentSkill.objects.create(name="big-recap", description="d", instructions="Summarise the documents.",
                                  status="approved", visibility="private", created_by=owner, **kw)
    if doc_chars:
        AgentSkillAttachment.objects.create(skill=s, name="Big doc", text="".join(
            f"Line {i}: some reference text that pads the document out.\n" for i in range(doc_chars // 60)))
    return s


class SplitTests(SimpleTestCase):
    def test_small_units_share_a_part_in_order(self):
        parts = ra.split_into_parts([("a", "AAA"), ("b", "BBB")])
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0]["text"], "AAA\n\nBBB")
        self.assertEqual(parts[0]["label"], "a; b")

    def test_nothing_is_lost_when_a_unit_is_too_big(self):
        text = "".join(f"row {i}\n" for i in range(5000))
        parts = ra.split_into_parts([("rows", text)])
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(p["text"]) <= ra.PART_CHARS for p in parts))
        self.assertEqual("".join(p["text"] for p in parts), text)

    def test_one_enormous_line_is_cut_hard_and_still_whole(self):
        text = "x" * (ra.PART_CHARS * 2 + 50)
        parts = ra.split_into_parts([("blob", text)])
        self.assertEqual("".join(p["text"] for p in parts), text)
        self.assertTrue(all(len(p["text"]) <= ra.PART_CHARS for p in parts))

    def test_the_number_of_parts_is_capped(self):
        parts = ra.split_into_parts([("big", "y" * (ra.PART_CHARS * (ra.MAX_PARTS + 5)))])
        self.assertEqual(len(parts), ra.MAX_PARTS)

    def test_empty_units_are_skipped(self):
        self.assertEqual(ra.split_into_parts([("a", ""), ("b", "")]), [])


class AssembleTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("rd_owner", password="x")

    def test_a_small_run_stays_inline(self):
        s = make_skill(self.owner, doc_chars=600)
        r = ra.assemble_run(s, self.owner, {}, stage_data=True)
        self.assertEqual(r["data_parts"], [])
        self.assertIn("Line 0:", r["prompt"])

    def test_a_big_run_keeps_its_data_out_of_the_prompt(self):
        s = make_skill(self.owner, doc_chars=30_000)
        r = ra.assemble_run(s, self.owner, {}, stage_data=True)
        self.assertTrue(r["data_parts"])
        self.assertLess(len(r["prompt"]), CHAT_LIMIT)
        self.assertNotIn("Line 0:", r["prompt"])
        self.assertIn("get_skill_run_data", r["prompt"])
        self.assertIn(ra.RUN_ID_TOKEN, r["prompt"])
        self.assertIn(f"{len(r['data_parts'])} part", r["prompt"])
        self.assertIn("Line 0:", r["data_parts"][0]["text"])

    def test_staging_is_opt_in_so_voice_is_unchanged(self):
        s = make_skill(self.owner, doc_chars=30_000)
        r = ra.assemble_run(s, self.owner, {})
        self.assertEqual(r["data_parts"], [])
        self.assertIn("Line 0:", r["prompt"])
        self.assertNotIn(ra.RUN_ID_TOKEN, r["prompt"])


class RunViewTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("rd_run", password="x")
        self.other = User.objects.create_user("rd_other", password="x")
        self.client.force_authenticate(self.owner)

    def run_skill(self, skill):
        return self.client.post(f"{URL}{skill.pk}/run/", {}, format="json")

    def test_the_run_response_fits_the_chat_and_carries_the_real_run_id(self):
        r = self.run_skill(make_skill(self.owner, doc_chars=30_000))
        self.assertEqual(r.status_code, 200, r.data)
        self.assertLess(len(r.data["prompt"]), CHAT_LIMIT)
        self.assertIn(f'run_id="{r.data["run_id"]}"', r.data["prompt"])
        self.assertNotIn(ra.RUN_ID_TOKEN, r.data["prompt"])
        self.assertNotIn("data_parts", r.data)
        self.assertEqual(r.data["data_staged"]["parts"], len(SkillRun.objects.get(pk=r.data["run_id"]).data_parts))

    def test_a_small_run_reports_nothing_staged(self):
        r = self.run_skill(make_skill(self.owner, doc_chars=300))
        self.assertNotIn("data_staged", r.data)
        self.assertEqual(SkillRun.objects.get(pk=r.data["run_id"]).data_parts, [])

    def test_every_character_is_reachable_through_the_parts(self):
        s = make_skill(self.owner, doc_chars=30_000)
        run_id = self.run_skill(s).data["run_id"]
        first = self.client.get(f"/api/v1/skills/runs/{run_id}/data/", {"part": 1}).data
        texts = [first["text"]] + [
            self.client.get(f"/api/v1/skills/runs/{run_id}/data/", {"part": n}).data["text"]
            for n in range(2, first["parts"] + 1)]
        joined = "\n".join(texts)
        for i in (0, 150, 300):   # the existing 20,000-character cap per attachment still applies
            self.assertIn(f"Line {i}:", joined)
        self.assertFalse(first["has_more"] and first["parts"] == 1)

    def test_part_validation(self):
        run_id = self.run_skill(make_skill(self.owner, doc_chars=30_000)).data["run_id"]
        url = f"/api/v1/skills/runs/{run_id}/data/"
        for bad in ("0", "999", "abc", "-1"):
            self.assertEqual(self.client.get(url, {"part": bad}).status_code, 400, bad)
        self.assertEqual(self.client.get(url).data["part"], 1)

    def test_a_run_with_nothing_staged_is_a_404(self):
        run_id = self.run_skill(make_skill(self.owner, doc_chars=100)).data["run_id"]
        self.assertEqual(self.client.get(f"/api/v1/skills/runs/{run_id}/data/").status_code, 404)

    def test_another_users_run_data_is_not_reachable_even_for_an_admin(self):
        run_id = self.run_skill(make_skill(self.owner, doc_chars=30_000)).data["run_id"]
        url = f"/api/v1/skills/runs/{run_id}/data/"
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)
        admin = User.objects.create_user("rd_admin", password="x", is_staff=True)
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.get(url, {"scope": "all"}).status_code, 404)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f"/api/v1/skills/runs/{uuid.uuid4()}/data/").status_code, 401)

    def test_the_prompt_is_pasted_in_full_when_the_data_cannot_be_stored(self):
        from unittest.mock import patch

        s = make_skill(self.owner, doc_chars=30_000)
        with patch("skills.views._stage_run_data", return_value=False):
            r = self.run_skill(s)
        self.assertEqual(r.status_code, 200)
        self.assertIn("Line 0:", r.data["prompt"])
        self.assertNotIn(ra.RUN_ID_TOKEN, r.data["prompt"])
        self.assertNotIn("data_staged", r.data)


class ToolTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("rd_tool", password="x")
        self.other = User.objects.create_user("rd_tool2", password="x")
        self.client.force_authenticate(self.owner)
        self.run_id = self.client.post(
            f"{URL}{make_skill(self.owner, doc_chars=30_000).pk}/run/", {}, format="json").data["run_id"]

    def call(self, args, user=None):
        return async_to_sync(mcp_server.dispatch)("get_skill_run_data", args, user=user or self.owner)

    def test_it_returns_the_part_through_dispatch(self):
        r = self.call({"run_id": self.run_id, "part": 1})
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["part"], 1)
        self.assertIn("Line 0:", r["text"])
        self.assertGreaterEqual(r["parts"], 2)

    def test_part_defaults_to_one(self):
        self.assertEqual(self.call({"run_id": self.run_id})["part"], 1)

    def test_another_users_run_is_refused_without_saying_why(self):
        r = self.call({"run_id": self.run_id, "part": 1}, user=self.other)
        self.assertEqual(r["status"], "error")
        self.assertNotIn("text", r)
        self.assertNotIn("Line 0:", str(r))

    def test_the_schema_refuses_what_it_forbids(self):
        for args in ({"run_id": self.run_id, "part": 0}, {"run_id": self.run_id, "part": 101},
                     {"run_id": self.run_id, "extra": 1}, {}):
            r = self.call(args)
            self.assertEqual(r["status"], "error", args)
            self.assertNotIn("text", r)

    def test_a_malformed_id_cannot_steer_the_path(self):
        for bad in ("../../accounts", "not-a-uuid", f"{self.run_id}/../x"):
            r = self.call({"run_id": bad, "part": 1})
            self.assertEqual(r["status"], "error", bad)

    def test_it_is_allowed_inside_a_saved_skill(self):
        from agents.tool_policy import SKILL_ALWAYS_ALLOWED

        self.assertIn("get_skill_run_data", SKILL_ALWAYS_ALLOWED)


class GenCsatShapeTests(APITestCase):
    """The reported skill: ~5,000 characters of instructions with three lookups per chosen account."""

    def setUp(self):
        from accounts.models import Account
        from team.models import TeamMember

        self.owner = User.objects.create_user("csat_owner", password="x")
        member = TeamMember.objects.create(user=self.owner, full_name="C", email="csat@example.com")
        self.accounts = [Account.objects.create(company_name=f"Customer {i}") for i in range(12)]
        for a in self.accounts:
            a.team_members.add(member)
        self.skill = make_skill(self.owner)
        self.skill.instructions = ("Write the CSAT summary. " * 200)[:4900] + (
            "\n@#--all-meeting-notes-${account_name}-${date_range}"
            "\n@#--all-action-items-${account_name}\n@#--all-artifacts-${account_name}")
        self.skill.context_defaults = {"needs_accounts": True}
        self.skill.save()
        self.client.force_authenticate(self.owner)

    def _fat(self):
        """Every lookup returns a full 40 rows of 1,500 characters, as a busy account would."""
        from unittest.mock import patch

        def expand(user, kw):
            return {"raw": kw["raw"], "ok": True, "label": "Meeting notes", "account": kw.get("account"),
                    "range": None, "total": 40, "rows": [{"note": "n" * 1500} for _ in range(40)]}

        return patch("skills.run_assembly.keywords.expand_keyword", side_effect=expand)

    def test_many_accounts_never_make_a_prompt_the_chat_would_refuse(self):
        with self._fat():
            self._many()

    def _many(self):
        r = self.client.post(f"{URL}{self.skill.pk}/run/", {"account_ids": [a.pk for a in self.accounts]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertLess(len(r.data["prompt"]), CHAT_LIMIT)
        # the worst case overruns the part cap, and the runner is told rather than left to wonder
        self.assertEqual(r.data["warnings"], ["The looked-up data was longer than the limit, so the end of it was left out."])
        self.assertGreater(r.data["data_staged"]["parts"], 8)
        self.assertLessEqual(r.data["data_staged"]["characters"], ra.PART_CHARS * ra.MAX_PARTS)

    def test_the_part_index_stays_short_however_many_parts_there_are(self):
        # the index in the prompt lists at most INDEX_PARTS_SHOWN parts plus one summary line
        with self._fat():
            r = self.client.post(f"{URL}{self.skill.pk}/run/", {"account_ids": [a.pk for a in self.accounts]}, format="json")
        self.assertGreater(r.data["data_staged"]["parts"], ra.INDEX_PARTS_SHOWN)
        self.assertLessEqual(r.data["prompt"].count("\n  part "), ra.INDEX_PARTS_SHOWN)

    def test_instructions_that_alone_overflow_are_reported_not_hidden(self):
        self.skill.instructions = "x" * 11_000 + "\n@#--all-artifacts-${account_name}"
        self.skill.save()
        r = self.client.post(f"{URL}{self.skill.pk}/run/", {"account_ids": [self.accounts[0].pk]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(any("instructions" in w for w in r.data["warnings"]), r.data["warnings"])
