"""Skill attachments, run assembly, keywords, voice launch context, Slack scaffold."""

from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from accounts.models import Account
from team.models import TeamMember

from . import keywords
from .extract import extract_text
from .models import AgentSkill, AgentSkillAttachment, VoiceLaunchContext
from .voice_launch import consume_launch_context, create_launch_context

User = get_user_model()
URL = "/api/v1/skills/agent-skills/"


def _skill(owner, **kw):
    defaults = dict(name="ctx-skill", description="d", instructions="Summarise.", status="approved",
                    visibility="private", created_by=owner)
    defaults.update(kw)
    return AgentSkill.objects.create(**defaults)


class KeywordParsingTests(TestCase):
    TODAY = date(2026, 10, 19)

    def test_finds_braced_and_bare_arguments(self):
        found = keywords.find_keywords(
            "a @#--all-meeting-notes-${Acme Corp}-${october} b @#--all-action-items-acme")
        self.assertEqual([k["kind"] for k in found], ["all-meeting-notes", "all-action-items"])
        self.assertEqual(found[0]["account"], "Acme Corp")
        self.assertEqual(found[0]["range"], "october")
        self.assertEqual(found[1]["range"], "")

    def test_unknown_kind_is_not_matched(self):
        self.assertEqual(keywords.find_keywords("@#--all-unicorns-${Acme}"), [])

    def test_date_ranges(self):
        p = lambda t: keywords.parse_date_range(t, self.TODAY)  # noqa: E731
        self.assertEqual(p("october"), (date(2026, 10, 1), date(2026, 10, 31)))
        self.assertEqual(p("september"), (date(2026, 9, 1), date(2026, 9, 30)))
        self.assertEqual(p("december"), (date(2025, 12, 1), date(2025, 12, 31)))  # not yet reached this year
        self.assertEqual(p("last-30-days"), (date(2026, 9, 19), self.TODAY))
        self.assertEqual(p("last-month"), (date(2026, 9, 1), date(2026, 9, 30)))
        self.assertEqual(p("this-week"), (date(2026, 10, 19), date(2026, 10, 25)))
        self.assertEqual(p("2026-10-01..2026-10-05"), (date(2026, 10, 1), date(2026, 10, 5)))
        self.assertEqual(p("2026-02"), (date(2026, 2, 1), date(2026, 2, 28)))
        self.assertIsNone(p("whenever"))
        self.assertIsNone(p(""))


class ExtractTextTests(TestCase):
    def test_markdown_and_text(self):
        self.assertEqual(extract_text("a.md", b"# Hi\n* one"), "# Hi\n* one")

    def test_html_is_flattened(self):
        self.assertEqual(extract_text("a.html", b"<script>x</script><p>One</p><p>Two &amp; three</p>"),
                         "One\nTwo & three")

    def test_unknown_type_and_corrupt_files_yield_empty(self):
        self.assertEqual(extract_text("a.bin", b"\x00\x01"), "")
        self.assertEqual(extract_text("a.docx", b"not a zip"), "")
        self.assertEqual(extract_text("a.pdf", b"not a pdf"), "")

    def test_docx_headings_become_markdown(self):
        import io

        import docx

        d = docx.Document()
        d.add_heading("Plan", level=1)
        d.add_paragraph("Body text")
        buf = io.BytesIO()
        d.save(buf)
        text = extract_text("t.docx", buf.getvalue())
        self.assertIn("# Plan", text)
        self.assertIn("Body text", text)


class AttachmentApiTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("att_owner", password="x")
        self.other = User.objects.create_user("att_other", password="x")
        self.skill = _skill(self.owner, visibility="public")
        member = TeamMember.objects.create(user=self.owner, full_name="O", email="o@example.com")
        self.account = Account.objects.create(company_name="Acme Corp")
        self.account.team_members.add(member)
        self.foreign = Account.objects.create(company_name="Hidden Inc")

    def _upload(self, **extra):
        f = SimpleUploadedFile("tmpl.md", b"# Weekly\n* item", content_type="text/markdown")
        return self.client.post(f"{URL}{self.skill.pk}/attachments/", {"file": f, **extra}, format="multipart")

    def test_unauthenticated(self):
        self.assertEqual(self._upload().status_code, 401)

    def test_owner_uploads_and_text_is_extracted(self):
        self.client.force_authenticate(self.owner)
        r = self._upload()
        self.assertEqual(r.status_code, 201, r.content)
        att = AgentSkillAttachment.objects.get()
        self.assertIn("Weekly", att.text)
        self.assertIsNone(att.artifact)

    def test_upload_with_account_files_an_artifact(self):
        self.client.force_authenticate(self.owner)
        r = self._upload(account_id=self.account.pk)
        self.assertEqual(r.status_code, 201, r.content)
        art = AgentSkillAttachment.objects.get().artifact
        self.assertEqual(art.account_id, self.account.pk)
        self.assertEqual(art.artifact_type, "file")

    def test_cannot_file_into_an_account_you_are_not_on(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self._upload(account_id=self.foreign.pk).status_code, 400)
        self.assertFalse(AgentSkillAttachment.objects.exists())

    def test_other_user_cannot_attach_or_remove(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self._upload().status_code, 403)
        att = AgentSkillAttachment.objects.create(skill=self.skill, name="x", text="t")
        self.assertEqual(self.client.delete(f"{URL}{self.skill.pk}/attachments/{att.pk}/").status_code, 403)

    def test_other_user_can_list(self):
        AgentSkillAttachment.objects.create(skill=self.skill, name="x", text="t")
        self.client.force_authenticate(self.other)
        r = self.client.get(f"{URL}{self.skill.pk}/attachments/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)

    def test_link_attachment_and_bad_url(self):
        self.client.force_authenticate(self.owner)
        ok = self.client.post(f"{URL}{self.skill.pk}/attachments/", {"url": "https://x.test/doc", "name": "Doc"}, format="json")
        self.assertEqual(ok.status_code, 201)
        bad = self.client.post(f"{URL}{self.skill.pk}/attachments/", {"url": "javascript:alert(1)"}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_attaching_resets_an_approved_skill_to_draft(self):
        self.client.force_authenticate(self.owner)
        self._upload()
        self.skill.refresh_from_db()
        self.assertEqual(self.skill.status, "draft")

    def test_remove_attachment(self):
        att = AgentSkillAttachment.objects.create(skill=self.skill, name="x", text="t")
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(f"{URL}{self.skill.pk}/attachments/{att.pk}/").status_code, 204)
        self.assertFalse(AgentSkillAttachment.objects.exists())


class RunAssemblyTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("run_owner", password="x")
        self.other = User.objects.create_user("run_other", password="x")
        member = TeamMember.objects.create(user=self.owner, full_name="O", email="ro@example.com")
        self.account = Account.objects.create(company_name="Acme Corp")
        self.account.team_members.add(member)
        self.hidden = Account.objects.create(company_name="Hidden Inc")
        self.client.force_authenticate(self.owner)

    def _run(self, skill, body=None):
        return self.client.post(f"{URL}{skill.pk}/run/", body or {}, format="json")

    def test_plain_run_keeps_prompt_shape(self):
        s = _skill(self.owner)
        r = self._run(s, {"args": {"k": "v"}})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["prompt"].startswith("/ctx-skill"))
        self.assertIn("- k: v", r.data["prompt"])
        self.assertIn("Summarise.", r.data["prompt"])
        self.assertTrue(r.data["script"])

    def test_draft_cannot_run(self):
        self.assertEqual(self._run(_skill(self.owner, status="draft")).status_code, 400)

    def test_accounts_are_checked_against_the_runner(self):
        s = _skill(self.owner)
        r = self._run(s, {"account_ids": [self.account.pk, self.hidden.pk]})
        self.assertIn("Acme Corp", r.data["prompt"])
        self.assertNotIn("Hidden Inc", r.data["prompt"])
        self.assertTrue(any("not on it" in w for w in r.data["warnings"]))

    def test_needs_accounts_is_enforced(self):
        s = _skill(self.owner, context_defaults={"needs_accounts": True})
        self.assertEqual(self._run(s).status_code, 400)
        self.assertEqual(self._run(s, {"account_ids": [self.account.pk]}).status_code, 200)

    def test_free_text_template_chain_and_attachments_are_included(self):
        chained = _skill(self.owner, name="base-skill", instructions="BASE STEPS")
        s = _skill(self.owner, chained_skills=["base-skill", "missing-skill"], twilio_skills=["send-sms"],
                   templates=[{"key": "a", "title": "Weekly", "body_html": "<p>WEEKLY BODY</p>"},
                              {"key": "b", "title": "Plan", "body_html": "<p>PLAN BODY</p>"}])
        AgentSkillAttachment.objects.create(skill=s, name="Ref.md", text="REFERENCE TEXT")
        r = self._run(s, {"free_text": "recent items from acme", "template_key": "b"})
        p = r.data["prompt"]
        self.assertIn("recent items from acme", p)
        self.assertIn("PLAN BODY", p)
        self.assertNotIn("WEEKLY BODY", p)
        self.assertIn("BASE STEPS", p)
        self.assertIn("/send-sms", p)
        self.assertIn("REFERENCE TEXT", p)
        self.assertIn("<data>", p)
        self.assertTrue(any("missing-skill" in w for w in r.data["warnings"]))
        self.assertNotIn("PLAN BODY", self._run(s, {"template_key": "a"}).data["prompt"])
        self.assertEqual(self._run(s, {"template_key": "zzz"}).status_code, 400)

    def test_chained_skill_the_runner_cannot_see_is_skipped(self):
        _skill(self.other, name="secret-skill", instructions="SECRET", visibility="private")
        s = _skill(self.owner, chained_skills=["secret-skill"])
        r = self._run(s)
        self.assertNotIn("SECRET", r.data["prompt"])
        self.assertTrue(r.data["warnings"])

    def test_keywords_expand_through_the_runners_permissions(self):
        s = _skill(self.owner)
        with patch("skills.keywords.expand_keyword", return_value={
                "raw": "@#--all-artifacts-acme", "ok": True, "label": "Artifacts", "account": "Acme Corp",
                "range": None, "total": 1, "rows": [{"name": "Deck"}]}) as m:
            r = self._run(s, {"free_text": "@#--all-artifacts-acme"})
        self.assertEqual(m.call_args[0][0], self.owner)
        self.assertIn("Artifacts for Acme Corp", r.data["prompt"])
        self.assertIn("name: Deck", r.data["prompt"])

    def test_script_is_plain_text(self):
        s = _skill(self.owner, instructions="## Heading\n* **bold** step")
        script = self._run(s).data["script"]
        self.assertNotIn("#", script)
        self.assertNotIn("**", script)


class ResolveKeywordsApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("kw_user", password="x")
        member = TeamMember.objects.create(user=self.user, full_name="K", email="kw@example.com")
        self.account = Account.objects.create(company_name="Acme Corp")
        self.account.team_members.add(member)
        self.hidden = Account.objects.create(company_name="Zeta Holdings")

    def test_catalog(self):
        self.client.force_authenticate(self.user)
        r = self.client.get(f"{URL}resolve-keywords/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("all-meeting-notes" in k["template"] for k in r.data["keywords"]))

    def test_unauthenticated(self):
        self.assertEqual(self.client.post(f"{URL}resolve-keywords/", {"text": "x"}, format="json").status_code, 401)

    def test_account_the_user_is_not_on_does_not_resolve(self):
        self.client.force_authenticate(self.user)
        r = self.client.post(f"{URL}resolve-keywords/", {"text": "@#--all-artifacts-${Zeta Holdings}"}, format="json")
        self.assertFalse(r.data["results"][0]["ok"])

    def test_expands_artifacts_for_own_account(self):
        from accounts.models import AccountArtifact

        AccountArtifact.objects.create(account=self.account, name="Deck", artifact_type="link", url="https://x.test")
        self.client.force_authenticate(self.user)
        r = self.client.post(f"{URL}resolve-keywords/", {"text": "@#--all-artifacts-${Acme Corp}"}, format="json")
        res = r.data["results"][0]
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["rows"][0]["name"], "Deck")

    def test_bad_date_range_reports_error(self):
        self.client.force_authenticate(self.user)
        r = self.client.post(f"{URL}resolve-keywords/", {"text": "@#--all-action-items-${Acme Corp}-${whenever}"}, format="json")
        self.assertFalse(r.data["results"][0]["ok"])


class VoiceStartTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("vs_owner", password="x")
        self.other = User.objects.create_user("vs_other", password="x")
        self.skill = _skill(self.owner, visibility="public", allowed_tools=["search_records"])

    def test_unauthenticated(self):
        self.assertEqual(self.client.post(f"{URL}{self.skill.pk}/voice-start/").status_code, 401)

    def test_returns_key_and_script(self):
        self.client.force_authenticate(self.other)
        r = self.client.post(f"{URL}{self.skill.pk}/voice-start/", {"free_text": "hi"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        row = VoiceLaunchContext.objects.get(key=r.data["key"])
        self.assertEqual(row.user, self.other)
        self.assertIn("ctx-skill", row.payload["script"])

    def test_private_skill_of_someone_else_is_404(self):
        private = _skill(self.owner, name="priv-skill")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f"{URL}{private.pk}/voice-start/").status_code, 404)

    def test_draft_is_refused(self):
        d = _skill(self.owner, name="draft-skill", status="draft")
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(f"{URL}{d.pk}/voice-start/").status_code, 400)

    def test_consume_is_single_use_and_owner_bound(self):
        key = create_launch_context(self.owner, self.skill, {"script": "S"})
        self.assertIsNone(consume_launch_context(self.other, key))
        got = consume_launch_context(self.owner, key)
        self.assertEqual(got["skill_name"], "ctx-skill")
        self.assertEqual(got["allowed_tools"], ["search_records"])
        self.assertIsNone(consume_launch_context(self.owner, key))

    def test_expired_context_is_refused(self):
        from datetime import timedelta

        from django.utils import timezone

        key = create_launch_context(self.owner, self.skill, {"script": "S"})
        VoiceLaunchContext.objects.filter(key=key).update(created_at=timezone.now() - timedelta(minutes=5))
        self.assertIsNone(consume_launch_context(self.owner, key))


class VoiceAgentWorkflowTests(TestCase):
    def test_prompt_includes_workflow_block_and_scope_is_preset(self):
        from realtime.voice_agent import VoiceAgent, build_voice_system_prompt

        self.assertNotIn("ACTIVE WORKFLOW", build_voice_system_prompt("- a — b"))
        self.assertIn("ACTIVE WORKFLOW", build_voice_system_prompt("", "Workflow: x"))
        user = User.objects.create_user("va_user", password="x")
        agent = VoiceAgent(user=user, client=object(),
                           active_workflow={"skill_name": "x", "script": "Workflow: x", "allowed_tools": ["search_records"]})
        self.assertEqual(agent.skill_scope.name, "x")
        self.assertEqual(agent.skill_scope.allowed_tools, frozenset({"search_records"}))
        self.assertIn("Workflow: x", agent.system_prompt)


class SlackScaffoldTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("sl_user", password="x")

    def test_unauthenticated(self):
        self.assertEqual(self.client.get("/api/v1/integrations/slack/conversations/").status_code, 401)

    def test_disabled_without_any_token(self):
        self.client.force_authenticate(self.user)
        with self.settings(SLACK_BOT_TOKEN=""):
            r = self.client.get("/api/v1/integrations/slack/conversations/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["enabled"])
        self.assertEqual(r.data["conversations"], [])

    def test_bot_token_lists_channels_but_not_dms(self):
        class Resp(dict):
            pass

        calls = {}

        class FakeClient:
            def conversations_list(self, **kw):
                calls.update(kw)
                return Resp(channels=[{"id": "C1", "name": "general", "is_private": False}],
                            response_metadata={})

        self.client.force_authenticate(self.user)
        with self.settings(SLACK_BOT_TOKEN="xoxb-test"), patch("integrations.slack_channels._client", return_value=FakeClient()):
            r = self.client.get("/api/v1/integrations/slack/conversations/")
        self.assertTrue(r.data["enabled"])
        self.assertFalse(r.data["dms_available"])
        self.assertNotIn("im", calls["types"])
        self.assertEqual(r.data["conversations"][0]["label"], "#general")

    def test_get_slack_messages_tool_reports_disabled(self):
        import asyncio

        from agents.mcp_server import _current_user, get_slack_messages
        from asgiref.sync import async_to_sync

        tok = _current_user.set(self.user)
        try:
            with self.settings(SLACK_BOT_TOKEN=""):
                out = async_to_sync(get_slack_messages)("general")
        finally:
            _current_user.reset(tok)
        self.assertFalse(out["enabled"])


class SearchAndModelTests(APITestCase):
    def test_agent_skill_is_searchable_and_scoped(self):
        a = User.objects.create_user("se_a", password="x")
        b = User.objects.create_user("se_b", password="x")
        _skill(a, name="quarterly-review", visibility="private")
        _skill(a, name="quarterly-public", visibility="public")
        self.client.force_authenticate(b)
        r = self.client.get("/api/v1/search/", {"q": "quarterly"})
        titles = [x["title"] for x in r.data["results"] if x["type"] == "agent_skill"]
        self.assertEqual(titles, ["quarterly-public"])

    def test_new_fields_round_trip_and_editing_resets_review(self):
        u = User.objects.create_user("rt_user", password="x")
        s = _skill(u)
        self.client.force_authenticate(u)
        r = self.client.patch(f"{URL}{s.pk}/", {"chained_skills": ["other"], "templates": [{"key": "a", "title": "A", "body_html": "<p>x</p>"}]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["chained_skills"], ["other"])
        s.refresh_from_db()
        self.assertEqual(s.status, "draft")


IMPACT_LIKE = """# **Impact 360 Account Updates**

## Slack Prompt: using “Write with AI” feature

# **➡️Every Friday Updates to Weekly Account Plans:**

Create a weekly account update for **[[Account]]** using relevant information available in Slack.
Use EXACTLY this format:

* What is the client focused on currently?
* How does it tie into their larger strategy?

#

# For net-new Account Plan:

Create an **[[Account]] | Plan** Canvas that will serve as a living account-status document.

## 📬 [[Account]] | Plan

### New This Week

Summarize the 3–6 most important developments from this week.
"""


class SplitSectionsTests(TestCase):
    def test_splits_into_templates_and_keeps_subheadings_inside(self):
        from .extract import split_sections

        out = split_sections(IMPACT_LIKE)
        self.assertEqual([s["title"] for s in out["sections"]],
                         ["Every Friday Updates to Weekly Account Plans", "For net-new Account Plan"])
        self.assertIn("Impact 360 Account Updates", out["intro"])
        net_new = out["sections"][1]["markdown"]
        self.assertIn("New This Week", net_new)
        self.assertNotIn("Every Friday", net_new)

    def test_single_section_document_is_not_split(self):
        from .extract import split_sections

        self.assertEqual(split_sections("# Only\n\nSome body text that is long enough to count here.")["sections"], [])

    def test_unique_keys(self):
        from .extract import split_sections

        body = "Body text long enough to count as real content for a section.\n"
        out = split_sections(f"# Update\n{body}# Update\n{body}")
        self.assertEqual(len({s["key"] for s in out["sections"]}), 2)


class ParseTemplateAndViewerTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("pt_owner", password="x")
        self.other = User.objects.create_user("pt_other", password="x")

    def test_parse_template_requires_auth_and_a_file(self):
        self.assertEqual(self.client.post(f"{URL}parse-template/").status_code, 401)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(f"{URL}parse-template/", {}, format="multipart").status_code, 400)

    def test_parse_template_returns_sections_and_stores_nothing(self):
        self.client.force_authenticate(self.owner)
        f = SimpleUploadedFile("impact.md", IMPACT_LIKE.encode(), content_type="text/markdown")
        r = self.client.post(f"{URL}parse-template/", {"file": f}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(r.data["sections"]), 2)
        self.assertFalse(AgentSkillAttachment.objects.exists())

    def test_unreadable_file_is_a_400(self):
        self.client.force_authenticate(self.owner)
        f = SimpleUploadedFile("x.bin", b"\x00\x01", content_type="application/octet-stream")
        self.assertEqual(self.client.post(f"{URL}parse-template/", {"file": f}, format="multipart").status_code, 400)

    def test_attachment_viewer_returns_text_to_anyone_who_can_see_the_skill(self):
        skill = _skill(self.owner, visibility="public")
        att = AgentSkillAttachment.objects.create(skill=skill, name="d.md", text="HELLO")
        self.client.force_authenticate(self.other)
        r = self.client.get(f"{URL}{skill.pk}/attachments/{att.pk}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["text"], "HELLO")

    def test_attachment_of_a_private_skill_is_hidden(self):
        skill = _skill(self.owner)
        att = AgentSkillAttachment.objects.create(skill=skill, name="d.md", text="HELLO")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"{URL}{skill.pk}/attachments/{att.pk}/").status_code, 404)


class GenericVoiceLaunchTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("gv_user", password="x")

    def test_requires_auth_and_text(self):
        self.assertEqual(self.client.post("/api/v1/skills/voice-launch/", {"text": "x"}, format="json").status_code, 401)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.post("/api/v1/skills/voice-launch/", {}, format="json").status_code, 400)

    def test_creates_a_consumable_context_without_a_skill(self):
        self.client.force_authenticate(self.user)
        r = self.client.post("/api/v1/skills/voice-launch/", {"title": "Call Recordings", "text": "Explain recording."}, format="json")
        self.assertEqual(r.status_code, 200)
        got = consume_launch_context(self.user, r.data["key"])
        self.assertIn("Call Recordings", got["script"])
        self.assertEqual(got["skill_name"], "")
        self.assertEqual(got["allowed_tools"], [])


GEN_CSAT_LIKE = (
    "Meeting notes: @#--all-meeting-notes-${account_name}-${date_range}\n"
    "Action items: @#--all-action-items-${account_name}\n"
    "Artifacts: @#--all-artifacts-${account_name}\n"
)


class PlaceholderKeywordTests(TestCase):
    def test_account_and_range_placeholders_are_flagged(self):
        [kw] = keywords.find_keywords("@#--all-meeting-notes-${account_name}-${date_range}")
        self.assertTrue(kw["account_placeholder"])
        self.assertTrue(kw["range_placeholder"])

    def test_the_pickers_own_markers_count_too(self):
        [kw] = keywords.find_keywords("@#--all-account-notes-${account_name}-${date-range}")
        self.assertTrue(kw["account_placeholder"])
        self.assertTrue(kw["range_placeholder"])

    def test_a_braced_real_value_is_not_a_placeholder(self):
        [kw] = keywords.find_keywords("@#--all-meeting-notes-${Acme}-${october}")
        self.assertFalse(kw["account_placeholder"])
        self.assertFalse(kw["range_placeholder"])

    def test_an_unbraced_value_is_not_a_placeholder(self):
        [kw] = keywords.find_keywords("@#--all-meeting-notes-acme-last-30-days")
        self.assertFalse(kw["account_placeholder"])


class PlaceholderRunTests(APITestCase):
    """The reported bug: running a skill whose instructions use ${account_name} / ${date_range} on a chosen
    account said "No account of yours matches 'account_name'" and "Could not read the date range 'date_range'"."""

    def setUp(self):
        self.owner = User.objects.create_user("ph_owner", password="x")
        member = TeamMember.objects.create(user=self.owner, full_name="O", email="po@example.com")
        self.acme = Account.objects.create(company_name="Acme Corp")
        self.globex = Account.objects.create(company_name="Globex")
        self.hidden = Account.objects.create(company_name="Hidden Inc")
        self.acme.team_members.add(member)
        self.globex.team_members.add(member)
        self.client.force_authenticate(self.owner)
        self.skill = _skill(self.owner, name="gen-csat", instructions=GEN_CSAT_LIKE,
                            context_defaults={"needs_accounts": True})

    def _run(self, body, skill=None):
        return self.client.post(f"{URL}{(skill or self.skill).pk}/run/", body, format="json")

    def test_no_unresolved_placeholder_warnings_for_a_chosen_account(self):
        r = self._run({"account_ids": [self.acme.pk]})
        self.assertEqual(r.status_code, 200, r.data)
        text = " ".join(r.data["warnings"])
        self.assertNotIn("account_name", text)
        self.assertNotIn("date_range", text)
        self.assertEqual(r.data["warnings"], [])

    def test_the_lookups_run_for_the_chosen_account(self):
        p = self._run({"account_ids": [self.acme.pk]}).data["prompt"]
        self.assertIn("Meeting notes for Acme Corp", p)
        self.assertIn("Action items for Acme Corp", p)
        self.assertIn("Artifacts for Acme Corp", p)

    def test_the_range_defaults_to_the_last_30_days_and_says_so(self):
        p = self._run({"account_ids": [self.acme.pk]}).data["prompt"]
        start, end = keywords.parse_date_range(keywords.DEFAULT_RANGE)
        self.assertEqual((end - start).days, 30)
        self.assertIn(f"Meeting notes for Acme Corp ({start.isoformat()} to {end.isoformat()})", p)

    def test_a_range_the_runner_gives_is_used(self):
        p = self._run({"account_ids": [self.acme.pk], "date_range": "2026-10-01..2026-10-31"}).data["prompt"]
        self.assertIn("Meeting notes for Acme Corp (2026-10-01 to 2026-10-31)", p)

    def test_a_range_by_month_name(self):
        p = self._run({"account_ids": [self.acme.pk], "date_range": "october"}).data["prompt"]
        self.assertIn("-10-01 to ", p)

    def test_an_unreadable_range_is_refused_with_help(self):
        r = self._run({"account_ids": [self.acme.pk], "date_range": "whenever"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Could not read the date range 'whenever'", str(r.data))

    def test_several_accounts_each_get_their_own_lookup(self):
        p = self._run({"account_ids": [self.acme.pk, self.globex.pk]}).data["prompt"]
        for name in ("Acme Corp", "Globex"):
            self.assertIn(f"Meeting notes for {name}", p)
            self.assertIn(f"Artifacts for {name}", p)

    def test_an_account_the_runner_is_not_on_is_never_looked_up(self):
        r = self._run({"account_ids": [self.acme.pk, self.hidden.pk]})
        self.assertNotIn("Hidden Inc", r.data["prompt"])

    def test_without_an_account_the_placeholder_lookup_says_to_choose_one(self):
        s = _skill(self.owner, name="no-need", instructions="@#--all-artifacts-${account_name}")
        r = self._run({}, skill=s)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("Choose an account" in w for w in r.data["warnings"]))

    def test_a_literal_account_in_a_keyword_still_works_as_before(self):
        s = _skill(self.owner, name="literal", instructions="@#--all-artifacts-acme")
        r = self._run({}, skill=s)
        self.assertIn("Artifacts for Acme Corp", r.data["prompt"])

    def test_a_literal_range_in_a_keyword_is_not_overridden_by_the_runner(self):
        s = _skill(self.owner, name="fixedrange", instructions="@#--all-meeting-notes-${account_name}-${2026-10}")
        p = self._run({"account_ids": [self.acme.pk], "date_range": "2025-01"}, skill=s).data["prompt"]
        self.assertIn("(2026-10-01 to 2026-10-31)", p)

    def test_voice_start_gets_the_same_substitution(self):
        r = self.client.post(f"{URL}{self.skill.pk}/voice-start/", {"account_ids": [self.acme.pk]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual([w for w in r.data.get("warnings", []) if "account_name" in w or "date_range" in w], [])


class ArtifactLookupOnARealServerTests(APITestCase):
    """The reported 400: running a skill whose lookups include an account's artifacts failed for any account that
    had an uploaded file (the bridge asked for a host the server does not allow)."""

    def setUp(self):
        from accounts.models import AccountArtifact

        self.owner = User.objects.create_user("host_owner", password="x")
        member = TeamMember.objects.create(user=self.owner, full_name="H", email="h@example.com")
        self.account = Account.objects.create(company_name="Files Inc")
        self.account.team_members.add(member)
        AccountArtifact.objects.create(
            account=self.account, artifact_type="file", name="deck.pdf", uploaded_by=self.owner,
            file=SimpleUploadedFile("deck.pdf", b"%PDF-1.4 test", content_type="application/pdf"))
        self.skill = _skill(self.owner, name="uses-artifacts", instructions="@#--all-artifacts-${account_name}",
                            context_defaults={"needs_accounts": True})
        self.client.force_authenticate(self.owner)

    @override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1"])
    def test_run_succeeds_and_lists_the_file(self):
        r = self.client.post(f"{URL}{self.skill.pk}/run/", {"account_ids": [self.account.pk]}, format="json",
                             HTTP_HOST="localhost")
        self.assertEqual(r.status_code, 200, getattr(r, "content", b"")[:200])
        self.assertEqual(r.data["warnings"], [])
        self.assertIn("Artifacts for Files Inc — 1 found", r.data["prompt"])
        self.assertIn("name: deck.pdf", r.data["prompt"])

    @override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1"])
    def test_voice_start_succeeds_too(self):
        r = self.client.post(f"{URL}{self.skill.pk}/voice-start/", {"account_ids": [self.account.pk]}, format="json",
                             HTTP_HOST="localhost")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["warnings"], [])

    def test_one_failing_lookup_is_reported_not_fatal(self):
        s = _skill(self.owner, name="two-lookups", instructions="@#--all-artifacts-${Files Inc}\n@#--all-account-notes-${Files Inc}")
        real = keywords.rest_bridge.call

        def flaky(user, method, path, **kw):
            if path.endswith("/artifacts/"):
                raise RuntimeError("boom with a secret: sk-12345")
            return real(user, method, path, **kw)

        with patch("skills.keywords.rest_bridge.call", side_effect=flaky):
            r = self.client.post(f"{URL}{s.pk}/run/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Notes for Files Inc", r.data["prompt"].replace("Account notes", "Notes"))
        self.assertTrue(any("Couldn't look up artifacts" in w for w in r.data["warnings"]))
        # No exception text reaches the person or the prompt.
        self.assertNotIn("sk-12345", str(r.data))


class QuarterAndYearRangeTests(TestCase):
    def span(self, text, today):
        return keywords.parse_date_range(text, today)

    def test_this_quarter(self):
        self.assertEqual(self.span("this-quarter", date(2026, 11, 11)), (date(2026, 10, 1), date(2026, 12, 31)))
        self.assertEqual(self.span("this quarter", date(2026, 1, 15)), (date(2026, 1, 1), date(2026, 3, 31)))
        self.assertEqual(self.span("this-quarter", date(2026, 3, 31)), (date(2026, 1, 1), date(2026, 3, 31)))
        self.assertEqual(self.span("this-quarter", date(2026, 4, 1)), (date(2026, 4, 1), date(2026, 6, 30)))

    def test_last_quarter_including_across_a_year(self):
        self.assertEqual(self.span("last-quarter", date(2026, 11, 11)), (date(2026, 7, 1), date(2026, 9, 30)))
        self.assertEqual(self.span("last-quarter", date(2026, 1, 15)), (date(2025, 10, 1), date(2025, 12, 31)))

    def test_this_and_last_year(self):
        self.assertEqual(self.span("this-year", date(2026, 11, 11)), (date(2026, 1, 1), date(2026, 12, 31)))
        self.assertEqual(self.span("Last Year", date(2026, 11, 11)), (date(2025, 1, 1), date(2025, 12, 31)))

    def test_the_existing_ranges_still_read(self):
        today = date(2026, 11, 11)
        for text in ("last-7-days", "last 14 days", "last 30 days", "last 90 days", "this-week", "last-week",
                     "this-month", "last-month", "october", "2026-10", "2026-10-01..2026-10-31"):
            self.assertIsNotNone(self.span(text, today), text)
