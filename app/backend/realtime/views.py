"""API views for the realtime app."""

import logging

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import SyncGrant, VoiceGrant
from twilio.twiml.voice_response import Connect, ConversationRelay, VoiceResponse

from .models import AgentActivityEvent, VoiceSession
from .serializers import (
    AgentActivityEventSerializer,
    SyncTokenSerializer,
    VoiceSessionSerializer,
)
from .sync import publish_activity_event
from core.mixins import TwilioSignatureRequiredMixin  # shared, single canonical copy
from core.pagination import ClientPageSizePagination

logger = logging.getLogger(__name__)


class SyncTokenView(APIView):
    """
    Issue a Twilio Access Token with Sync + Voice grants.

    The frontend uses this token to subscribe to Sync lists for the live
    agent activity feed, and to make/receive Voice calls via the Twilio SDK.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        identity = str(request.user.pk)

        token = AccessToken(
            settings.TWILIO_ACCOUNT_SID,
            settings.TWILIO_API_KEY,
            settings.TWILIO_API_SECRET,
            identity=identity,
            ttl=3600,
        )

        # Sync grant — lets the frontend subscribe to Sync documents/lists.
        sync_grant = SyncGrant(service_sid=settings.TWILIO_SYNC_SERVICE_SID)
        token.add_grant(sync_grant)

        # Voice grant — lets the frontend make/receive calls via the TwiML App.
        voice_grant = VoiceGrant(
            outgoing_application_sid=settings.TWILIO_TWIML_APP_SID,
            incoming_allow=True,
        )
        token.add_grant(voice_grant)

        serializer = SyncTokenSerializer(
            {
                "token": token.to_jwt(),
                "identity": identity,
                "sync_service_sid": settings.TWILIO_SYNC_SERVICE_SID,
            }
        )
        return Response(serializer.data)


class VoiceTwiMLView(TwilioSignatureRequiredMixin, APIView):
    """
    TwiML endpoint called by Twilio when a browser-initiated call connects.

    Returns <Connect><ConversationRelay> which hands the call to our WebSocket
    consumer at /ws/voice-relay/ for real-time Claude Bedrock conversation.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        scheme = "wss" if request.is_secure() else "ws"
        host = request.get_host()
        relay_url = f"{scheme}://{host}/ws/voice-relay/"
        response = VoiceResponse()
        connect = Connect()
        connect.conversation_relay(
            url=relay_url,
            welcome_greeting="Hello, I'm Agent PM. How can I help you today?",
        )
        response.append(connect)
        return HttpResponse(str(response), content_type="application/xml")


class VoiceStatusCallbackView(TwilioSignatureRequiredMixin, APIView):
    """
    Receives Twilio voice status-callback webhooks and keeps VoiceSession
    in sync. Also publishes events to the Sync feed.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        call_sid = request.data.get("CallSid", "")
        call_status = request.data.get("CallStatus", "")
        from_number = request.data.get("From", "")
        to_number = request.data.get("To", "")
        duration = int(request.data.get("CallDuration", 0) or 0)

        STATUS_MAP = {
            "ringing": "ringing",
            "in-progress": "in_progress",
            "completed": "completed",
            "failed": "failed",
            "no-answer": "no_answer",
            "busy": "failed",
            "canceled": "failed",
        }
        db_status = STATUS_MAP.get(call_status, "ringing")

        ended_statuses = {"completed", "failed", "no_answer"}
        session, created = VoiceSession.objects.update_or_create(
            call_sid=call_sid,
            defaults={
                "from_number": from_number,
                "to_number": to_number,
                "status": db_status,
                "duration_seconds": duration,
                "ended_at": timezone.now() if db_status in ended_statuses else None,
            },
        )
        if created:
            session.started_at = timezone.now()
            session.save(update_fields=["started_at"])

        # Publish to Sync feed so the dashboard updates live.
        try:
            user = session.user
            if user:
                event_type = "voice_transcript" if db_status == "completed" else "tool_call"
                title = f"Call {db_status}: {from_number} → {to_number}"
                publish_activity_event(user, event_type, title, metadata={"call_sid": call_sid, "status": db_status})
        except Exception as exc:
            logger.warning("Failed to publish voice status to Sync: %s", exc)

        return HttpResponse("", status=204)


class VoiceRecordingCallbackView(TwilioSignatureRequiredMixin, APIView):
    """
    Receives the recording-status callback once a recording is ready.
    Stores the recording URL on the VoiceSession so it can be fetched later.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        call_sid = request.data.get("CallSid", "")
        recording_url = request.data.get("RecordingUrl", "")
        if call_sid and recording_url:
            VoiceSession.objects.filter(call_sid=call_sid).update(
                recording_url=recording_url + ".mp3"
            )
        return HttpResponse("", status=204)


class VoiceSessionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only list and detail for voice call sessions."""

    serializer_class = VoiceSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return VoiceSession.objects.filter(user=self.request.user)


class AgentActivityEventViewSet(viewsets.ModelViewSet):
    """List and create agent activity events."""

    serializer_class = AgentActivityEventSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ClientPageSizePagination
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return AgentActivityEvent.objects.filter(user=self.request.user).order_by("-created_at")[:500]

    def perform_create(self, serializer):
        client_id = serializer.validated_data.get("client_id", "")
        if client_id:
            # Idempotent: if we already stored this client_id for this user, skip.
            if AgentActivityEvent.objects.filter(user=self.request.user, client_id=client_id).exists():
                return
        serializer.save(user=self.request.user)
