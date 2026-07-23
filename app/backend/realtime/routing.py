"""Django Channels URL routing for WebSocket connections."""

from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r"^ws/chat/(?P<session_id>\d+)/$", consumers.ChatConsumer.as_asgi()),
    re_path(
        r"^ws/agent-stream/(?P<session_id>\d+)/$",
        consumers.AgentStreamConsumer.as_asgi(),
    ),
    re_path(r"^ws/meeting-notes/(?P<event_id>\d+)/$", consumers.MeetingNotesConsumer.as_asgi()),
    re_path(r"^ws/voice-transcript/(?P<call_sid>[A-Za-z0-9]+)/$", consumers.VoiceTranscriptConsumer.as_asgi()),
    # Twilio ConversationRelay — no auth required; Twilio connects here directly.
    re_path(r"^ws/voice-relay/$", consumers.ConversationRelayConsumer.as_asgi()),
]
