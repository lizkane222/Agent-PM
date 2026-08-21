"""
Tests for realtime.consumers.ConversationRelayConsumer.

These exercise the Twilio ConversationRelay WebSocket protocol end-to-end through
a channels WebsocketCommunicator backed by an InMemoryChannelLayer (prod uses
channels_redis, unavailable in tests). The three source bugs fixed alongside these
tests each have a dedicated guard:

  Bug 1 — inbound frames key on "type", not "event": test_old_event_shape_is_ignored.
  Bug 2 — VoiceTwiMLView must append relay_token: guarded in test_views.py.
  Bug 3 — early transcript turns are genuinely buffered until a browser subscriber
          announces itself: test_turns_are_buffered_until_subscriber_ready.

The consumer reaches Twilio Conversations and Bedrock through module-level async
wrappers (`realtime.consumers._create_voice_conversation` etc.) bound at import
time, so we patch those consumer attributes — not `conversations.*` — and patch
`realtime.llm.bedrock_stream` (imported lazily inside _handle_prompt).
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch

from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import TestCase, override_settings

from realtime.consumers import ConversationRelayConsumer

CALL_SID = "CA" + "f" * 32
CONV_SID = "CH" + "e" * 32

IN_MEMORY_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
}


def _make_fake_stream(tokens, recorder):
    """Build an async-generator stand-in for realtime.llm.bedrock_stream."""

    async def fake_stream(utterance, history):
        recorder.append((utterance, list(history)))
        for tok in tokens:
            yield tok

    return fake_stream


@override_settings(CHANNEL_LAYERS=IN_MEMORY_LAYERS)
class ConversationRelayConsumerTests(TestCase):
    """ConversationRelayConsumer protocol + buffering + auth-gate tests."""

    def setUp(self):
        # Each test runs in its own event loop; drop any cached InMemoryChannelLayer
        # so a fresh one is created inside that loop. Reusing a layer whose asyncio
        # queues were bound to a prior (now-closed) loop leaks "Event loop is closed"
        # warnings from pending receive() tasks.
        from channels.layers import channel_layers
        channel_layers.backends = {}

    def _run(self, coro):
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            # Cancel and drain anything the communicator / channel layer left pending
            # so closing the loop doesn't emit "Task was destroyed" warnings.
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            loop.close()

    # ------------------------------------------------------------------
    # relay_token gate (matches the token appended by VoiceTwiMLView)
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_connect_accepts_when_token_unset(self):
        async def inner():
            comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.disconnect()

        self._run(inner())

    @override_settings(VOICE_RELAY_TOKEN="s3cret")
    def test_connect_rejects_when_token_missing(self):
        async def inner():
            comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
            connected, code = await comm.connect()
            self.assertFalse(connected)
            self.assertEqual(code, 4001)

        self._run(inner())

    @override_settings(VOICE_RELAY_TOKEN="s3cret")
    def test_connect_rejects_when_token_wrong(self):
        async def inner():
            comm = WebsocketCommunicator(
                ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/?relay_token=nope"
            )
            connected, code = await comm.connect()
            self.assertFalse(connected)
            self.assertEqual(code, 4001)

        self._run(inner())

    @override_settings(VOICE_RELAY_TOKEN="s3cret")
    def test_connect_accepts_when_token_correct(self):
        async def inner():
            comm = WebsocketCommunicator(
                ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/?relay_token=s3cret"
            )
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.disconnect()

        self._run(inner())

    @override_settings(VOICE_RELAY_TOKEN="a b/c")
    def test_connect_accepts_url_encoded_token(self):
        # VoiceTwiMLView quotes the token; the consumer unquotes it before comparing.
        async def inner():
            comm = WebsocketCommunicator(
                ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/?relay_token=a%20b%2Fc"
            )
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.disconnect()

        self._run(inner())

    # ------------------------------------------------------------------
    # setup frame
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_setup_creates_conversation_and_joins_group(self):
        async def inner():
            create_mock = AsyncMock(return_value=CONV_SID)
            with patch("realtime.consumers._create_voice_conversation", new=create_mock), \
                 patch("realtime.consumers._close_voice_conversation", new=AsyncMock()), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                connected, _ = await comm.connect()
                self.assertTrue(connected)
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                # setup sends nothing back; awaiting pumps the app task.
                self.assertTrue(await comm.receive_nothing(timeout=0.5))
                await comm.disconnect()
            create_mock.assert_awaited_once_with(CALL_SID)

        self._run(inner())

    # ------------------------------------------------------------------
    # prompt frame → Bedrock stream → text token frames
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_prompt_streams_text_frames_and_persists_messages(self):
        async def inner():
            recorder = []
            fake_stream = _make_fake_stream(["Hello", " there"], recorder)
            add_mock = AsyncMock()
            with patch("realtime.consumers._create_voice_conversation", new=AsyncMock(return_value=CONV_SID)), \
                 patch("realtime.consumers._close_voice_conversation", new=AsyncMock()), \
                 patch("realtime.consumers._add_conversation_message", new=add_mock), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()), \
                 patch("realtime.llm.bedrock_stream", new=fake_stream):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                await comm.receive_nothing(timeout=0.3)

                await comm.send_to(text_data=json.dumps({
                    "type": "prompt", "voicePrompt": "hi", "lang": "en-US", "last": True,
                }))

                f1 = json.loads(await comm.receive_from())
                f2 = json.loads(await comm.receive_from())
                f3 = json.loads(await comm.receive_from())
                await comm.receive_nothing(timeout=0.3)  # let the post-stream tail run
                await comm.disconnect()

            self.assertEqual(f1, {"type": "text", "token": "Hello", "last": False})
            self.assertEqual(f2, {"type": "text", "token": " there", "last": False})
            self.assertEqual(f3, {"type": "text", "token": "", "last": True})

            # bedrock_stream saw the utterance with the (empty) history.
            self.assertEqual(recorder, [("hi", [])])

            # Customer turn then assistant turn archived to Conversations.
            authors = [c.args[1] for c in add_mock.await_args_list]
            bodies = [c.args[2] for c in add_mock.await_args_list]
            self.assertEqual(authors, ["customer", "agent-pm"])
            self.assertEqual(bodies, ["hi", "Hello there"])

        self._run(inner())

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_second_prompt_includes_prior_history(self):
        async def inner():
            recorder = []
            fake_stream = _make_fake_stream(["ok"], recorder)
            with patch("realtime.consumers._create_voice_conversation", new=AsyncMock(return_value=CONV_SID)), \
                 patch("realtime.consumers._close_voice_conversation", new=AsyncMock()), \
                 patch("realtime.consumers._add_conversation_message", new=AsyncMock()), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()), \
                 patch("realtime.llm.bedrock_stream", new=fake_stream):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                await comm.receive_nothing(timeout=0.3)

                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "one"}))
                for _ in range(2):  # two token frames (last:false + terminal last:true)
                    await comm.receive_from()
                await comm.receive_nothing(timeout=0.3)

                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "two"}))
                for _ in range(2):
                    await comm.receive_from()
                await comm.receive_nothing(timeout=0.3)
                await comm.disconnect()

            self.assertEqual(recorder[0], ("one", []))
            self.assertEqual(
                recorder[1],
                ("two", [{"role": "user", "content": "one"}, {"role": "assistant", "content": "ok"}]),
            )

        self._run(inner())

    # ------------------------------------------------------------------
    # Bug 3 — genuine buffering until subscriber_ready
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_turns_are_buffered_until_subscriber_ready(self):
        async def inner():
            fake_stream = _make_fake_stream(["Hello", " there"], [])
            group = f"voice_transcript_{CALL_SID}"
            with patch("realtime.consumers._create_voice_conversation", new=AsyncMock(return_value=CONV_SID)), \
                 patch("realtime.consumers._close_voice_conversation", new=AsyncMock()), \
                 patch("realtime.consumers._add_conversation_message", new=AsyncMock()), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()), \
                 patch("realtime.llm.bedrock_stream", new=fake_stream):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                await comm.receive_nothing(timeout=0.3)

                layer = get_channel_layer()
                await layer.group_add(group, "test-subscriber")

                # Drive a prompt — user + assistant turns are pushed while no
                # subscriber has announced itself, so they must be buffered.
                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "hi"}))
                for _ in range(3):
                    await comm.receive_from()  # drain the text frames
                await comm.receive_nothing(timeout=0.3)

                # Nothing reached the transcript group yet.
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(layer.receive("test-subscriber"), timeout=0.3)

                # Browser announces itself → buffered turns flush, in order.
                await layer.group_send(group, {"type": "transcript.subscriber_ready"})

                turns = []
                while len(turns) < 2:
                    msg = await asyncio.wait_for(layer.receive("test-subscriber"), timeout=1)
                    if msg.get("type") == "voice.turn":
                        turns.append(msg)
                await comm.disconnect()

            self.assertEqual(turns[0]["role"], "user")
            self.assertEqual(turns[0]["content"], "hi")
            self.assertEqual(turns[1]["role"], "assistant")
            self.assertEqual(turns[1]["content"], "Hello there")

        self._run(inner())

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_turns_sent_live_after_subscriber_ready(self):
        async def inner():
            fake_stream = _make_fake_stream(["done"], [])
            group = f"voice_transcript_{CALL_SID}"
            with patch("realtime.consumers._create_voice_conversation", new=AsyncMock(return_value=CONV_SID)), \
                 patch("realtime.consumers._close_voice_conversation", new=AsyncMock()), \
                 patch("realtime.consumers._add_conversation_message", new=AsyncMock()), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()), \
                 patch("realtime.llm.bedrock_stream", new=fake_stream):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                await comm.receive_nothing(timeout=0.3)

                layer = get_channel_layer()
                await layer.group_add(group, "test-subscriber")
                await layer.group_send(group, {"type": "transcript.subscriber_ready"})
                await comm.receive_nothing(timeout=0.3)  # let the relay mark ready

                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "q"}))
                for _ in range(2):
                    await comm.receive_from()

                turns = []
                while len(turns) < 2:
                    msg = await asyncio.wait_for(layer.receive("test-subscriber"), timeout=1)
                    if msg.get("type") == "voice.turn":
                        turns.append(msg)
                await comm.disconnect()

            self.assertEqual([t["role"] for t in turns], ["user", "assistant"])
            self.assertEqual(turns[1]["content"], "done")

        self._run(inner())

    # ------------------------------------------------------------------
    # graceful handling of the remaining frame types + malformed input
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_interrupt_dtmf_error_and_malformed_do_not_crash(self):
        async def inner():
            recorder = []
            fake_stream = _make_fake_stream(["ok"], recorder)
            with patch("realtime.consumers._create_voice_conversation", new=AsyncMock(return_value=CONV_SID)), \
                 patch("realtime.consumers._close_voice_conversation", new=AsyncMock()), \
                 patch("realtime.consumers._add_conversation_message", new=AsyncMock()), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()), \
                 patch("realtime.llm.bedrock_stream", new=fake_stream):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                await comm.receive_nothing(timeout=0.3)

                await comm.send_to(text_data=json.dumps({"type": "interrupt", "utteranceUntilInterrupt": "x"}))
                await comm.send_to(text_data=json.dumps({"type": "dtmf", "digit": "1"}))
                await comm.send_to(text_data=json.dumps({"type": "error", "description": "boom"}))
                await comm.send_to(text_data="{ not json")
                self.assertTrue(await comm.receive_nothing(timeout=0.4))

                # Consumer is still alive and processes a subsequent prompt normally.
                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "still here"}))
                frame = json.loads(await comm.receive_from())
                await comm.disconnect()

            self.assertEqual(frame["token"], "ok")
            self.assertEqual(recorder, [("still here", [])])

        self._run(inner())

    # ------------------------------------------------------------------
    # Bug 1 regression — the old {"event": ...} shape must be ignored
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_old_event_shape_is_ignored(self):
        async def inner():
            recorder = []
            fake_stream = _make_fake_stream(["ok"], recorder)
            create_mock = AsyncMock(return_value=CONV_SID)
            with patch("realtime.consumers._create_voice_conversation", new=create_mock), \
                 patch("realtime.consumers._add_conversation_message", new=AsyncMock()), \
                 patch("realtime.consumers._persist_conversation_sid", new=AsyncMock()), \
                 patch("realtime.llm.bedrock_stream", new=fake_stream):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                # Old protocol shape: keyed on "event", not "type".
                await comm.send_to(text_data=json.dumps({"event": "setup", "callSid": CALL_SID}))
                await comm.send_to(text_data=json.dumps({"event": "prompt", "voicePrompt": "hi"}))
                self.assertTrue(await comm.receive_nothing(timeout=0.5))
                await comm.disconnect()

            create_mock.assert_not_awaited()
            self.assertEqual(recorder, [])

        self._run(inner())

    # ------------------------------------------------------------------
    # disconnect closes + persists the Conversations thread
    # ------------------------------------------------------------------

    @override_settings(VOICE_RELAY_TOKEN="")
    def test_disconnect_closes_and_persists_conversation(self):
        async def inner():
            close_mock = AsyncMock()
            persist_mock = AsyncMock()
            with patch("realtime.consumers._create_voice_conversation", new=AsyncMock(return_value=CONV_SID)), \
                 patch("realtime.consumers._close_voice_conversation", new=close_mock), \
                 patch("realtime.consumers._persist_conversation_sid", new=persist_mock):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"type": "setup", "callSid": CALL_SID}))
                await comm.receive_nothing(timeout=0.3)
                await comm.disconnect()

            close_mock.assert_awaited_once_with(CONV_SID)
            persist_mock.assert_any_await(CALL_SID, CONV_SID)

        self._run(inner())
