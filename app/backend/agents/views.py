"""API views for the agents app."""

import asyncio
import json
import logging

from django.contrib.auth import get_user_model
from django.db.models import Q, Sum
from django.http import HttpResponse, StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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


class AgentSessionViewSet(viewsets.ModelViewSet):
    """CRUD for agent conversation sessions."""

    serializer_class = AgentSessionSerializer
    permission_classes = [IsAuthenticated]

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

    @action(detail=False, methods=["post"], url_path="send")
    def send_message(self, request):
        """Send a message to the agent and stream the response."""
        serializer = AgentMessageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_message: str = serializer.validated_data["message"]
        session_id: int | None = serializer.validated_data.get("session_id")

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

        def _generate():
            import json as _json
            orchestrator = AgentOrchestrator()
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            full_response_parts = []
            token_usage: dict = {"input_tokens": 0, "output_tokens": 0}
            queue: asyncio.Queue = asyncio.Queue()

            async def _run_into_queue():
                try:
                    async for item in orchestrator.run(user_message, history, user=request.user):
                        await queue.put(item)
                finally:
                    await queue.put(None)

            async def _drain():
                task = asyncio.ensure_future(_run_into_queue())
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    yield item
                await task

            try:
                gen = _drain()
                while True:
                    try:
                        item = loop.run_until_complete(gen.__anext__())
                        if isinstance(item, dict) and item.get("__token_usage__"):
                            token_usage["input_tokens"] = item["input_tokens"]
                            token_usage["output_tokens"] = item["output_tokens"]
                            # Send a usage frame the frontend can parse.
                            payload = _json.dumps({"input_tokens": item["input_tokens"], "output_tokens": item["output_tokens"]})
                            yield f"\x00TOKEN_USAGE:{payload}\x00".encode()
                        else:
                            full_response_parts.append(item)
                            yield item.encode()
                    except StopAsyncIteration:
                        break
            except Exception:
                import traceback
                import sys
                traceback.print_exc(file=sys.stderr)
                logger.exception("Error in agent _generate() for session %s", session.pk)
                yield b"\n[Agent error - check server logs]"
            finally:
                full_text = "".join(full_response_parts)
                if full_text:
                    AgentMessage.objects.create(
                        session=session, role="assistant", content=full_text,
                        input_tokens=token_usage["input_tokens"],
                        output_tokens=token_usage["output_tokens"],
                    )
                loop.close()

        return StreamingHttpResponse(
            _generate(),
            content_type="text/event-stream",
            headers={"X-Session-Id": str(session.pk), "Cache-Control": "no-cache"},
        )


class UserListView(APIView):
    """Return all users except the requesting user, for the share-session picker."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .serializers import ParticipantSerializer
        users = User.objects.exclude(pk=request.user.pk).order_by("first_name", "last_name", "username")
        return Response(ParticipantSerializer(users, many=True).data)
