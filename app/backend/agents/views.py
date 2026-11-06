"""API views for the agents app."""

import json
import logging
import os
import uuid

import anthropic
from asgiref.sync import sync_to_async
from botocore import exceptions as botocore_exceptions
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured

from core.llm import GatewayCredentialError
from django.db.models import Q, Sum
from django.http import HttpResponse, StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from . import token_budget
from .agent import AgentOrchestrator
from .models import AgentMessage, AgentSession
from .serializers import (
    AgentMessageInputSerializer,
    AgentMessageSerializer,
    AgentSessionSerializer,
    ShareSessionSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)

# Credential problems that a user can actually resolve themselves, and which are
# otherwise indistinguishable from a code bug in the streamed response.
_BEDROCK_CREDENTIAL_ERRORS = (
    botocore_exceptions.TokenRetrievalError,
    botocore_exceptions.UnauthorizedSSOTokenError,
    botocore_exceptions.SSOTokenLoadError,
    botocore_exceptions.NoCredentialsError,
    botocore_exceptions.CredentialRetrievalError,
    botocore_exceptions.ProfileNotFound,
)


def _retry_after_seconds(exc: BaseException) -> int | None:
    """The server's Retry-After, if it sent one — used to tell the user how long to wait."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or {}
    for key in ("retry-after-ms", "retry-after"):
        raw = headers.get(key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        seconds = value / 1000 if key.endswith("-ms") else value
        if 0 < seconds <= 3600:
            return max(1, int(round(seconds)))
    return None


def classify_agent_error(exc: BaseException, ref: str) -> str:
    """
    Map an exception to a short, actionable message safe to show in the browser.

    Deliberately coarse: no exception text is interpolated, so nothing sensitive
    (tokens, ARNs, request bodies) can leak. `ref` correlates with the server log.
    """
    # Checked before the generic ImproperlyConfigured branch below, which it subclasses.
    # This is the gateway's equivalent of an expired SSO token, and it is the one
    # credential failure the user can resolve without touching the server.
    if isinstance(exc, GatewayCredentialError):
        return (
            f"[Model credentials unavailable. Re-authenticate to the LiteLLM gateway by "
            f"running `{settings.AGENT_GATEWAY_TOKEN_COMMAND or 'the gateway token helper'}` "
            f"in a terminal, then try again. (ref {ref})]"
        )
    if isinstance(exc, _BEDROCK_CREDENTIAL_ERRORS):
        # Only advise `aws sso login` when Bedrock is actually the configured backend.
        # This message used to be unconditional, so after the move to the gateway it
        # sent people to re-authenticate against AWS for a failure that had nothing to
        # do with AWS — which is exactly how it was reported.
        if settings.AGENT_BACKEND == "bedrock":
            profile = os.environ.get("AWS_PROFILE", "twilio-devex-bedrock")
            return (
                f"[Model credentials expired. Run `aws sso login --profile {profile}` "
                f"and try again. (ref {ref})]"
            )
        return f"[Model credentials unavailable — check the gateway token. (ref {ref})]"
    if isinstance(exc, ImproperlyConfigured):
        return f"[Agent is misconfigured — see server logs. (ref {ref})]"
    if isinstance(exc, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
        if settings.AGENT_BACKEND == "bedrock":
            return (
                f"[Model access denied. Check the Bedrock role permissions. (ref {ref})]"
            )
        # Already retried once with a fresh token by core.llm's gateway transport.
        return (
            f"[The LiteLLM gateway refused the request. Re-run "
            f"`{settings.AGENT_GATEWAY_TOKEN_COMMAND or 'the gateway token helper'}` "
            f"in a terminal and try again. (ref {ref})]"
        )
    if isinstance(exc, anthropic.NotFoundError):
        return f"[Configured model is unavailable on this backend. (ref {ref})]"
    if isinstance(exc, anthropic.RateLimitError):
        wait = _retry_after_seconds(exc)
        hint = f" in about {wait} seconds" if wait else " shortly"
        return f"[Rate limited by the model endpoint. Try again{hint}. (ref {ref})]"
    # 529 Overloaded and other 5xx: the SDK has already retried with backoff by now.
    if isinstance(exc, anthropic.APIStatusError) and getattr(exc, "status_code", 0) in (500, 502, 503, 504, 529):
        return f"[The model service is overloaded or unavailable. Try again in a minute. (ref {ref})]"
    # Before APIConnectionError, which it subclasses — a timeout is not a VPN problem.
    if isinstance(exc, anthropic.APITimeoutError):
        return (
            f"[The model took too long to respond. Try a shorter or simpler request. (ref {ref})]"
        )
    if isinstance(exc, anthropic.BadRequestError):
        text = str(getattr(exc, "message", "") or "").lower()
        if "too long" in text or "context" in text or "max_tokens" in text:
            return (
                f"[This conversation is too long for the model. Start a new session. (ref {ref})]"
            )
        return f"[The model rejected the request. (ref {ref})]"
    if isinstance(
        exc,
        (
            anthropic.APIConnectionError,
            botocore_exceptions.EndpointConnectionError,
            botocore_exceptions.SSLError,
        ),
    ):
        return (
            f"[Cannot reach the model endpoint. Check VPN/Zscaler connectivity. "
            f"(ref {ref})]"
        )
    return f"[Unexpected agent error — check server logs. (ref {ref})]"


class AgentSessionViewSet(viewsets.ModelViewSet):
    """CRUD for agent conversation sessions."""

    serializer_class = AgentSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        # ScopedRateThrottle reads the scope off the view; only the streaming send uses it.
        self.throttle_scope = "agent_stream" if getattr(self, "action", None) == "send_message" else None
        return super().get_throttles()

    def get_queryset(self):
        user = self.request.user
        return (
            AgentSession.objects
            .filter(Q(user=user) | Q(participants=user))
            .distinct()
            .prefetch_related("messages__tool_calls", "participants")
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="share")
    def share(self, request, pk=None):
        """Share this session with one or more other users."""
        session = self.get_object()

        # Only the owner can share.
        if session.user != request.user:
            return Response(
                {"detail": "Only the session owner can share it."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = ShareSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user_ids = serializer.validated_data["user_ids"]

        users = User.objects.filter(pk__in=user_ids)
        if not users.exists():
            return Response(
                {"detail": "No valid users found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.participants.add(*users)
        session.is_shared = True
        session.save(update_fields=["is_shared"])

        # Notify each added participant via the Sync feed.
        try:
            from realtime.sync import publish_activity_event
            for user in users:
                publish_activity_event(
                    user,
                    "chat_shared",
                    f"{request.user.get_full_name() or request.user.username} shared a chat with you",
                    detail=session.title or f"Session {session.pk}",
                    metadata={"session_id": session.pk},
                )
        except Exception:
            logger.warning("Failed to send share notifications for session %s", session.pk)

        return Response(AgentSessionSerializer(session).data)

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        """
        Download this session's messages as JSON or Markdown.

        Query params:
          ?format=json  (default) — full JSON dump: session metadata + messages + tool calls
          ?format=md              — human-readable Markdown transcript
        """
        session = self.get_object()
        fmt = (request.query_params.get("format") or "json").strip().lower()
        messages = (
            AgentMessage.objects
            .filter(session=session)
            .prefetch_related("tool_calls")
            .order_by("created_at")
        )

        if fmt == "md":
            lines = [
                f"# {session.title or f'Session {session.pk}'}",
                "",
                f"- **Session ID:** {session.pk}",
                f"- **Owner:** {session.user.username}",
                f"- **Started:** {session.started_at.isoformat() if session.started_at else '—'}",
                f"- **Status:** {session.status}",
                "",
                "---",
                "",
            ]
            for m in messages:
                header = m.role.replace("_", " ").title()
                lines.append(f"## {header} — {m.created_at.isoformat()}")
                lines.append("")
                lines.append(m.content or "")
                lines.append("")
                for tc in m.tool_calls.all():
                    lines.append(f"> **Tool call:** `{tc.tool_name}` ({tc.status})")
                    lines.append(f"> args: `{json.dumps(tc.arguments, default=str)}`")
                    if tc.result is not None:
                        lines.append(f"> result: `{json.dumps(tc.result, default=str)[:800]}`")
                    lines.append("")
            body = "\n".join(lines)
            resp = HttpResponse(body, content_type="text/markdown; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="session-{session.pk}.md"'
            return resp

        # JSON default
        payload = {
            "session": {
                "id": session.pk,
                "title": session.title,
                "status": session.status,
                "user": session.user.username,
                "is_shared": session.is_shared,
                "started_at": session.started_at.isoformat() if session.started_at else None,
                "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            },
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "input_tokens": m.input_tokens,
                    "output_tokens": m.output_tokens,
                    "created_at": m.created_at.isoformat(),
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "tool_name": tc.tool_name,
                            "arguments": tc.arguments,
                            "result": tc.result,
                            "status": tc.status,
                            "error_message": tc.error_message,
                            "duration_ms": tc.duration_ms,
                            "created_at": tc.created_at.isoformat(),
                        }
                        for tc in m.tool_calls.all()
                    ],
                }
                for m in messages
            ],
        }
        resp = HttpResponse(json.dumps(payload, indent=2, default=str), content_type="application/json")
        resp["Content-Disposition"] = f'attachment; filename="session-{session.pk}.json"'
        return resp

    @action(detail=False, methods=["get"], url_path="token-stats")
    def token_stats(self, request):
        """
        Return token usage totals.

        Response:
        {
          "all_time": {"input_tokens": int, "output_tokens": int, "total_tokens": int},
          "by_session": [{"session_id": int, "title": str, "input_tokens": int, "output_tokens": int, "total_tokens": int}, ...]
        }
        """
        user = request.user
        qs = AgentMessage.objects.filter(
            Q(session__user=user) | Q(session__participants=user),
            role="assistant",
        ).distinct()

        totals = qs.aggregate(
            input_tokens=Sum("input_tokens"),
            output_tokens=Sum("output_tokens"),
        )
        all_in = totals["input_tokens"] or 0
        all_out = totals["output_tokens"] or 0

        # Per-session breakdown
        from django.db.models import Sum as _Sum
        session_rows = (
            qs.values("session_id", "session__title")
            .annotate(input_tokens=_Sum("input_tokens"), output_tokens=_Sum("output_tokens"))
            .order_by("-session_id")
        )
        by_session = [
            {
                "session_id": r["session_id"],
                "title": r["session__title"] or f"Session {r['session_id']}",
                "input_tokens": r["input_tokens"] or 0,
                "output_tokens": r["output_tokens"] or 0,
                "total_tokens": (r["input_tokens"] or 0) + (r["output_tokens"] or 0),
            }
            for r in session_rows
        ]

        return Response({
            "all_time": {
                "input_tokens": all_in,
                "output_tokens": all_out,
                "total_tokens": all_in + all_out,
            },
            "by_session": by_session,
        })

    # `agent_stream` (30/min) was defined in DEFAULT_THROTTLE_RATES but never attached to
    # anything, so one POST here — which can run up to 11 model calls and dozens of tool
    # calls — counted only against the generic 200/min budget. Scoped on top of the
    # default user throttle, not instead of it.
    @action(
        detail=False, methods=["post"], url_path="send",
        throttle_classes=[UserRateThrottle, ScopedRateThrottle],
    )
    def send_message(self, request):
        """Send a message to the agent and stream the response."""
        serializer = AgentMessageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_message: str = serializer.validated_data["message"]
        session_id: int | None = serializer.validated_data.get("session_id")

        # Daily token budget: refuse *before* any work or any new session row. A turn already
        # streaming is never cut off — see agents/token_budget.py for the rules.
        budget = token_budget.gate_status(request.user)
        if budget.state == "blocked":
            token_budget.note_state(request.user, budget)
            return Response(
                {"detail": token_budget.blocked_message(budget), "code": "token_budget_blocked",
                 "budget": budget.as_dict()},
                status=status.HTTP_403_FORBIDDEN,
            )

        if session_id:
            try:
                session = AgentSession.objects.get(
                    Q(pk=session_id) & (Q(user=request.user) | Q(participants=request.user))
                )
            except AgentSession.DoesNotExist:
                return Response(
                    {"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND
                )
        else:
            session = AgentSession.objects.create(
                user=request.user,
                title=user_message[:80],
            )

        AgentMessage.objects.create(session=session, role="user", content=user_message)

        all_messages = list(session.messages.order_by("created_at"))
        # Only include user/assistant turns; skip any stored tool_result rows.
        # Also enforce alternating roles — Anthropic requires user/assistant/user/…
        raw_history = [
            {"role": msg.role, "content": msg.content}
            for msg in all_messages[:-1]
            if msg.role in ("user", "assistant")
        ]
        # Deduplicate consecutive same-role messages by merging their content.
        history: list[dict] = []
        for turn in raw_history:
            if history and history[-1]["role"] == turn["role"]:
                history[-1]["content"] += "\n" + turn["content"]
            else:
                history.append(turn)

        # An *async* generator is deliberate. Handing StreamingHttpResponse a sync
        # generator under ASGI makes Django fall back to sync_to_async(list), which
        # buffers the entire response before sending a single byte.
        async def _generate():
            orchestrator = AgentOrchestrator()
            full_response_parts: list[str] = []
            token_usage: dict = {"input_tokens": 0, "output_tokens": 0}

            try:
                async for item in orchestrator.run(user_message, history, user=request.user):
                    if isinstance(item, dict) and item.get("__token_usage__"):
                        token_usage["input_tokens"] = item["input_tokens"]
                        token_usage["output_tokens"] = item["output_tokens"]
                        # Send a usage frame the frontend can parse. The framing is a
                        # wire contract shared by several frontend call sites — extra
                        # keys are safe, changing the delimiters is not.
                        # Budget state *including this turn*, so the warning appears on the
                        # turn that crosses the line rather than one message later.
                        turn_state = await sync_to_async(token_budget.gate_status)(
                            request.user, item["input_tokens"] + item["output_tokens"])
                        if turn_state.state != "ok":
                            await sync_to_async(token_budget.note_state)(request.user, turn_state)
                        payload = json.dumps({
                            "input_tokens": item["input_tokens"],
                            "output_tokens": item["output_tokens"],
                            "model": item.get("model", ""),
                            "budget": turn_state.as_dict(),
                        })
                        yield f"\x00TOKEN_USAGE:{payload}\x00".encode()
                    else:
                        full_response_parts.append(item)
                        yield item.encode()
            except Exception as exc:
                ref = uuid.uuid4().hex[:8]
                logger.exception(
                    "Agent stream failed (session=%s ref=%s backend=%s model=%s)",
                    session.pk, ref, settings.AGENT_BACKEND,
                    getattr(orchestrator, "model", "?"),
                )
                yield f"\n{classify_agent_error(exc, ref)}".encode()
            finally:
                full_text = "".join(full_response_parts)
                if full_text:
                    # We are on the event loop now, so the ORM write must be wrapped.
                    # Guarded because this also runs during aclose() on client disconnect.
                    try:
                        await sync_to_async(AgentMessage.objects.create)(
                            session=session, role="assistant", content=full_text,
                            input_tokens=token_usage["input_tokens"],
                            output_tokens=token_usage["output_tokens"],
                        )
                    except Exception:
                        logger.exception(
                            "Could not persist assistant message for session %s", session.pk
                        )

        return StreamingHttpResponse(
            _generate(),
            content_type="text/event-stream",
            headers={"X-Session-Id": str(session.pk), "Cache-Control": "no-cache"},
        )


class AgentToolCatalogView(APIView):
    """
    GET /api/v1/agents/tools/ — the agent's tool registry, as the server enforces it.

    The Skills page used to hard-code its own tool list, which drifted from the registry
    (it still offered delete tools to skill authors after the server stopped allowing
    them). The page now renders from this. Read-only, and contains no secrets: it is the
    same names and one-line descriptions already sent to the model.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .mcp_server import mcp_server
        from .tool_policy import CONFIRM_REQUIRED

        safe = set(mcp_server.skill_safe_tools())
        tools = [
            {
                "name": name,
                "group": mcp_server.group_of(name),
                "description": description,
                "skill_safe": name in safe,
                "requires_confirmation": name in CONFIRM_REQUIRED,
            }
            for entries in mcp_server.grouped_catalog().values()
            for name, description in entries
        ]
        return Response({"tools": tools})


class UserListView(APIView):
    """Return all users except the requesting user, for the share-session picker."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .serializers import ParticipantSerializer
        users = User.objects.exclude(pk=request.user.pk).order_by("first_name", "last_name", "username")
        return Response(ParticipantSerializer(users, many=True).data)
