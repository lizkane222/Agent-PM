"""
Tests for core.llm — the single funnel every LLM call in this app goes through.

The load-bearing group is VendorGuardTests. The gateway publishes `et-router` and
`claude-router`, which pool Anthropic's models with third-party ones; both were
measured dispatching to `moonshotai.kimi-k2.5` on 2026-08-31. Account, meeting and
customer-contact data must not leave for another vendor, so a non-Anthropic model id
is refused at resolution time rather than trusted not to be configured.

No test here reaches a network: the token helper is always patched or the resolver is
called in isolation.
"""

import base64
import json
import subprocess
import time
from unittest.mock import patch

import anthropic
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from core.llm import (
    TIER_DEFAULT,
    TIER_STRONG,
    TIER_VOICE,
    GatewayCredentialError,
    is_opus,
    build_async_client,
    build_sync_client,
    complete,
    gateway_token,
    is_anthropic_model,
    model_for_tier,
    reset_gateway_token_cache,
)

TIERS = {
    "bedrock": {
        "default": "claude-bedrock-sonnet",
        "strong": "claude-bedrock-sonnet5",
        "voice": "claude-bedrock-haiku",
    },
    "gateway": {
        "default": "claude-gw-sonnet",
        "strong": "claude-gw-sonnet5",
        "voice": "claude-gw-haiku",
    },
}

# core.settings blanks every gateway credential while the suite runs, so an unpatched
# LLM call fails loudly instead of billing a real one. These tests are *about* that
# credential, so they set it back explicitly and patch subprocess.run.
BASE = dict(AGENT_MODEL_TIERS=TIERS, AGENT_MODEL_OVERRIDE="", AGENT_BACKEND="gateway",
            AGENT_REQUIRE_ANTHROPIC_MODEL=True, AGENT_BLOCK_OPUS=True,
            ANTHROPIC_API_KEY="sk-static-test",
            AGENT_GATEWAY_TOKEN_COMMAND="/fake/token-helper")

# Tier maps that name Opus, for the substitution tests.
OPUS_TIERS = {"gateway": {"default": "claude-sonnet-4-6", "strong": "claude-opus-4-8",
                          "voice": "claude-haiku-4-5"}}
ALL_OPUS_TIERS = {"gateway": {"default": "claude-opus-5", "strong": "claude-opus-4-8",
                              "voice": "claude-opus-4-7"}}


def _jwt(exp: float) -> str:
    """A signature-less JWT carrying only `exp` — enough for the cache to read it."""
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


class _Completed:
    def __init__(self, stdout="", stderr="", returncode=0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


@override_settings(**BASE)
class ModelResolutionTests(SimpleTestCase):
    @override_settings(AGENT_BACKEND="gateway")
    def test_resolves_all_three_gateway_tiers(self):
        self.assertEqual(model_for_tier(TIER_DEFAULT), "claude-gw-sonnet")
        self.assertEqual(model_for_tier(TIER_STRONG), "claude-gw-sonnet5")
        self.assertEqual(model_for_tier(TIER_VOICE), "claude-gw-haiku")

    @override_settings(AGENT_BACKEND="bedrock")
    def test_the_same_tier_maps_elsewhere_per_backend(self):
        self.assertEqual(model_for_tier(TIER_DEFAULT), "claude-bedrock-sonnet")

    @override_settings(AGENT_MODEL_OVERRIDE="claude-pinned")
    def test_override_wins_for_every_tier(self):
        for tier in (TIER_DEFAULT, TIER_STRONG, TIER_VOICE):
            self.assertEqual(model_for_tier(tier), "claude-pinned")

    @override_settings(AGENT_BACKEND="nonsense")
    def test_unknown_backend_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier(TIER_DEFAULT)

    @override_settings(AGENT_MODEL_TIERS={"gateway": {"default": "", "voice": ""}})
    def test_unconfigured_tier_raises_rather_than_sending_an_empty_model(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier(TIER_DEFAULT)

    def test_unknown_tier_name_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier("no-such-tier")

    def test_real_settings_resolve_all_three_tiers_for_the_active_backend(self):
        """The shipped configuration must actually work, not just the fixtures."""
        from django.conf import settings as real
        with override_settings(AGENT_MODEL_TIERS=real.AGENT_MODEL_TIERS,
                               AGENT_BACKEND=real.AGENT_BACKEND,
                               AGENT_MODEL_OVERRIDE=real.AGENT_MODEL_OVERRIDE):
            for tier in (TIER_DEFAULT, TIER_STRONG, TIER_VOICE):
                self.assertTrue(model_for_tier(tier))


@override_settings(**BASE)
class VendorGuardTests(SimpleTestCase):
    """App data must not reach a non-Anthropic vendor via a router model."""

    def test_anthropic_ids_are_accepted(self):
        for model in ("claude-sonnet-4-6", "claude-haiku-4-5",
                      "us.anthropic.claude-opus-4-8",
                      "anthropic.claude-haiku-4-5-20251001-v1:0"):
            self.assertTrue(is_anthropic_model(model), model)

    def test_third_party_and_router_ids_are_rejected(self):
        for model in ("moonshotai.kimi-k2.5", "gpt-4o", "llama-3",
                      "et-router", "claude-router", "", None):
            self.assertFalse(is_anthropic_model(model), model)

    def test_the_routers_are_rejected_despite_claude_in_the_name(self):
        """`claude-router` reads Anthropic-only but is not — it must still be refused."""
        self.assertFalse(is_anthropic_model("claude-router"))
        self.assertFalse(is_anthropic_model("CLAUDE-ROUTER"))

    @override_settings(AGENT_MODEL_OVERRIDE="et-router")
    def test_configuring_et_router_raises_with_an_explanatory_message(self):
        with self.assertRaises(ImproperlyConfigured) as ctx:
            model_for_tier(TIER_DEFAULT)
        message = str(ctx.exception)
        self.assertIn("cross-vendor router", message)
        self.assertIn("moonshotai", message)

    @override_settings(AGENT_MODEL_OVERRIDE="claude-router")
    def test_configuring_claude_router_also_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            model_for_tier(TIER_DEFAULT)

    @override_settings(AGENT_MODEL_OVERRIDE="gpt-4o")
    def test_a_plain_non_anthropic_model_raises(self):
        with self.assertRaises(ImproperlyConfigured) as ctx:
            model_for_tier(TIER_DEFAULT)
        self.assertIn("not an Anthropic model", str(ctx.exception))

    @override_settings(AGENT_MODEL_OVERRIDE="et-router", AGENT_REQUIRE_ANTHROPIC_MODEL=False)
    def test_the_guard_can_be_lifted_deliberately(self):
        self.assertEqual(model_for_tier(TIER_DEFAULT), "et-router")

    def test_the_shipped_tier_map_contains_no_router(self):
        from django.conf import settings as real
        for backend, tiers in real.AGENT_MODEL_TIERS.items():
            for tier, model in tiers.items():
                if model:
                    self.assertTrue(is_anthropic_model(model), f"{backend}/{tier} = {model}")


@override_settings(**BASE)
class GatewayTokenTests(SimpleTestCase):
    def setUp(self):
        reset_gateway_token_cache()

    def tearDown(self):
        reset_gateway_token_cache()

    @override_settings(ANTHROPIC_API_KEY="sk-static-test")
    def test_a_static_key_wins_and_never_runs_the_helper(self):
        with patch("core.llm.subprocess.run") as run:
            self.assertEqual(gateway_token(), "sk-static-test")
        run.assert_not_called()

    @override_settings(ANTHROPIC_API_KEY="")
    def test_falls_back_to_the_helper_command(self):
        token = _jwt(time.time() + 3600)
        with patch("core.llm.subprocess.run", return_value=_Completed(stdout=token + "\n")):
            self.assertEqual(gateway_token(), token)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_the_token_is_cached_so_a_hot_path_does_not_fork_per_call(self):
        token = _jwt(time.time() + 3600)
        with patch("core.llm.subprocess.run", return_value=_Completed(stdout=token)) as run:
            gateway_token()
            gateway_token()
            gateway_token()
        self.assertEqual(run.call_count, 1)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_a_token_near_expiry_is_re_minted(self):
        """Refreshing early is what stops a request starting with a dying credential."""
        nearly_dead = _jwt(time.time() + 30)   # inside TOKEN_REFRESH_MARGIN_SECONDS
        with patch("core.llm.subprocess.run", return_value=_Completed(stdout=nearly_dead)) as run:
            gateway_token()
            gateway_token()
        self.assertEqual(run.call_count, 2)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_force_bypasses_the_cache(self):
        token = _jwt(time.time() + 3600)
        with patch("core.llm.subprocess.run", return_value=_Completed(stdout=token)) as run:
            gateway_token()
            gateway_token(force=True)
        self.assertEqual(run.call_count, 2)

    @override_settings(ANTHROPIC_API_KEY="")
    def test_a_non_jwt_token_is_still_usable(self):
        with patch("core.llm.subprocess.run", return_value=_Completed(stdout="opaque-key")):
            self.assertEqual(gateway_token(), "opaque-key")

    @override_settings(ANTHROPIC_API_KEY="", AGENT_GATEWAY_TOKEN_COMMAND="")
    def test_no_credential_source_at_all_raises(self):
        with self.assertRaises(ImproperlyConfigured) as ctx:
            gateway_token()
        self.assertIn("ANTHROPIC_API_KEY", str(ctx.exception))

    @override_settings(ANTHROPIC_API_KEY="")
    def test_a_hanging_helper_times_out_with_actionable_advice(self):
        """
        The helper drops into an interactive browser login when its own cache is
        stale, which would otherwise hang a web worker forever.
        """
        with patch("core.llm.subprocess.run",
                   side_effect=subprocess.TimeoutExpired(cmd="helper", timeout=20)):
            with self.assertRaises(ImproperlyConfigured) as ctx:
                gateway_token()
        self.assertIn("browser login", str(ctx.exception))

    @override_settings(ANTHROPIC_API_KEY="")
    def test_a_missing_helper_binary_raises_clearly(self):
        with patch("core.llm.subprocess.run", side_effect=FileNotFoundError()):
            with self.assertRaises(ImproperlyConfigured) as ctx:
                gateway_token()
        self.assertIn("not found", str(ctx.exception))

    @override_settings(ANTHROPIC_API_KEY="")
    def test_a_failing_helper_surfaces_its_stderr(self):
        err = subprocess.CalledProcessError(returncode=1, cmd="helper", stderr="okta said no")
        with patch("core.llm.subprocess.run", side_effect=err):
            with self.assertRaises(ImproperlyConfigured) as ctx:
                gateway_token()
        self.assertIn("okta said no", str(ctx.exception))

    @override_settings(ANTHROPIC_API_KEY="")
    def test_an_empty_helper_output_raises(self):
        with patch("core.llm.subprocess.run", return_value=_Completed(stdout="  \n")):
            with self.assertRaises(ImproperlyConfigured):
                gateway_token()


@override_settings(**BASE)
class ClientConstructionTests(SimpleTestCase):
    def setUp(self):
        reset_gateway_token_cache()

    @override_settings(AGENT_BACKEND="gateway",
                       AGENT_GATEWAY_BASE_URL="https://gw.example.com")
    def test_gateway_clients_use_the_explicit_base_url(self):
        """Never an inherited ANTHROPIC_BASE_URL from the launching shell."""
        for build, cls in ((build_async_client, anthropic.AsyncAnthropic),
                           (build_sync_client, anthropic.Anthropic)):
            client = build()
            self.assertIsInstance(client, cls)
            self.assertEqual(str(client.base_url).rstrip("/"), "https://gw.example.com")

    @override_settings(AGENT_BACKEND="bedrock")
    def test_bedrock_backend_is_still_available_as_a_one_env_var_revert(self):
        self.assertIsInstance(build_async_client(), anthropic.AsyncAnthropicBedrock)
        self.assertIsInstance(build_sync_client(), anthropic.AnthropicBedrock)

    @override_settings(AGENT_BACKEND="nonsense")
    def test_unknown_backend_raises_for_both_clients(self):
        with self.assertRaises(ImproperlyConfigured):
            build_async_client()
        with self.assertRaises(ImproperlyConfigured):
            build_sync_client()


@override_settings(**BASE)
class CompleteTests(SimpleTestCase):
    """`complete()` replaces the hand-rolled boto3 invoke_model calls."""

    class _FakeMessages:
        def __init__(self):
            self.calls = []

        def create(self, **kwargs):
            self.calls.append(kwargs)

            class _B:
                type = "text"
                text = " hello "

            class _M:
                content = [_B()]

            return _M()

    def _client(self):
        client = type("C", (), {})()
        client.messages = self._FakeMessages()
        return client

    def test_returns_stripped_text_and_resolves_the_tier_model(self):
        client = self._client()
        with patch("core.llm.build_sync_client", return_value=client):
            self.assertEqual(complete("hi", max_tokens=32), "hello")
        self.assertEqual(client.messages.calls[0]["model"], "claude-gw-sonnet")
        self.assertEqual(client.messages.calls[0]["max_tokens"], 32)

    def test_system_prompt_is_omitted_when_blank(self):
        client = self._client()
        with patch("core.llm.build_sync_client", return_value=client):
            complete("hi")
        self.assertNotIn("system", client.messages.calls[0])

    def test_system_prompt_is_passed_when_given(self):
        client = self._client()
        with patch("core.llm.build_sync_client", return_value=client):
            complete("hi", system="be terse")
        self.assertEqual(client.messages.calls[0]["system"], "be terse")

    def test_an_explicit_model_bypasses_tier_resolution(self):
        client = self._client()
        with patch("core.llm.build_sync_client", return_value=client):
            complete("hi", model="claude-explicit")
        self.assertEqual(client.messages.calls[0]["model"], "claude-explicit")

    def test_a_strong_tier_request_resolves_the_strong_model(self):
        client = self._client()
        with patch("core.llm.build_sync_client", return_value=client):
            complete("hi", tier=TIER_STRONG)
        self.assertEqual(client.messages.calls[0]["model"], "claude-gw-sonnet5")


@override_settings(**BASE)
class OpusBlockTests(SimpleTestCase):
    """
    Opus is disabled on cost grounds and *substituted*, not rejected.

    Erroring would take the agent down over a cost preference; the request was to fall
    back to the other models instead.
    """

    def test_opus_ids_are_recognised_in_every_shape(self):
        for model in ("claude-opus-5", "claude-opus-4-8", "claude-opus-4-8[1m]",
                      "us.anthropic.claude-opus-4-7", "CLAUDE-OPUS-5"):
            self.assertTrue(is_opus(model), model)

    def test_non_opus_ids_are_not_flagged(self):
        for model in ("claude-sonnet-4-6", "claude-sonnet-5", "claude-haiku-4-5", "", None):
            self.assertFalse(is_opus(model), model)

    @override_settings(AGENT_MODEL_TIERS=OPUS_TIERS)
    def test_an_opus_strong_tier_falls_back_to_a_non_opus_model(self):
        resolved = model_for_tier(TIER_STRONG)
        self.assertEqual(resolved, "claude-sonnet-4-6")
        self.assertFalse(is_opus(resolved))

    @override_settings(AGENT_MODEL_OVERRIDE="claude-opus-5")
    def test_an_opus_override_is_also_substituted(self):
        """The override is the most likely way Opus creeps back in."""
        self.assertEqual(model_for_tier(TIER_DEFAULT), "claude-gw-sonnet")

    @override_settings(AGENT_MODEL_TIERS=OPUS_TIERS)
    def test_the_substitution_is_logged_so_it_is_not_silent(self):
        with self.assertLogs("core.llm", level="WARNING") as logs:
            model_for_tier(TIER_STRONG)
        self.assertIn("Opus is disabled", "".join(logs.output))

    @override_settings(AGENT_MODEL_TIERS=OPUS_TIERS, AGENT_BLOCK_OPUS=False)
    def test_opus_is_allowed_when_the_block_is_lifted(self):
        self.assertEqual(model_for_tier(TIER_STRONG), "claude-opus-4-8")

    @override_settings(AGENT_MODEL_TIERS=ALL_OPUS_TIERS)
    def test_raises_when_no_non_opus_model_is_configured_at_all(self):
        """Inventing a model id would be worse than failing loudly."""
        with self.assertRaises(ImproperlyConfigured) as ctx:
            model_for_tier(TIER_STRONG)
        self.assertIn("no non-Opus model", str(ctx.exception))

    def test_no_tier_resolves_to_opus_under_the_shipped_settings(self):
        from django.conf import settings as real
        with override_settings(AGENT_MODEL_TIERS=real.AGENT_MODEL_TIERS,
                               AGENT_BACKEND=real.AGENT_BACKEND,
                               AGENT_MODEL_OVERRIDE=real.AGENT_MODEL_OVERRIDE,
                               AGENT_BLOCK_OPUS=real.AGENT_BLOCK_OPUS):
            for tier in (TIER_DEFAULT, TIER_STRONG, TIER_VOICE):
                self.assertFalse(is_opus(model_for_tier(tier)), tier)

    def test_the_shipped_strong_tier_is_still_a_step_up_from_default(self):
        """Escalation must remain meaningful after dropping Opus."""
        from django.conf import settings as real
        tiers = real.AGENT_MODEL_TIERS[real.AGENT_BACKEND]
        self.assertNotEqual(tiers["default"], tiers["strong"])


@override_settings(**BASE)
class GatewayCredentialErrorTypeTests(SimpleTestCase):
    """
    Credential failures raise a distinct subclass so the API layer can tell the user
    to re-authenticate, instead of the generic "misconfigured".
    """

    def setUp(self):
        reset_gateway_token_cache()

    def tearDown(self):
        reset_gateway_token_cache()

    @override_settings(ANTHROPIC_API_KEY="", AGENT_GATEWAY_TOKEN_COMMAND="")
    def test_missing_credential_source_raises_the_credential_subclass(self):
        with self.assertRaises(GatewayCredentialError):
            gateway_token()

    @override_settings(ANTHROPIC_API_KEY="")
    def test_a_timeout_raises_the_credential_subclass(self):
        with patch("core.llm.subprocess.run",
                   side_effect=subprocess.TimeoutExpired(cmd="helper", timeout=20)):
            with self.assertRaises(GatewayCredentialError):
                gateway_token()

    def test_it_is_still_an_improperly_configured(self):
        """Existing handlers that catch ImproperlyConfigured must keep working."""
        self.assertTrue(issubclass(GatewayCredentialError, ImproperlyConfigured))

    @override_settings(AGENT_MODEL_TIERS={"gateway": {"default": ""}})
    def test_a_missing_tier_is_NOT_a_credential_error(self):
        """The two must stay distinguishable, or the advice is wrong again."""
        with self.assertRaises(ImproperlyConfigured) as ctx:
            model_for_tier(TIER_DEFAULT)
        self.assertNotIsInstance(ctx.exception, GatewayCredentialError)
