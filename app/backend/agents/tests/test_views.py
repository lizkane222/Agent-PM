"""
Tests for agents.AgentSessionViewSet.

Covers ownership/participant scoping, plus the streaming `send` endpoint: its wire
format, that it streams rather than buffers, and that failures are classified into
actionable messages.
"""

from unittest.mock import patch

import anthropic
import httpx
from asgiref.sync import async_to_sync
from botocore import exceptions as botocore_exceptions
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from agents.models import AgentMessage, AgentSession
from agents.views import classify_agent_error

User = get_user_model()

SESSIONS_URL = "/api/v1/agents/sessions/"
SEND_URL = f"{SESSIONS_URL}send/"


def _make_user(username):
    return User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )


def _make_session(user, title="Test session"):
    return AgentSession.objects.create(user=user, title=title)


class AgentSessionListTest(APITestCase):
    """List scoping — owner and participants see their sessions; others do not."""

    def setUp(self):
        self.user1 = _make_user("user1")
        self.user2 = _make_user("user2")
        self.user3 = _make_user("user3")

        self.session1 = _make_session(self.user1, "User1 session")
        self.session2 = _make_session(self.user2, "User2 session")
        # user3 is a participant in session1
        self.session1.participants.add(self.user3)

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(SESSIONS_URL)
        self.assertEqual(resp.status_code, 401)

    def test_owner_sees_own_session(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(SESSIONS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertIn(self.session1.id, ids)

    def test_owner_does_not_see_other_session(self):
        self.client.force_authenticate(user=self.user1)
        resp = self.client.get(SESSIONS_URL)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertNotIn(self.session2.id, ids)

    def test_participant_sees_shared_session(self):
        self.client.force_authenticate(user=self.user3)
        resp = self.client.get(SESSIONS_URL)
        self.assertEqual(resp.status_code, 200)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertIn(self.session1.id, ids)

    def test_non_participant_does_not_see_session(self):
        self.client.force_authenticate(user=self.user2)
        resp = self.client.get(SESSIONS_URL)
        ids = [s["id"] for s in resp.data["results"]]
        self.assertNotIn(self.session1.id, ids)


class AgentSessionWriteTest(APITestCase):
    """Create and retrieve — owner-scoped operations."""

    def setUp(self):
        self.owner = _make_user("owner")
        self.other = _make_user("other")
        self.session = _make_session(self.owner)

    def test_authenticated_user_can_create_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(SESSIONS_URL, {"title": "New session"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(AgentSession.objects.filter(title="New session", user=self.owner).exists())

    def test_unauthenticated_create_returns_401(self):
        resp = self.client.post(SESSIONS_URL, {"title": "Anon"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_owner_can_retrieve_own_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.get(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], self.session.id)

    def test_non_owner_cannot_retrieve_session(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.get(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_owner_can_delete_own_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.delete(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(AgentSession.objects.filter(pk=self.session.id).exists())

    def test_non_owner_cannot_delete_session(self):
        self.client.force_authenticate(user=self.other)
        resp = self.client.delete(f"{SESSIONS_URL}{self.session.id}/")
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(AgentSession.objects.filter(pk=self.session.id).exists())


# ── Streaming send endpoint ───────────────────────────────────────────────────

def _fake_orchestrator(items=(), raises=None, model="test-model"):
    """
    Build a stand-in for AgentOrchestrator.

    `items` are yielded verbatim; `raises` is raised after them, mimicking a failure
    part-way through a response.
    """

    class _Fake:
        def __init__(self, *a, **kw):
            self.model = model

        async def run(self, user_message, history, user=None):
            for item in items:
                yield item
            if raises is not None:
                raise raises

    return _Fake


def _consume(response) -> bytes:
    """Drain a StreamingHttpResponse whose content is an async iterator."""

    async def _collect():
        return b"".join([chunk async for chunk in response])

    return async_to_sync(_collect)()


def _usage(model="test-model", input_tokens=11, output_tokens=7):
    return {
        "__token_usage__": True,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "model": model,
    }


class AgentSendStreamTest(APITestCase):
    """Wire format and streaming behaviour of POST /agents/sessions/send/."""

    def setUp(self):
        self.user = _make_user("sender")

    def test_unauthenticated_returns_401(self):
        resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_response_streams_asynchronously(self):
        """
        Regression guard for the buffering bug: a *sync* generator makes Django fall
        back to sync_to_async(list), which materialises the whole response first.
        """
        self.client.force_authenticate(user=self.user)
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=["hi"])):
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            self.assertTrue(resp.is_async)
            _consume(resp)

    def test_text_and_token_sentinel_framing_is_unchanged(self):
        """Several frontend call sites parse this framing inline — it is a contract."""
        self.client.force_authenticate(user=self.user)
        items = ["Hello ", "world", _usage(input_tokens=11, output_tokens=7)]
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=items)):
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            body = _consume(resp).decode()

        self.assertTrue(body.startswith("Hello world"))
        self.assertIn('\x00TOKEN_USAGE:{"input_tokens": 11, "output_tokens": 7', body)
        self.assertTrue(body.endswith("\x00"))

    def test_sentinel_reports_the_model_used(self):
        self.client.force_authenticate(user=self.user)
        items = ["x", _usage(model="bedrock-opus")]
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=items)):
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            body = _consume(resp).decode()
        self.assertIn('"model": "bedrock-opus"', body)

    def test_session_id_header_and_persisted_messages(self):
        self.client.force_authenticate(user=self.user)
        items = ["All ", "done", _usage(input_tokens=3, output_tokens=4)]
        with patch("agents.views.AgentOrchestrator", _fake_orchestrator(items=items)):
            resp = self.client.post(SEND_URL, {"message": "ping"}, format="json")
            session_id = int(resp["X-Session-Id"])
            _consume(resp)

        assistant = AgentMessage.objects.get(session_id=session_id, role="assistant")
        self.assertEqual(assistant.content, "All done")
        self.assertEqual(assistant.input_tokens, 3)
        self.assertEqual(assistant.output_tokens, 4)
        self.assertTrue(
            AgentMessage.objects.filter(
                session_id=session_id, role="user", content="ping"
            ).exists()
        )

    def _send_failing(self, exc, items=()):
        """POST with an orchestrator that raises, returning (body, captured logs)."""
        self.client.force_authenticate(user=self.user)
        fake = _fake_orchestrator(items=items, raises=exc)
        with patch("agents.views.AgentOrchestrator", fake):
            resp = self.client.post(SEND_URL, {"message": "hi"}, format="json")
            self.session_id = int(resp["X-Session-Id"])
            # assertLogs both asserts the server-side record exists and keeps the
            # expected tracebacks out of the test runner's output.
            with self.assertLogs("agents.views", level="ERROR") as logs:
                body = _consume(resp).decode()
        return body, logs.output

    def test_partial_output_is_kept_when_the_stream_fails(self):
        body, _ = self._send_failing(
            botocore_exceptions.NoCredentialsError(), items=["partial answer"]
        )
        self.assertIn("partial answer", body)
        self.assertIn("aws sso login", body)
        self.assertEqual(
            AgentMessage.objects.get(
                session_id=self.session_id, role="assistant"
            ).content,
            "partial answer",
        )

    def test_expired_credentials_produce_an_actionable_message(self):
        body, _ = self._send_failing(
            botocore_exceptions.TokenRetrievalError(provider="sso", error_msg="expired")
        )
        self.assertIn("aws sso login", body)
        # The old blanket message told the user nothing.
        self.assertNotIn("[Agent error - check server logs]", body)

    def test_failure_is_logged_with_the_ref_shown_to_the_user(self):
        body, logs = self._send_failing(RuntimeError("kaboom"))
        ref = body.split("ref ")[1].rstrip(")]\n")
        self.assertTrue(any(ref in line for line in logs))
        self.assertTrue(any("kaboom" in line for line in logs))

    def test_error_body_leaks_no_exception_detail(self):
        """Messages are built from fixed strings so tokens/ARNs cannot reach the browser."""
        body, logs = self._send_failing(
            botocore_exceptions.CredentialRetrievalError(
                provider="sso",
                error_msg="secret-token-abc123 leaked from arn:aws:iam::1:role/x",
            )
        )
        self.assertNotIn("secret-token-abc123", body)
        self.assertNotIn("arn:aws:iam", body)
        # It is not lost, just kept server-side.
        self.assertTrue(any("secret-token-abc123" in line for line in logs))


class ClassifyAgentErrorTest(SimpleTestCase):
    """Exception → user-facing message mapping."""

    @staticmethod
    def _anthropic(cls, code):
        return cls(
            "boom",
            response=httpx.Response(
                code, request=httpx.Request("POST", "https://example.com")
            ),
            body=None,
        )

    def test_bedrock_credential_errors_point_at_sso_login(self):
        for exc in (
            botocore_exceptions.TokenRetrievalError(provider="sso", error_msg="x"),
            botocore_exceptions.UnauthorizedSSOTokenError(),
            botocore_exceptions.SSOTokenLoadError(error_msg="x"),
            botocore_exceptions.NoCredentialsError(),
            botocore_exceptions.ProfileNotFound(profile="p"),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.assertIn("aws sso login", classify_agent_error(exc, "ref1"))

    def test_auth_errors_mention_key_or_role(self):
        for cls, code in (
            (anthropic.AuthenticationError, 401),
            (anthropic.PermissionDeniedError, 403),
        ):
            with self.subTest(cls=cls.__name__):
                msg = classify_agent_error(self._anthropic(cls, code), "ref2")
                self.assertIn("access denied", msg.lower())

    def test_rate_limit(self):
        msg = classify_agent_error(self._anthropic(anthropic.RateLimitError, 429), "r")
        self.assertIn("rate limited", msg.lower())

    def test_missing_model(self):
        msg = classify_agent_error(self._anthropic(anthropic.NotFoundError, 404), "r")
        self.assertIn("unavailable", msg.lower())

    def test_connectivity_errors_mention_vpn(self):
        for exc in (
            anthropic.APIConnectionError(
                request=httpx.Request("POST", "https://example.com")
            ),
            botocore_exceptions.EndpointConnectionError(endpoint_url="https://x"),
            botocore_exceptions.SSLError(endpoint_url="https://x", error="bad cert"),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.assertIn("vpn", classify_agent_error(exc, "ref3").lower())

    def test_misconfiguration_is_distinguished_from_a_crash(self):
        msg = classify_agent_error(ImproperlyConfigured("no model"), "ref4")
        self.assertIn("misconfigured", msg.lower())

    def test_unknown_error_falls_back_but_still_carries_the_ref(self):
        msg = classify_agent_error(RuntimeError("kaboom"), "deadbeef")
        self.assertIn("unexpected", msg.lower())
        self.assertIn("deadbeef", msg)
        self.assertNotIn("kaboom", msg)

    def test_every_message_carries_its_correlation_ref(self):
        cases = [
            botocore_exceptions.NoCredentialsError(),
            self._anthropic(anthropic.AuthenticationError, 401),
            self._anthropic(anthropic.RateLimitError, 429),
            ImproperlyConfigured("x"),
            RuntimeError("x"),
        ]
        for exc in cases:
            with self.subTest(exc=type(exc).__name__):
                self.assertIn("ref9", classify_agent_error(exc, "ref9"))
