"""API views for the realtime app."""

import logging
import urllib.parse

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import SyncGrant, VoiceGrant
from twilio.twiml.voice_response import Connect, VoiceResponse

from .models import AgentActivityEvent, VoiceSession
from .serializers import (
    AgentActivityEventSerializer,
    SyncTokenSerializer,
    VoiceSessionSerializer,
)
from .sync import publish_activity_event
from .voice_identity import (
    IDENTITY_PARAM,
    mint_identity_token,
    resolve_user_sync,
    user_pk_from_twilio_from,
)
from core.mixins import TwilioSignatureRequiredMixin  # shared, single canonical copy
from core.pagination import ClientPageSizePagination
from comments.serializers import _user_display_name
from rest_framework.decorators import action

# Cap for the shared per-record feed; one card never needs more than this.
RESOURCE_ACTIVITY_LIMIT = 200

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


# Domain vocabulary the transcriber would otherwise mangle. Per-user account names
# are appended to these — see _hints_for.
_FIXED_HINTS = (
    "Agent PM",
    "action item",
    "Airtable",
    "Salesforce",
    "Zendesk",
    "Jira",
    "Confluence",
    "Gong",
    "QBR",
    "ARR",
)


def _hints_for(user) -> str:
    """
    Comma-separated speech hints: fixed domain vocabulary plus the caller's accounts.

    Building these is only possible because the user is resolved here, at TwiML time.
    Account names are the bulk of what this agent's tool arguments are made of, so
    they are the single highest-leverage accuracy knob available.
    """
    hints = list(_FIXED_HINTS)
    if user is not None:
        from accounts.models import Account  # noqa: PLC0415 — avoids an app-loading cycle

        limit = getattr(settings, "VOICE_HINTS_ACCOUNT_LIMIT", 60)
        hints.extend(
            Account.objects.filter(team_members__user=user)
            .values_list("company_name", flat=True)
            .distinct()[:limit]
        )

    seen: set[str] = set()
    deduped = []
    for hint in hints:
        # Commas are the separator, so a name containing one would split into two
        # bogus hints. Whitespace runs are collapsed too, otherwise "Acme, Inc"
        # becomes "Acme  Inc" and the hint no longer matches the spoken name.
        cleaned = " ".join((hint or "").replace(",", " ").split())
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            deduped.append(cleaned)

    joined = ",".join(deduped)
    max_chars = getattr(settings, "VOICE_HINTS_MAX_CHARS", 1000)
    if len(joined) <= max_chars:
        return joined
    # Truncate on a comma boundary so no hint is cut mid-word.
    return joined[:max_chars].rsplit(",", 1)[0]


def _relay_attrs(user) -> dict:
    """
    <ConversationRelay> attributes beyond the URL.

    Everything audible is settings-gated with today's behaviour as the default, so
    no env change means no audible change.
    """
    attrs: dict = {
        "welcome_greeting": "Hello, I'm Agent PM. How can I help you today?",
        # An assistant that can emit a multi-sentence tool summary must be
        # interruptible or the call feels broken.
        "interruptible": "speech",
        # "high" false-triggers on breathing and background speech; "low" makes
        # barge-in feel unresponsive.
        "interrupt_sensitivity": "medium",
        # Compensates for leaving ignoreBackchannel OFF: a "yes" spoken over the
        # agent still arrives as a prompt frame, so the confirmation gate does not
        # depend on the caller waiting for silence.
        "report_input_during_agent_speech": "true",
        # "press 1 to confirm" is far more reliable than ASR for an irreversible
        # action over a lossy speech channel. See realtime.voice_policy.
        "dtmf_detection": "true",
        "welcome_greeting_interruptible": "speech",
        # Lets the real answer pre-empt a queued filler utterance. Without this,
        # filler makes perceived latency *worse* — a 0.4s tool call means the caller
        # sits through "One moment." before hearing the answer.
        "preemptible": "true",
        "hints": _hints_for(user),
    }

    # Deliberately NOT set:
    #   ignoreBackchannel — would suppress "yeah", our primary affirmative token.
    #   partial_prompts   — would fire the agent loop mid-sentence: double tool calls.
    #   profanity_filter  — mangles transcripts that drive tool arguments.
    #   speechTimeout     — tightening it cuts users off mid-thought.

    if getattr(settings, "VOICE_TTS_PROVIDER", ""):
        attrs["tts_provider"] = settings.VOICE_TTS_PROVIDER
    if getattr(settings, "VOICE_TTS_VOICE", ""):
        attrs["voice"] = settings.VOICE_TTS_VOICE
    if getattr(settings, "VOICE_STT_PROVIDER", ""):
        attrs["transcription_provider"] = settings.VOICE_STT_PROVIDER
    if getattr(settings, "VOICE_STT_MODEL", ""):
        attrs["speech_model"] = settings.VOICE_STT_MODEL
    if settings.DEBUG:
        # Makes the last:true utterance framing verifiable in the Twilio logs.
        attrs["debug"] = "debugging tokens-played"

    return attrs


class VoiceTwiMLView(TwilioSignatureRequiredMixin, APIView):
    """
    TwiML endpoint called by Twilio when a browser-initiated call connects.

    Returns <Connect><ConversationRelay> which hands the call to our WebSocket
    consumer at /ws/voice-relay/ for real-time Claude conversation, plus a signed
    <Parameter> carrying the caller's identity so the consumer can scope tool calls
    to a real Django user (see realtime.voice_identity).
    """

    permission_classes = [AllowAny]

    def _resolve_user(self, request):
        """The Django user behind `From="client:<pk>"`, or None if unresolvable."""
        pk = user_pk_from_twilio_from(request.data.get("From", ""))
        if pk is None:
            return None
        return resolve_user_sync(pk)

    def post(self, request):
        scheme = "wss" if request.is_secure() else "ws"
        host = request.get_host()
        relay_url = f"{scheme}://{host}/ws/voice-relay/"

        # Append the pre-shared VOICE_RELAY_TOKEN as a query param so the consumer
        # accepts the incoming Twilio connection. Without it, ConversationRelayConsumer
        # closes every socket with code 4001 whenever VOICE_RELAY_TOKEN is configured
        # (i.e. in production).
        relay_token = getattr(settings, "VOICE_RELAY_TOKEN", "")
        if relay_token:
            relay_url = f"{relay_url}?relay_token={urllib.parse.quote(relay_token, safe='')}"

        call_sid = request.data.get("CallSid", "")
        user = self._resolve_user(request)

        response = VoiceResponse()
        connect = Connect()
        relay = connect.conversation_relay(url=relay_url, **_relay_attrs(user))
        if user is not None and call_sid:
            relay.parameter(
                name=IDENTITY_PARAM,
                value=mint_identity_token(user.pk, call_sid),
            )
        else:
            # No error and no 500 — Twilio must receive valid TwiML. The consumer
            # detects the absent parameter on setup and ends the call with a spoken
            # explanation rather than degrading to a tool-less chat that would answer
            # questions about "your accounts" with no account access.
            logger.warning(
                "VoiceTwiML: unresolved identity for From=%r call_sid=%r — no <Parameter> minted",
                request.data.get("From", ""), call_sid,
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

    @action(detail=False, methods=["get"], url_path="for-resource")
    def for_resource(self, request):
        """GET /realtime/activity/for-resource/?type=action_item&id=<airtable_id>

        Every user's activity for one record — the shared counterpart to the owner-scoped
        list. The activity log is written client-side under each writer's own user, so the
        list route alone can never show a teammate's edit on a shared action item.

        Visibility follows the record, not the event: the caller must be able to see the
        action item (same Admin-privacy rule as the action-items list). An unknown or hidden
        record answers with an empty list, so existence cannot be probed.
        """
        resource_type = request.query_params.get("type", "")
        resource_id = request.query_params.get("id", "")
        if resource_type != "action_item" or not resource_id:
            return Response({"results": []})

        from airtable_sync.models import AirtableActionItem
        from airtable_sync.views import _exclude_private_admin_items
        visible = _exclude_private_admin_items(
            AirtableActionItem.objects.filter(airtable_id=resource_id), request.user
        ).exists()
        if not visible:
            return Response({"results": []})

        events = (
            AgentActivityEvent.objects
            .filter(metadata__resource__type=resource_type, metadata__resource__id=resource_id)
            .select_related("user", "user__profile")
            .order_by("-created_at")[:RESOURCE_ACTIVITY_LIMIT]
        )
        data = AgentActivityEventSerializer(events, many=True).data
        for row, ev in zip(data, events):
            row["actor_id"] = ev.user_id
            row["actor_display"] = _user_display_name(ev.user)
        return Response({"results": data})
