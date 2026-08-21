"""
Tests for realtime.conversations — the Twilio Conversations REST wrappers used to
archive each voice call's transcript.

`_client()` lazily does `from twilio.rest import Client`, so we patch
`twilio.rest.Client` with a MagicMock and assert the call chains. The service-scoped
vs account-default paths are selected by TWILIO_CONVERSATIONS_SERVICE_SID.
"""

import json
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings

from realtime import conversations

CALL_SID = "CA" + "1" * 32
CONV_SID = "CH" + "2" * 32
SERVICE_SID = "IS" + "3" * 32


class CreateVoiceConversationTests(TestCase):
    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID=SERVICE_SID)
    def test_create_uses_service_scope_when_service_sid_set(self):
        mock_client = MagicMock()
        service = mock_client.conversations.v1.services.return_value
        service.conversations.create.return_value.sid = CONV_SID

        with patch("twilio.rest.Client", return_value=mock_client):
            result = conversations.create_voice_conversation(CALL_SID)

        self.assertEqual(result, CONV_SID)
        mock_client.conversations.v1.services.assert_called_once_with(SERVICE_SID)
        # attributes carry the source + call_sid; friendly_name references the call.
        _, kwargs = service.conversations.create.call_args
        self.assertEqual(kwargs["friendly_name"], f"Voice Call {CALL_SID}")
        self.assertEqual(json.loads(kwargs["attributes"]), {"source": "voice", "call_sid": CALL_SID})
        # The account-default path was NOT used.
        mock_client.conversations.v1.conversations.create.assert_not_called()

    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID="")
    def test_create_uses_account_default_when_no_service_sid(self):
        mock_client = MagicMock()
        mock_client.conversations.v1.conversations.create.return_value.sid = CONV_SID

        with patch("twilio.rest.Client", return_value=mock_client):
            result = conversations.create_voice_conversation(CALL_SID)

        self.assertEqual(result, CONV_SID)
        mock_client.conversations.v1.conversations.create.assert_called_once()
        mock_client.conversations.v1.services.assert_not_called()

    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID="")
    def test_create_raises_on_api_error(self):
        # create is the one wrapper that propagates, so the consumer can decide
        # whether to proceed without a Conversations thread.
        mock_client = MagicMock()
        mock_client.conversations.v1.conversations.create.side_effect = RuntimeError("boom")

        with patch("twilio.rest.Client", return_value=mock_client):
            with self.assertRaises(RuntimeError):
                conversations.create_voice_conversation(CALL_SID)


class AddConversationMessageTests(TestCase):
    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID=SERVICE_SID)
    def test_add_uses_service_scope(self):
        mock_client = MagicMock()
        with patch("twilio.rest.Client", return_value=mock_client):
            conversations.add_conversation_message(CONV_SID, "customer", "hello")

        messages = mock_client.conversations.v1.services.return_value.conversations.return_value.messages
        messages.create.assert_called_once_with(author="customer", body="hello")

    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID="")
    def test_add_uses_account_default(self):
        mock_client = MagicMock()
        with patch("twilio.rest.Client", return_value=mock_client):
            conversations.add_conversation_message(CONV_SID, "agent-pm", "hi back")

        messages = mock_client.conversations.v1.conversations.return_value.messages
        messages.create.assert_called_once_with(author="agent-pm", body="hi back")

    def test_add_empty_body_is_a_noop(self):
        # No client is even constructed for an empty body.
        with patch("twilio.rest.Client") as client_cls:
            conversations.add_conversation_message(CONV_SID, "customer", "")
        client_cls.assert_not_called()

    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID="")
    def test_add_swallows_api_error(self):
        mock_client = MagicMock()
        mock_client.conversations.v1.conversations.return_value.messages.create.side_effect = RuntimeError("boom")
        with patch("twilio.rest.Client", return_value=mock_client):
            # Must not raise.
            conversations.add_conversation_message(CONV_SID, "customer", "hello")


class CloseVoiceConversationTests(TestCase):
    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID=SERVICE_SID)
    def test_close_uses_service_scope(self):
        mock_client = MagicMock()
        with patch("twilio.rest.Client", return_value=mock_client):
            conversations.close_voice_conversation(CONV_SID)

        conv = mock_client.conversations.v1.services.return_value.conversations
        conv.assert_called_once_with(CONV_SID)
        conv.return_value.update.assert_called_once_with(state="closed")

    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID="")
    def test_close_uses_account_default(self):
        mock_client = MagicMock()
        with patch("twilio.rest.Client", return_value=mock_client):
            conversations.close_voice_conversation(CONV_SID)

        conv = mock_client.conversations.v1.conversations
        conv.assert_called_once_with(CONV_SID)
        conv.return_value.update.assert_called_once_with(state="closed")

    @override_settings(TWILIO_CONVERSATIONS_SERVICE_SID="")
    def test_close_swallows_api_error(self):
        mock_client = MagicMock()
        mock_client.conversations.v1.conversations.return_value.update.side_effect = RuntimeError("boom")
        with patch("twilio.rest.Client", return_value=mock_client):
            # Must not raise.
            conversations.close_voice_conversation(CONV_SID)
