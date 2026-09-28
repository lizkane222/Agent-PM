"""
Tests for realtime.consumers.ConversationRelayConsumer.

These exercise the Twilio ConversationRelay WebSocket protocol end-to-end through
a channels WebsocketCommunicator backed by an InMemoryChannelLayer (prod uses
channels_redis, unavailable in tests). The three source bugs fixed alongside these
tests each still have a dedicated guard:

  Bug 1 — inbound frames key on "type", not "event": test_old_event_shape_is_ignored.
  Bug 2 — VoiceTwiMLView must append relay_token: guarded in test_views.py.
  Bug 3 — early transcript turns are genuinely buffered until a browser subscriber
          announces itself: test_turns_are_buffered_until_subscriber_ready.

The consumer reaches Twilio Conversations through module-level async wrappers
(`realtime.consumers._create_voice_conversation` etc.) bound at import time, so we
patch those consumer attributes — not `conversations.*`.

Claude is reached through `realtime.consumers.VoiceAgent`, which is patched with a
scripted fake (`_FakeAgent`). The previous version of this file patched
`realtime.llm.bedrock_stream`; that module is deleted, and with it the retired model
id it was pinned to.

**Every test must complete setup with a valid identity token.** The consumer now ends
any call it cannot attribute to a Django user, so a setup frame without one hangs up
instead of proceeding — see IdentityGateTests for that path specifically.
"""

import asyncio
import contextlib
import json
from unittest.mock import AsyncMock, patch

from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings

from agents.models import AgentSession, ToolCall
from realtime.consumers import ConversationRelayConsumer
from realtime.models import VoiceSession
from realtime.voice_agent import VoiceEvent
from realtime.voice_identity import mint_identity_token
from realtime.voice_persistence import ToolCallRecord

User = get_user_model()

CALL_SID = "CA" + "f" * 32
OTHER_CALL_SID = "CA" + "0" * 32
CONV_SID = "CH" + "e" * 32

IN_MEMORY_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
}

VOICE_SETTINGS = dict(
    VOICE_RELAY_TOKEN="",
    VOICE_IDENTITY_MAX_AGE=120,
    VOICE_CONFIRM_TTL_SECONDS=90,
    VOICE_TOOL_TIMEOUT_SECONDS=8,
)


class _FakeAgent:
    """
    Stands in for VoiceAgent. `script` is a list of VoiceEvents to emit per turn.

    Records every (model_input, messages-snapshot) so tests can assert what the model
    was asked and that history accumulates across turns.
    """

    calls: list = []
    scripts: list = []
    records_per_turn: list = []
    constructed: list = []

    def __init__(self, *, user, state=None, skill_inventory="", client=None, model=None):
        self.user = user
        self.state = state
        self.skill_inventory = skill_inventory
        self.records: list[ToolCallRecord] = []
        type(self).constructed.append(self)

    async def run_turn(self, model_input, messages):
        type(self).calls.append((model_input, list(messages)))
        messages.append({"role": "user", "content": model_input})
        script = (
            type(self).scripts.pop(0)
            if type(self).scripts
            else [VoiceEvent("speak", text="ok"), VoiceEvent("end_utterance")]
        )
        if type(self).records_per_turn:
            self.records = type(self).records_per_turn.pop(0)
        spoken = "".join(
            e.text for e in script
            if isinstance(e, VoiceEvent) and e.kind == "speak"
        )
        for event in script:
            if isinstance(event, Exception):
                raise event
            yield event
        messages.append({"role": "assistant", "content": spoken})
        yield VoiceEvent("usage", payload={"input_tokens": 3, "output_tokens": 2})

    @classmethod
    def reset(cls):
        cls.calls = []
        cls.scripts = []
        cls.records_per_turn = []
        cls.constructed = []


def _speak(*chunks):
    """A normal turn: some text chunks then one terminator."""
    return [VoiceEvent("speak", text=c) for c in chunks] + [VoiceEvent("end_utterance")]


@override_settings(CHANNEL_LAYERS=IN_MEMORY_LAYERS, **VOICE_SETTINGS)
class _RelayTestBase(TransactionTestCase):
    """
    Shared event-loop plumbing, patching and a setup helper.

    TransactionTestCase, not TestCase: the consumer writes through
    @database_sync_to_async, which runs in asgiref's executor thread. TestCase wraps
    each test in an atomic block held by the test thread, and SQLite then answers the
    consumer's INSERT with "database table is locked: auth_user". Committing for real
    and flushing afterwards is the standard remedy for Channels consumer tests that
    touch the database.
    """

    def setUp(self):
        # Each test runs in its own event loop; drop any cached InMemoryChannelLayer
        # so a fresh one is created inside that loop. Reusing a layer whose asyncio
        # queues were bound to a prior (now-closed) loop leaks "Event loop is closed"
        # warnings from pending receive() tasks.
        from channels.layers import channel_layers
        channel_layers.backends = {}
        _FakeAgent.reset()
        self.user = User.objects.create_user("relay-caller", password="pass")

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

    @contextlib.contextmanager
    def _patches(self, agent=None, **extra):
        """
        Patch every consumer boundary at once and yield the mocks by name.

        An ExitStack rather than a tuple of context managers: a with-statement cannot
        unpack, so `with patch(...), *self._patches():` is a SyntaxError.
        """
        mocks = {
            "_create_voice_conversation": AsyncMock(return_value=CONV_SID),
            "_close_voice_conversation": AsyncMock(),
            "_add_conversation_message": AsyncMock(),
            "_persist_conversation_sid": AsyncMock(),
        }
        mocks.update(extra)
        with contextlib.ExitStack() as stack:
            stack.enter_context(
                patch("realtime.consumers.VoiceAgent", new=agent or _FakeAgent)
            )
            for name, mock in mocks.items():
                stack.enter_context(patch(f"realtime.consumers.{name}", new=mock))
            yield mocks

    async def _drain_frames(self, comm, settle=0.4):
        """
        Collect every outbound frame, stopping after `settle` seconds of quiet.

        Never lets receive_from() time out: asgiref's receive_output() *cancels the
        application task* when its timeout expires, which kills the consumer
        mid-test and surfaces later as a CancelledError from disconnect().
        receive_nothing() only polls, so it is safe to use as the loop guard.
        """
        frames = []
        while not await comm.receive_nothing(timeout=settle):
            frames.append(json.loads(await comm.receive_from(timeout=1)))
        return frames

    def _setup_frame(self, call_sid=CALL_SID, token=None, user=None):
        """A setup frame carrying a valid identity token by default."""
        pk = (user or self.user).pk
        value = mint_identity_token(pk, call_sid) if token is None else token
        frame = {"type": "setup", "callSid": call_sid}
        if value is not None:
            frame["customParameters"] = {"identity_token": value}
        return json.dumps(frame)


class RelayTokenGateTests(_RelayTestBase):
    """The pre-shared relay token that proves the socket came from Twilio."""

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


class IdentityGateTests(_RelayTestBase):
    """
    A call the consumer cannot attribute to a Django user is ended, not degraded.

    Degrading to a tool-less chat would mean every tool returns empty and the model
    confabulates around it, and would mask a broken identity path in production.
    """

    def _drive_setup(self, frame):
        async def inner():
            create_mock = AsyncMock(return_value=CONV_SID)
            with self._patches(_create_voice_conversation=create_mock):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=frame)
                frames = await self._drain_frames(comm)
                # A prompt after the hangup must be ignored, not answered.
                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "hi"}))
                await comm.receive_nothing(timeout=0.3)
                await comm.disconnect()
            return frames, create_mock

        return self._run(inner())

    def _assert_ended(self, frames, reason):
        self.assertEqual(frames[0]["type"], "text")
        self.assertTrue(frames[0]["last"])
        self.assertIn("couldn't verify your account", frames[0]["token"])
        self.assertEqual(frames[1]["type"], "end")
        handoff = json.loads(frames[1]["handoffData"])
        self.assertIn("identity_unresolved", handoff["reason"])
        self.assertIn(reason, handoff["reason"])

    def test_setup_without_an_identity_token_ends_the_call(self):
        frames, create_mock = self._drive_setup(
            json.dumps({"type": "setup", "callSid": CALL_SID})
        )
        self._assert_ended(frames, "missing")
        self.assertEqual(_FakeAgent.constructed, [], "VoiceAgent must never be constructed")
        create_mock.assert_not_awaited()

    def test_setup_with_a_token_for_another_call_ends_the_call(self):
        """The anti-replay guard, end to end."""
        frames, _ = self._drive_setup(
            self._setup_frame(token=mint_identity_token(self.user.pk, OTHER_CALL_SID))
        )
        self._assert_ended(frames, "call_mismatch")

    def test_setup_with_a_tampered_token_ends_the_call(self):
        frames, _ = self._drive_setup(self._setup_frame(token="not-a-real-token"))
        self._assert_ended(frames, "bad_signature")

    @override_settings(VOICE_IDENTITY_MAX_AGE=-1)
    def test_setup_with_an_expired_token_ends_the_call(self):
        frames, _ = self._drive_setup(self._setup_frame())
        self._assert_ended(frames, "expired")

    def test_setup_for_a_deactivated_user_ends_the_call(self):
        """The live User row is re-read, so a token cannot outlive the account."""
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        frames, _ = self._drive_setup(self._setup_frame())
        self._assert_ended(frames, "user_inactive")


class SetupTests(_RelayTestBase):
    def test_setup_resolves_the_user_opens_a_session_and_creates_the_thread(self):
        async def inner():
            create_mock = AsyncMock(return_value=CONV_SID)
            with self._patches(_create_voice_conversation=create_mock):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                connected, _ = await comm.connect()
                self.assertTrue(connected)
                await comm.send_to(text_data=self._setup_frame())
                # A verified setup sends nothing back; awaiting pumps the app task.
                self.assertTrue(await comm.receive_nothing(timeout=0.5))
                await comm.disconnect()
            return create_mock

        create_mock = self._run(inner())
        create_mock.assert_awaited_once_with(CALL_SID)

        session = VoiceSession.objects.get(call_sid=CALL_SID)
        self.assertEqual(session.user_id, self.user.pk)
        agent_session = AgentSession.objects.get(user=self.user)
        self.assertTrue(agent_session.title.startswith("Voice: "))

    def test_setup_does_not_clobber_a_status_callback_that_arrived_first(self):
        VoiceSession.objects.create(
            call_sid=CALL_SID, from_number="client:1",
            to_number="+15551234567", status="in_progress",
        )

        async def inner():
            with self._patches():
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)
                await comm.disconnect()

        self._run(inner())
        session = VoiceSession.objects.get(call_sid=CALL_SID)
        self.assertEqual(session.user_id, self.user.pk)
        self.assertEqual(session.from_number, "client:1")
        self.assertEqual(session.status, "in_progress")

    def test_disconnect_closes_the_agent_session(self):
        async def inner():
            with self._patches():
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)
                await comm.disconnect()

        self._run(inner())
        session = AgentSession.objects.get(user=self.user)
        self.assertEqual(session.status, "completed")
        self.assertIsNotNone(session.ended_at)

    def test_disconnect_closes_and_persists_conversation(self):
        async def inner():
            close_mock = AsyncMock()
            persist_mock = AsyncMock()
            with self._patches(
                _close_voice_conversation=close_mock,
                _persist_conversation_sid=persist_mock,
            ):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)
                await comm.disconnect()
            return close_mock, persist_mock

        close_mock, persist_mock = self._run(inner())
        close_mock.assert_awaited_once_with(CONV_SID)
        persist_mock.assert_any_await(CALL_SID, CONV_SID)

    def test_old_event_shape_is_ignored(self):
        """Bug 1 regression — inbound frames key on "type", not "event"."""
        async def inner():
            create_mock = AsyncMock(return_value=CONV_SID)
            with self._patches(_create_voice_conversation=create_mock):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=json.dumps({"event": "setup", "callSid": CALL_SID}))
                await comm.send_to(text_data=json.dumps({"event": "prompt", "voicePrompt": "hi"}))
                self.assertTrue(await comm.receive_nothing(timeout=0.5))
                await comm.disconnect()
            return create_mock

        create_mock = self._run(inner())
        create_mock.assert_not_awaited()
        self.assertEqual(_FakeAgent.calls, [])


class PromptTests(_RelayTestBase):
    def _drive(self, prompts, scripts=None, records=None, extra_frames=()):
        """Complete setup, then send each prompt and collect every outbound frame."""
        if scripts is not None:
            _FakeAgent.scripts = list(scripts)
        if records is not None:
            _FakeAgent.records_per_turn = list(records)

        async def inner():
            add_mock = AsyncMock()
            with self._patches(_add_conversation_message=add_mock):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)

                frames = []
                for prompt in prompts:
                    await comm.send_to(text_data=json.dumps(
                        {"type": "prompt", "voicePrompt": prompt, "last": True}
                    ))
                    frames.extend(await self._drain_frames(comm))
                for frame in extra_frames:
                    await comm.send_to(text_data=json.dumps(frame))
                    frames.extend(await self._drain_frames(comm))
                await comm.disconnect()
            return frames, add_mock

        return self._run(inner())

    def test_prompt_streams_text_frames_and_persists_messages(self):
        frames, add_mock = self._drive(["hi"], scripts=[_speak("Hello", " there")])

        self.assertEqual(frames, [
            {"type": "text", "token": "Hello", "last": False},
            {"type": "text", "token": " there", "last": False},
            {"type": "text", "token": "", "last": True},
        ])

        # The agent saw the caller's utterance.
        self.assertEqual(_FakeAgent.calls[0][0], "hi")

        # Customer turn then assistant turn archived to Conversations.
        authors = [c.args[1] for c in add_mock.await_args_list]
        bodies = [c.args[2] for c in add_mock.await_args_list]
        self.assertEqual(authors, ["customer", "agent-pm"])
        self.assertEqual(bodies, ["hi", "Hello there"])

    def test_prompt_persists_agent_messages_with_token_counts(self):
        self._drive(["hi"], scripts=[_speak("Hello")])
        session = AgentSession.objects.get(user=self.user)
        roles = list(session.messages.values_list("role", "content"))
        self.assertIn(("user", "hi"), roles)
        self.assertIn(("assistant", "Hello"), roles)
        assistant = session.messages.get(role="assistant")
        self.assertEqual(assistant.input_tokens, 3)
        self.assertEqual(assistant.output_tokens, 2)

    def test_prompt_appends_to_the_voice_session_transcript(self):
        self._drive(["hi"], scripts=[_speak("Hello")])
        session = VoiceSession.objects.get(call_sid=CALL_SID)
        self.assertEqual(session.transcript, "user: hi\nassistant: Hello")

    def test_second_prompt_includes_prior_history(self):
        self._drive(["one", "two"], scripts=[_speak("first"), _speak("second")])
        # The second turn saw the first turn's user + assistant messages.
        second_turn_history = _FakeAgent.calls[1][1]
        self.assertEqual(second_turn_history, [
            {"role": "user", "content": "one"},
            {"role": "assistant", "content": "first"},
        ])

    def test_tool_calls_are_recorded_against_the_assistant_message(self):
        """ToolCall's first writer in the codebase."""
        self._drive(
            ["find it"],
            scripts=[_speak("found it")],
            records=[[ToolCallRecord("search_records", {"query": "acme"},
                                     result=[{"id": 1}], duration_ms=12)]],
        )
        row = ToolCall.objects.get(tool_name="search_records")
        self.assertEqual(row.arguments, {"query": "acme"})
        self.assertEqual(row.status, "success")
        self.assertEqual(row.message.role, "assistant")

    def test_a_turn_that_raises_mid_stream_still_sends_a_terminator(self):
        """A stranded last:false frame wedges TTS for the rest of the call."""
        frames, _ = self._drive(
            ["boom"],
            scripts=[[VoiceEvent("speak", text="partial"), RuntimeError("kaboom")]],
        )
        self.assertEqual(frames[0], {"type": "text", "token": "partial", "last": False})
        self.assertTrue(frames[-1]["last"])
        self.assertIn("error", frames[-1]["token"].lower())

    def test_tool_calls_from_a_failed_turn_are_still_recorded_unlinked(self):
        self._drive(
            ["boom"],
            scripts=[[VoiceEvent("speak", text="partial"), RuntimeError("kaboom")]],
            records=[[ToolCallRecord("search_records", {})]],
        )
        row = ToolCall.objects.get(tool_name="search_records")
        self.assertEqual(row.status, "success")

    def test_filler_frames_are_marked_preemptible(self):
        frames, _ = self._drive(["hi"], scripts=[[
            VoiceEvent("speak", text="One moment.", preemptible=True),
            VoiceEvent("end_utterance"),
            VoiceEvent("speak", text="Here it is."),
            VoiceEvent("end_utterance"),
        ]])
        self.assertTrue(frames[0].get("preemptible"))
        self.assertNotIn("preemptible", frames[2])

    def test_multiple_utterances_in_one_turn_each_get_a_terminator(self):
        """One utterance per round; last:true closes an utterance, not the session."""
        frames, _ = self._drive(["hi"], scripts=[[
            VoiceEvent("speak", text="Checking."),
            VoiceEvent("end_utterance"),
            VoiceEvent("speak", text="Two open items."),
            VoiceEvent("end_utterance"),
        ]])
        self.assertEqual([f["last"] for f in frames], [False, True, False, True])
        self.assertNotIn("end", [f["type"] for f in frames])

    def test_empty_prompt_is_ignored(self):
        frames, _ = self._drive(["   "])
        self.assertEqual(frames, [])
        self.assertEqual(_FakeAgent.calls, [])

    def test_interrupt_dtmf_error_and_malformed_do_not_crash(self):
        async def inner():
            with self._patches():
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)

                await comm.send_to(text_data=json.dumps(
                    {"type": "interrupt", "utteranceUntilInterrupt": "x"}
                ))
                # No pending confirmation, so a keypress is ignored.
                await comm.send_to(text_data=json.dumps({"type": "dtmf", "digit": "1"}))
                await comm.send_to(text_data=json.dumps({"type": "error", "description": "boom"}))
                await comm.send_to(text_data="{ not json")
                self.assertTrue(await comm.receive_nothing(timeout=0.4))

                # The consumer is still alive and answers a subsequent prompt.
                _FakeAgent.scripts = [_speak("ok")]
                await comm.send_to(text_data=json.dumps(
                    {"type": "prompt", "voicePrompt": "still here"}
                ))
                frame = json.loads(await comm.receive_from(timeout=1))
                await comm.receive_nothing(timeout=0.3)
                await comm.disconnect()
            return frame

        frame = self._run(inner())
        self.assertEqual(frame["token"], "ok")
        self.assertEqual(_FakeAgent.calls[0][0], "still here")


class TranscriptBufferingTests(_RelayTestBase):
    """Bug 3 — turns are genuinely buffered until a browser subscriber announces itself."""

    def test_turns_are_buffered_until_subscriber_ready(self):
        _FakeAgent.scripts = [_speak("Hello", " there")]

        async def inner():
            group = f"voice_transcript_{CALL_SID}"
            with self._patches():
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)

                layer = get_channel_layer()
                await layer.group_add(group, "test-subscriber")

                # Drive a prompt — user + assistant turns are pushed while no
                # subscriber has announced itself, so they must be buffered.
                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "hi"}))
                for _ in range(3):
                    await comm.receive_from(timeout=1)
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
            return turns

        turns = self._run(inner())
        self.assertEqual(turns[0]["role"], "user")
        self.assertEqual(turns[0]["content"], "hi")
        self.assertEqual(turns[1]["role"], "assistant")
        self.assertEqual(turns[1]["content"], "Hello there")

    def test_turns_sent_live_after_subscriber_ready(self):
        _FakeAgent.scripts = [_speak("done")]

        async def inner():
            group = f"voice_transcript_{CALL_SID}"
            with self._patches():
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)

                layer = get_channel_layer()
                await layer.group_add(group, "test-subscriber")
                await layer.group_send(group, {"type": "transcript.subscriber_ready"})
                await comm.receive_nothing(timeout=0.3)  # let the relay mark ready

                await comm.send_to(text_data=json.dumps({"type": "prompt", "voicePrompt": "q"}))
                for _ in range(2):
                    await comm.receive_from(timeout=1)

                turns = []
                while len(turns) < 2:
                    msg = await asyncio.wait_for(layer.receive("test-subscriber"), timeout=1)
                    if msg.get("type") == "voice.turn":
                        turns.append(msg)
                await comm.disconnect()
            return turns

        turns = self._run(inner())
        self.assertEqual([t["role"] for t in turns], ["user", "assistant"])
        self.assertEqual(turns[1]["content"], "done")


class ConfirmationGateTests(_RelayTestBase):
    """
    The spoken confirmation gate, end to end through the consumer.

    The pending confirmation lives on the consumer instance, so it survives between
    turns without being anything the model could talk itself past.
    """

    ARMED_TOOL = "send_sms"
    ARMED_ARGS = {"to": "+15005550006", "body": "test"}

    def _drive(self, replies, dispatch_result=None, dispatch_side_effect=None):
        """
        Arm a pending confirmation on the first turn, then send `replies`.

        `replies` entries are either a prompt string or a raw frame dict (for DTMF).
        """
        def arming_script(agent_self):
            agent_self.state.arm(
                self.ARMED_TOOL,
                self.ARMED_ARGS,
                "text that number saying: test",
                now=asyncio.get_running_loop().time(),
            )
            return _speak("Just to confirm — you want me to text that number?")

        class _ArmingAgent(_FakeAgent):
            # Arms on its first turn only. A real model may well re-ask for the same
            # gated tool on a later turn, but a fake that re-arms makes it impossible
            # to test that a *dropped* pending stays dropped.
            armed = False

            async def run_turn(inner_self, model_input, messages):
                _FakeAgent.calls.append((model_input, list(messages)))
                if not _ArmingAgent.armed and not _FakeAgent.scripts:
                    _ArmingAgent.armed = True
                    script = arming_script(inner_self)
                else:
                    script = (
                        _FakeAgent.scripts.pop(0) if _FakeAgent.scripts else _speak("ok")
                    )
                for event in script:
                    yield event
                yield VoiceEvent("usage", payload={"input_tokens": 1, "output_tokens": 1})

        dispatch = AsyncMock(
            return_value=dispatch_result if dispatch_result is not None else {"sid": "SM1"},
            side_effect=dispatch_side_effect,
        )

        async def inner():
            with self._patches(agent=_ArmingAgent), \
                 patch("realtime.voice_agent.mcp_server.dispatch", new=dispatch):
                comm = WebsocketCommunicator(ConversationRelayConsumer.as_asgi(), "/ws/voice-relay/")
                await comm.connect()
                await comm.send_to(text_data=self._setup_frame())
                await comm.receive_nothing(timeout=0.4)

                # Turn 1 arms the gate.
                await comm.send_to(text_data=json.dumps(
                    {"type": "prompt", "voicePrompt": "text 500 555 0006 saying test"}
                ))
                await self._drain_frames(comm)

                frames = []
                for reply in replies:
                    frame = (
                        {"type": "prompt", "voicePrompt": reply}
                        if isinstance(reply, str) else reply
                    )
                    await comm.send_to(text_data=json.dumps(frame))
                    frames.extend(await self._drain_frames(comm))
                await comm.disconnect()
            return frames, dispatch

        return self._run(inner())

    def test_saying_yes_dispatches_the_tool_with_the_original_arguments(self):
        _, dispatch = self._drive(["yes"])
        dispatch.assert_awaited_once_with(self.ARMED_TOOL, self.ARMED_ARGS, user=self.user)

    def test_a_confirmed_tool_writes_a_tool_call_row(self):
        self._drive(["yes"])
        row = ToolCall.objects.get(tool_name=self.ARMED_TOOL)
        self.assertEqual(row.arguments, self.ARMED_ARGS)
        self.assertEqual(row.status, "success")

    def test_saying_no_never_dispatches(self):
        _, dispatch = self._drive(["no, cancel that"])
        dispatch.assert_not_awaited()
        self.assertFalse(ToolCall.objects.filter(tool_name=self.ARMED_TOOL).exists())

    def test_pressing_1_confirms(self):
        _, dispatch = self._drive([{"type": "dtmf", "digit": "1"}])
        dispatch.assert_awaited_once_with(self.ARMED_TOOL, self.ARMED_ARGS, user=self.user)

    def test_pressing_2_cancels(self):
        _, dispatch = self._drive([{"type": "dtmf", "digit": "2"}])
        dispatch.assert_not_awaited()

    def test_an_irrelevant_keypress_is_ignored_and_the_pending_survives(self):
        _, dispatch = self._drive([{"type": "dtmf", "digit": "7"}, "yes"])
        dispatch.assert_awaited_once_with(self.ARMED_TOOL, self.ARMED_ARGS, user=self.user)

    def test_one_unclear_reply_re_asks_verbatim_without_a_model_call(self):
        frames, dispatch = self._drive(["maybe later"])
        dispatch.assert_not_awaited()
        self.assertIn("Just to confirm", frames[0]["token"])
        self.assertTrue(frames[-1]["last"])

    def test_two_unclear_replies_drop_the_pending_and_handle_it_as_a_fresh_prompt(self):
        """Never leave the caller stuck in a confirmation loop."""
        _FakeAgent.scripts = []
        frames, dispatch = self._drive(["maybe", "hmm", "yes"])
        # After two strikes the pending is gone, so the later "yes" confirms nothing.
        dispatch.assert_not_awaited()

    @override_settings(VOICE_CONFIRM_TTL_SECONDS=-1)
    def test_an_expired_pending_is_treated_as_a_fresh_prompt(self):
        _, dispatch = self._drive(["yes"])
        dispatch.assert_not_awaited()

    def test_a_failed_confirmed_tool_still_completes_the_turn(self):
        frames, dispatch = self._drive(
            ["yes"], dispatch_side_effect=RuntimeError("twilio down")
        )
        dispatch.assert_awaited_once()
        self.assertTrue(frames[-1]["last"])
        row = ToolCall.objects.get(tool_name=self.ARMED_TOOL)
        self.assertEqual(row.status, "error")
