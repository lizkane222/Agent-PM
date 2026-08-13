"""Tests for realtime.llm — Bedrock streaming integration."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from django.test import TestCase

from realtime.llm import bedrock_stream, _SYSTEM_PROMPT


class BedrockStreamTests(TestCase):
    """Unit tests for bedrock_stream() with mocked AsyncAnthropicBedrock."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    async def _collect(self, gen):
        chunks = []
        async for chunk in gen:
            chunks.append(chunk)
        return chunks

    def _make_mock_stream(self, tokens):
        """Build a mock stream context manager whose text_stream yields tokens."""

        async def _text_stream():
            for t in tokens:
                yield t

        mock_stream = MagicMock()
        mock_stream.__aenter__ = AsyncMock(return_value=mock_stream)
        mock_stream.__aexit__ = AsyncMock(return_value=False)
        mock_stream.text_stream = _text_stream()
        return mock_stream

    def test_yields_tokens_from_bedrock(self):
        tokens = ["Hello", ", ", "Agent", " PM", "!"]
        mock_stream = self._make_mock_stream(tokens)
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream

        with patch("realtime.llm.AsyncAnthropicBedrock", return_value=mock_client):
            result = self._run(self._collect(bedrock_stream("Hi there", [])))

        self.assertEqual(result, tokens)

    def test_includes_history_in_messages(self):
        mock_stream = self._make_mock_stream(["ok"])
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream

        history = [
            {"role": "user", "content": "previous question"},
            {"role": "assistant", "content": "previous answer"},
        ]

        with patch("realtime.llm.AsyncAnthropicBedrock", return_value=mock_client):
            self._run(self._collect(bedrock_stream("follow-up", history)))

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        messages = call_kwargs["messages"]
        self.assertEqual(messages[0], {"role": "user", "content": "previous question"})
        self.assertEqual(messages[1], {"role": "assistant", "content": "previous answer"})
        self.assertEqual(messages[2], {"role": "user", "content": "follow-up"})

    def test_passes_system_prompt(self):
        mock_stream = self._make_mock_stream(["ok"])
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream

        with patch("realtime.llm.AsyncAnthropicBedrock", return_value=mock_client):
            self._run(self._collect(bedrock_stream("test", [])))

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        self.assertEqual(call_kwargs["system"], _SYSTEM_PROMPT)

    def test_uses_env_model_id(self):
        mock_stream = self._make_mock_stream(["ok"])
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream

        with patch("realtime.llm.AsyncAnthropicBedrock", return_value=mock_client):
            with patch.dict("os.environ", {"VOICE_BEDROCK_MODEL_ID": "anthropic.custom-model:0"}):
                self._run(self._collect(bedrock_stream("test", [])))

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        self.assertEqual(call_kwargs["model"], "anthropic.custom-model:0")

    def test_uses_env_aws_region(self):
        mock_stream = self._make_mock_stream(["ok"])
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream

        captured = {}

        def capture_client(aws_region):
            captured["aws_region"] = aws_region
            return mock_client

        with patch("realtime.llm.AsyncAnthropicBedrock", side_effect=capture_client):
            with patch.dict("os.environ", {"AWS_REGION": "eu-west-1"}):
                self._run(self._collect(bedrock_stream("test", [])))

        self.assertEqual(captured["aws_region"], "eu-west-1")

    def test_empty_history_sends_single_user_message(self):
        mock_stream = self._make_mock_stream(["ok"])
        mock_client = MagicMock()
        mock_client.messages.stream.return_value = mock_stream

        with patch("realtime.llm.AsyncAnthropicBedrock", return_value=mock_client):
            self._run(self._collect(bedrock_stream("hello", [])))

        call_kwargs = mock_client.messages.stream.call_args.kwargs
        self.assertEqual(call_kwargs["messages"], [{"role": "user", "content": "hello"}])
