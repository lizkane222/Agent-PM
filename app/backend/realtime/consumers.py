"""
Django Channels WebSocket consumers for real-time chat and agent streaming.
"""

import asyncio
import hmac
import json
import logging
import urllib.parse

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, AsyncWebsocketConsumer

from agents.models import AgentSession
from . import conversations as conv_api
from .voice_agent import VoiceAgent, dispatch_confirmed
from .voice_identity import (
    IDENTITY_PARAM,
    REASON_USER_INACTIVE,
    IdentityError,
    load_user,
    read_identity_token,
)
from .voice_persistence import (
    append_transcript,
    attach_user_to_voice_session,
    close_agent_session,
    load_skill_inventory,
    open_agent_session,
    record_message,
    record_tool_calls,
)
from .voice_policy import (
    MAX_UNCLEAR_ASKS,
    VoiceTurnState,
    classify_dtmf,
    classify_reply,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Async wrappers for sync Twilio REST calls
# ---------------------------------------------------------------------------

_create_voice_conversation = sync_to_async(conv_api.create_voice_conversation)
_add_conversation_message = sync_to_async(conv_api.add_conversation_message)
_close_voice_conversation = sync_to_async(conv_api.close_voice_conversation)


@database_sync_to_async
def _persist_conversation_sid(call_sid: str, conversation_sid: str) -> None:
    """Write conversation_sid back to VoiceSession if it exists (best-effort)."""
    from realtime.models import VoiceSession  # noqa: PLC0415
    VoiceSession.objects.filter(call_sid=call_sid).update(conversation_sid=conversation_sid)


@database_sync_to_async
def _get_session_for_user(session_id, user):
    """Return the AgentSession if it belongs to user, else raise AgentSession.DoesNotExist."""
    return AgentSession.objects.get(pk=session_id, user=user)


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for the main chat interface.

    Clients connect to ws://<host>/ws/chat/<session_id>/
    Messages received here are broadcast to the session group so multiple
    tabs / users can observe the same conversation in real time.
    """

    async def connect(self):
        self.session_id = self.scope["url_route"]["kwargs"]["session_id"]
        self.group_name = f"chat_{self.session_id}"

        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4001)
            return

        try:
            await _get_session_for_user(self.session_id, user)
        except AgentSession.DoesNotExist:
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info("ChatConsumer connected: session=%s user=%s", self.session_id, user.pk)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        """Handle an incoming message from the browser."""
        message_type = content.get("type")

        if message_type == "chat.message":
            # Broadcast to all members of the group.
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "chat.message",
                    "message": content.get("message", ""),
                    "sender_id": self.scope["user"].pk,
                },
            )

    async def chat_message(self, event):
        """Handler for group_send events of type 'chat.message'."""
        await self.send_json(
            {
                "type": "chat.message",
                "message": event["message"],
                "sender_id": event["sender_id"],
            }
        )


class AgentStreamConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer that streams agent token output to the browser.

    Clients connect to ws://<host>/ws/agent-stream/<session_id>/
    The backend pushes token chunks as they arrive from Claude.
    """

    async def connect(self):
        self.session_id = self.scope["url_route"]["kwargs"]["session_id"]
        self.group_name = f"agent_stream_{self.session_id}"

        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4001)
            return

        try:
            await _get_session_for_user(self.session_id, user)
        except AgentSession.DoesNotExist:
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Browser-to-agent messages are handled via the REST API; this consumer
        # is write-only from server to client.
        pass

    async def agent_token(self, event):
        """Push a streamed token chunk to the browser."""
        await self.send_json(
            {
                "type": "agent.token",
                "token": event.get("token", ""),
                "done": event.get("done", False),
            }
        )

    async def agent_tool_call(self, event):
        """Notify the browser that a tool call is being made."""
        await self.send_json(
            {
                "type": "agent.tool_call",
                "tool_name": event.get("tool_name", ""),
                "arguments": event.get("arguments", {}),
            }
        )

    async def agent_tool_result(self, event):
        """Notify the browser that a tool call completed."""
        await self.send_json(
            {
                "type": "agent.tool_result",
                "tool_name": event.get("tool_name", ""),
                "success": event.get("success", True),
            }
        )


class MeetingNotesConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for collaborative meeting notes.

    Connect: ws://<host>/ws/meeting-notes/<event_id>/
    All authenticated users connected to the same event_id receive note
    create/update/delete broadcasts pushed by the REST API via channel groups.
    """

    async def connect(self):
        self.event_id = self.scope["url_route"]["kwargs"]["event_id"]
        self.group_name = f"meeting_notes_{self.event_id}"

        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Mutations go through the REST API; this socket is receive-only for now.
        pass

    async def note_update(self, event):
        """Relay a note create/update/delete broadcast to all connected clients."""
        await self.send_json({
            "type": "note.update",
            "action": event["action"],
            "note": event["note"],
        })


class VoiceTranscriptConsumer(AsyncJsonWebsocketConsumer):
    """
    Authenticated WebSocket that relays live voice transcript turns to the browser.

    The browser connects at ws://<host>/ws/voice-transcript/<call_sid>/ after
    the call is accepted. ConversationRelayConsumer pushes each turn to the
    voice_transcript_<call_sid> group; this consumer forwards them to the browser.
    """

    async def connect(self):
        self.call_sid = self.scope["url_route"]["kwargs"]["call_sid"]
        self.group_name = f"voice_transcript_{self.call_sid}"

        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        # Tell the relay consumer (also in this group) that a browser subscriber
        # is now listening, so it flushes any turns buffered before we joined.
        await self.channel_layer.group_send(
            self.group_name, {"type": "transcript.subscriber_ready"}
        )
        logger.info("VoiceTranscriptConsumer connected: call_sid=%s user=%s", self.call_sid, user.pk)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        pass

    async def voice_turn(self, event):
        """Forward a transcript turn from the relay consumer to the browser."""
        await self.send_json({
            "type": "voice.turn",
            "role": event["role"],
            "content": event["content"],
        })

    async def transcript_subscriber_ready(self, event):
        # This consumer is a group member, so it receives the readiness ping it
        # sends on connect. Nothing to do here — the ping is for the relay consumer.
        pass


class ConversationRelayConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for Twilio ConversationRelay.

    Twilio connects here after the browser initiates a Voice SDK call and our
    TwiML returns <Connect><ConversationRelay>. The protocol is JSON frames:

    Inbound (Twilio → us) — every frame is keyed on "type":
      {"type": "setup", "callSid": "...", "customParameters": {...}, ...}
      {"type": "prompt", "voicePrompt": "<transcribed utterance>", "lang": "en-US", "last": true}
      {"type": "dtmf", "digit": "1"}
      {"type": "interrupt", "utteranceUntilInterrupt": "...", "durationUntilInterruptMs": 460}
      {"type": "error", "description": "..."}

    Outbound (us → Twilio):
      {"type": "text", "token": "<text chunk>", "last": false}
      {"type": "text", "token": "<final chunk>", "last": true}

    We pipe each transcribed utterance through Claude via AWS Bedrock and stream
    the text response back as token chunks so Twilio's TTS speaks them as
    they arrive (low latency).
    """

    async def connect(self):
        from django.conf import settings as django_settings

        expected_token = getattr(django_settings, "VOICE_RELAY_TOKEN", "")
        if expected_token:
            query_string = self.scope.get("query_string", b"").decode()
            params = dict(pair.split("=", 1) for pair in query_string.split("&") if "=" in pair)
            provided = urllib.parse.unquote(params.get("relay_token", ""))
            if not hmac.compare_digest(provided, expected_token):
                await self.close(code=4001)
                return

        await self.accept()
        # Anthropic-format message history for the whole call, including tool_use /
        # tool_result blocks. VoiceAgent mutates it in place, one turn at a time.
        self._messages: list[dict] = []
        self._call_sid: str = ""
        self._group: str = ""
        self._conversation_sid: str = ""
        # Turns that arrive before the browser transcript WS has joined the group
        # are buffered here and flushed once it announces itself via
        # transcript_subscriber_ready, so early turns are never dropped.
        self._pending_turns: list[dict] = []
        self._subscriber_ready: bool = False
        # Voice identity / session state, all populated on the setup frame.
        self._user = None
        self._identity_error: str = ""
        self._agent_session_id: int | None = None
        self._skill_inventory: str = ""
        self._state = VoiceTurnState()
        logger.info("ConversationRelay connected")

    async def disconnect(self, close_code):
        if self._group:
            await self.channel_layer.group_discard(self._group, self.channel_name)
        if self._conversation_sid:
            await _close_voice_conversation(self._conversation_sid)
            # Persist SID on disconnect — VoiceSession is guaranteed to exist
            # by this point because the status callback fires before/with hangup.
            await _persist_conversation_sid(self._call_sid, self._conversation_sid)
        if self._agent_session_id:
            await close_agent_session(self._agent_session_id)
        logger.info("ConversationRelay disconnected: call_sid=%s code=%s", self._call_sid, close_code)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            msg = json.loads(text_data)
        except json.JSONDecodeError:
            return

        # Twilio ConversationRelay keys every inbound frame on "type".
        msg_type = msg.get("type", "")

        if msg_type == "setup":
            await self._handle_setup(msg)

        elif msg_type == "prompt":
            utterance = msg.get("voicePrompt", "").strip()
            if not utterance:
                return
            logger.info("ConversationRelay prompt [%s]: %r", self._call_sid, utterance)
            await self._handle_prompt(utterance)

        elif msg_type == "interrupt":
            # Caller talked over TTS playback. Nothing to unwind server-side —
            # Twilio stops playback for us; we just note it.
            logger.info("ConversationRelay interrupt [%s]", self._call_sid)

        elif msg_type == "dtmf":
            await self._handle_dtmf(msg.get("digit", ""))

        elif msg_type == "error":
            logger.warning(
                "ConversationRelay error [%s]: %s", self._call_sid, msg.get("description", "")
            )

    async def _push_turn(self, role: str, content: str) -> None:
        """Broadcast a transcript turn to browser subscribers.

        If no browser has joined the transcript group yet, buffer the turn until
        one announces itself via transcript_subscriber_ready — group_send is
        silently dropped when the group has no members, so sending eagerly would
        lose every turn that precedes the browser's connection.
        """
        if not self._group:
            return
        turn = {"type": "voice.turn", "role": role, "content": content}
        if not self._subscriber_ready:
            self._pending_turns.append(turn)
            return
        await self.channel_layer.group_send(self._group, turn)

    async def transcript_subscriber_ready(self, event):
        """A browser transcript socket joined the group — flush buffered turns."""
        self._subscriber_ready = True
        pending, self._pending_turns = self._pending_turns, []
        for turn in pending:
            await self.channel_layer.group_send(self._group, turn)

    # ── setup: identity, session, skill inventory ─────────────────────────────

    async def _handle_setup(self, msg: dict) -> None:
        self._call_sid = msg.get("callSid", "")
        self._group = f"voice_transcript_{self._call_sid}"
        await self.channel_layer.group_add(self._group, self.channel_name)
        logger.info("ConversationRelay setup: call_sid=%s", self._call_sid)

        token = (msg.get("customParameters") or {}).get(IDENTITY_PARAM, "")
        try:
            user_pk = read_identity_token(token, self._call_sid)
        except IdentityError as exc:
            await self._end_call_unverified(exc.reason)
            return

        user = await load_user(user_pk)
        if user is None:
            await self._end_call_unverified(REASON_USER_INACTIVE)
            return

        self._user = user
        # VoiceSession.user — set here for the first time, which is what makes
        # VoiceSessionViewSet return rows and the status callback's Sync publish fire.
        await attach_user_to_voice_session(self._call_sid, user)
        self._agent_session_id = await open_agent_session(user, self._call_sid)
        self._skill_inventory = await load_skill_inventory(user)

        # Create a Conversations thread to persist the full voice transcript.
        try:
            self._conversation_sid = await _create_voice_conversation(self._call_sid)
            # Best-effort early save; definitive save happens on disconnect.
            await _persist_conversation_sid(self._call_sid, self._conversation_sid)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "ConversationRelay: failed to create Conversations thread for %s: %s",
                self._call_sid, exc,
            )

    async def _end_call_unverified(self, reason: str) -> None:
        """
        Say one sentence and hang up when the caller cannot be identified.

        Deliberately *not* a fall-through to a tool-less chat. With no user every
        tool returns empty or "not authorized" and the model confabulates around it
        ("I don't see any action items"), which is worse than an error — and a silent
        tool-less mode would mask a broken identity path in production indefinitely.
        The welcomeGreeting has already played, so saying nothing would read as a hang.
        """
        self._identity_error = reason
        logger.warning(
            "ConversationRelay: unverified caller on %s (%s) — ending call",
            self._call_sid, reason,
        )
        await self.send(text_data=json.dumps({
            "type": "text",
            "token": (
                "Sorry — I couldn't verify your account, so I can't reach your "
                "workspace. Please reload the page and start the voice session again."
            ),
            "last": True,
        }))
        # The reason travels in handoffData so it shows up in Twilio's call logs —
        # the only observability available for a call that never reached the database.
        await self.send(text_data=json.dumps({
            "type": "end",
            "handoffData": json.dumps({"reason": f"identity_unresolved:{reason}"}),
        }))

    # ── prompt ────────────────────────────────────────────────────────────────

    async def _handle_prompt(self, utterance: str) -> None:
        """Route one caller utterance: confirmation reply first, otherwise a full turn."""
        if self._identity_error:
            return

        await self._push_turn("user", utterance)
        if self._conversation_sid:
            await _add_conversation_message(self._conversation_sid, "customer", utterance)
        await append_transcript(self._call_sid, "user", utterance)
        await record_message(self._agent_session_id, "user", utterance)

        now = asyncio.get_running_loop().time()
        if self._state.expire(now):
            logger.info("ConversationRelay: pending confirmation expired on %s", self._call_sid)

        pending = self._state.pending
        if pending is not None:
            reply = classify_reply(utterance)
            if reply == "affirm":
                await self._run_confirmed(pending)
                return
            if reply == "deny":
                await self._run_declined(pending)
                return

            pending.asks += 1
            if pending.asks < MAX_UNCLEAR_ASKS:
                # Re-ask verbatim with no model call — zero added latency at the most
                # safety-critical moment in the call.
                await self._speak_once(pending.question())
                return
            # Two strikes: never leave the caller stuck in a confirmation loop. Drop
            # the pending action and treat this utterance as a fresh request.
            logger.info(
                "ConversationRelay: dropping unclear confirmation for '%s' on %s",
                pending.tool_name, self._call_sid,
            )
            self._state.clear()

        await self._run_agent_turn(utterance)

    async def _handle_dtmf(self, digit: str) -> None:
        """
        A keypress answer to a pending confirmation.

        DTMF is the reliable half of the gate: over a lossy speech channel a keypress
        beats ASR for an irreversible action, which is why the spoken prompt offers it.
        """
        logger.info("ConversationRelay dtmf [%s]: %s", self._call_sid, digit)
        if self._identity_error:
            return

        if self._state.expire(asyncio.get_running_loop().time()):
            logger.info("ConversationRelay: pending confirmation expired on %s", self._call_sid)

        pending = self._state.pending
        if pending is None:
            return

        reply = classify_dtmf(digit)
        if reply == "affirm":
            await self._run_confirmed(pending)
        elif reply == "deny":
            await self._run_declined(pending)
        # Any other digit is ignored and the pending confirmation survives.

    # ── confirmation outcomes ─────────────────────────────────────────────────

    async def _run_confirmed(self, pending) -> None:
        """
        Execute the confirmed tool, then have the model report what happened.

        The tool is dispatched directly, bypassing the model, so it cannot alter the
        arguments between the question the caller answered and the action taken.
        """
        result, record = await dispatch_confirmed(
            pending.tool_name, pending.arguments, self._user
        )
        self._state.clear()
        message_id = await record_message(
            self._agent_session_id, "tool_result", f"{pending.tool_name}: {record.status}"
        )
        await record_tool_calls(message_id, [record])

        payload = json.dumps(result, default=str) if record.status == "success" else record.status
        await self._run_agent_turn(
            f"[system] The user confirmed. Result of {pending.tool_name}: {payload}. "
            f"Tell them what happened in one short sentence."
        )

    async def _run_declined(self, pending) -> None:
        self._state.clear()
        logger.info(
            "ConversationRelay: caller declined '%s' on %s", pending.tool_name, self._call_sid
        )
        await self._run_agent_turn(
            f"[system] The user declined the {pending.tool_name} action. "
            f"Acknowledge briefly and stop."
        )

    async def _speak_once(self, text: str) -> None:
        """Send one complete utterance: the text, then its terminator."""
        await self.send(text_data=json.dumps({"type": "text", "token": text, "last": False}))
        await self.send(text_data=json.dumps({"type": "text", "token": "", "last": True}))
        await self._push_turn("assistant", text)

    # ── the agent turn ────────────────────────────────────────────────────────

    async def _run_agent_turn(self, model_input: str) -> None:
        """
        Drive one VoiceAgent turn, forwarding its events to Twilio and the browser.

        `model_input` is what the model sees; it is not pushed to the transcript —
        the caller's own words were already pushed by _handle_prompt, and an injected
        "[system] ..." turn is machinery, not something the caller said.
        """
        agent = VoiceAgent(
            user=self._user,
            state=self._state,
            skill_inventory=self._skill_inventory,
        )
        spoken_parts: list[str] = []
        usage: dict = {}
        terminated = False

        try:
            async for event in agent.run_turn(model_input, self._messages):
                if event.kind == "speak":
                    spoken_parts.append(event.text)
                    await self.send(text_data=json.dumps({
                        "type": "text",
                        "token": event.text,
                        "last": False,
                        # Filler is pre-emptible so the real answer interrupts it
                        # rather than queueing behind it.
                        **({"preemptible": True} if event.preemptible else {}),
                    }))
                elif event.kind == "end_utterance":
                    terminated = True
                    await self.send(text_data=json.dumps({
                        "type": "text", "token": "", "last": True,
                    }))
                elif event.kind == "usage":
                    usage = event.payload or {}
        except Exception as exc:  # noqa: BLE001
            logger.exception("ConversationRelay error during prompt handling: %s", exc)
            # A stranded last:false frame leaves Twilio's TTS buffer waiting forever,
            # wedging every later utterance in the call — so always terminate.
            await self.send(text_data=json.dumps({
                "type": "text",
                "token": "Sorry, I encountered an error. Please try again.",
                "last": True,
            }))
            terminated = True
        finally:
            if not terminated:
                await self.send(text_data=json.dumps({
                    "type": "text", "token": "", "last": True,
                }))
            await self._finish_turn(agent, "".join(spoken_parts), usage)

    async def _finish_turn(self, agent, full_response: str, usage: dict) -> None:
        """Persist the assistant turn and the tool calls it made."""
        if full_response:
            await self._push_turn("assistant", full_response)
            if self._conversation_sid:
                await _add_conversation_message(
                    self._conversation_sid, "agent-pm", full_response
                )
            await append_transcript(self._call_sid, "assistant", full_response)

        message_id = await record_message(
            self._agent_session_id,
            "assistant",
            full_response,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
        )
        # ToolCall rows are written here, at turn end, because the assistant message
        # they link to does not exist while the tools are running. If the turn raised,
        # message_id is None — which is exactly what the nullable FK is for.
        if agent.records:
            await record_tool_calls(message_id, agent.records)

    # Required by Channels even though the relay consumer doesn't receive group messages.
    async def voice_turn(self, event):
        pass
