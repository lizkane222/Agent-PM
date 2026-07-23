"""URL configuration for the realtime app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AgentActivityEventViewSet,
    SyncTokenView,
    VoiceRecordingCallbackView,
    VoiceStatusCallbackView,
    VoiceTwiMLView,
    VoiceSessionViewSet,
)

router = DefaultRouter()
router.register("voice-sessions", VoiceSessionViewSet, basename="voice-session")
router.register("activity", AgentActivityEventViewSet, basename="agent-activity")

urlpatterns = [
    path("sync-token/", SyncTokenView.as_view(), name="sync-token"),
    # Twilio Voice — TwiML handler and status callbacks
    path("voice/twiml/", VoiceTwiMLView.as_view(), name="voice-twiml"),
    path("voice/status/", VoiceStatusCallbackView.as_view(), name="voice-status"),
    path("voice/recording/", VoiceRecordingCallbackView.as_view(), name="voice-recording"),
    path("", include(router.urls)),
]
