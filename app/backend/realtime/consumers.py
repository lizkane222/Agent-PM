"""
Django Channels WebSocket consumers for real-time chat and agent streaming.
"""

import hmac
import json
import logging
import urllib.parse

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, AsyncWebsocketConsumer

from agents.models import AgentSession
from . import conversations as conv_api

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


class ConversationRelayConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for Twilio ConversationRelay.

    Twilio connects here after the browser initiates a Voice SDK call and our
    TwiML returns <Connect><ConversationRelay>. The protocol is JSON frames:

    Inbound (Twilio → us):
      {"event": "prompt", "voicePrompt": "<transcribed utterance>"}
      {"event": "interrupt"}
      {"event": "setup", "callSid": "...", ...}

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
        self._history: list[dict] = []
        self._call_sid: str = ""
        self._group: str = ""
        self._conversation_sid: str = ""
        # Turns that arrive before the browser WS has joined the group are
        # buffered here and flushed on the next group_send so nothing is lost.
        self._pending_turns: list[dict] = []
        logger.info("ConversationRelay connected")

    async def disconnect(self, close_code):
        if self._group:
            await self.channel_layer.group_discard(self._group, self.channel_name)
        if self._conversation_sid:
            await _close_voice_conversation(self._conversation_sid)
            # Persist SID on disconnect — VoiceSession is guaranteed to exist
            # by this point because the status callback fires before/with hangup.
            await _persist_conversation_sid(self._call_sid, self._conversation_sid)
        logger.info("ConversationRelay disconnected: call_sid=%s code=%s", self._call_sid, close_code)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            msg = json.loads(text_data)
        except json.JSONDecodeError:
            return

        event = msg.get("event", "")

        if event == "setup":
            self._call_sid = msg.get("callSid", "")
            self._group = f"voice_transcript_{self._call_sid}"
            await self.channel_layer.group_add(self._group, self.channel_name)
            logger.info("ConversationRelay setup: call_sid=%s", self._call_sid)
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

        elif event == "prompt":
            utterance = msg.get("voicePrompt", "").strip()
            if not utterance:
                return
            logger.info("ConversationRelay prompt [%s]: %r", self._call_sid, utterance)
            await self._handle_prompt(utterance)

        elif event == "interrupt":
            pass

    async def _push_turn(self, role: str, content: str) -> None:
        """Broadcast a transcript turn to browser subscribers."""
        if not self._group:
            return
        turn = {"type": "voice.turn", "role": role, "content": content}
        self._pending_turns.append(turn)
        for queued in self._pending_turns:
            await self.channel_layer.group_send(self._group, queued)
        self._pending_turns.clear()

    async def _handle_prompt(self, utterance: str) -> None:
        """Stream a Claude Bedrock response for the utterance, push transcript to browser."""
        from .llm import bedrock_stream

        # Push user utterance to browser immediately.
        await self._push_turn("user", utterance)

        # Persist customer turn to Conversations.
        if self._conversation_sid:
            await _add_conversation_message(self._conversation_sid, "customer", utterance)

        full_response = ""

        try:
            async for chunk in bedrock_stream(utterance, self._history):
                full_response += chunk
                await self.send(text_data=json.dumps({
                    "type": "text",
                    "token": chunk,
                    "last": False,
                }))

            await self.send(text_data=json.dumps({
                "type": "text",
                "token": "",
                "last": True,
            }))

        except Exception as exc:
            logger.exception("ConversationRelay error during prompt handling: %s", exc)
            await self.send(text_data=json.dumps({
                "type": "text",
                "token": "Sorry, I encountered an error. Please try again.",
                "last": True,
            }))
            return

        # Push completed assistant response to browser.
        await self._push_turn("assistant", full_response)

        # Persist assistant turn to Conversations.
        if self._conversation_sid and full_response:
            await _add_conversation_message(self._conversation_sid, "agent-pm", full_response)

        self._history.append({"role": "user", "content": utterance})
        self._history.append({"role": "assistant", "content": full_response})

    # Required by Channels even though the relay consumer doesn't receive group messages.
    async def voice_turn(self, event):
        pass
