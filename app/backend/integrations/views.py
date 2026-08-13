"""API views for the integrations app."""

import logging
import re

import requests
from django.conf import settings
from django.http import HttpResponse
from google_auth_oauthlib.flow import Flow
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from core.mixins import TwilioSignatureRequiredMixin  # shared, single canonical copy

from .models import OAuthCredential, SyncState, WebhookLog
from .serializers import (
    GoogleOAuthCallbackSerializer,
    OAuthCredentialSerializer,
    SyncStateSerializer,
    WebhookLogSerializer,
)

logger = logging.getLogger(__name__)


GOOGLE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]

GOOGLE_DRIVE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
]


_SENSITIVE_HEADERS = frozenset({"authorization", "x-twilio-signature", "cookie", "set-cookie"})


def _scrub_headers(headers: dict) -> dict:
    """Return a copy of headers with sensitive values redacted."""
    return {k: v for k, v in headers.items() if k.lower() not in _SENSITIVE_HEADERS}


def _build_google_flow(scopes=None):
    return Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
            }
        },
        scopes=scopes or GOOGLE_SCOPES,
        autogenerate_code_verifier=True,
    )


def _sync_google_calendar(user, creds):
    """Pull the upcoming 90 days of events from Google Calendar into CalendarEvent."""
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from django.utils import timezone
    import datetime
    import time
    from .models import SyncState
    from scheduler.models import CalendarEvent
    from airtable_sync.models import AirtableMeeting

    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    now = timezone.now()
    time_min = (now - datetime.timedelta(days=90)).isoformat()
    time_max = (now + datetime.timedelta(days=90)).isoformat()

    page_token = None
    created = updated = 0
    seen_ids = set()
    while True:
        request = service.events().list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
            pageToken=page_token,
            maxResults=250,
        )
        delay = 1
        result = None
        for attempt in range(4):
            try:
                result = request.execute()
                break
            except HttpError as exc:
                if exc.status_code == 429 and attempt < 3:
                    logger.warning("Google Calendar API rate limited (429); retrying in %ds (attempt %d/4)", delay, attempt + 1)
                    time.sleep(delay)
                    delay *= 2
                    request = service.events().list(
                        calendarId="primary",
                        timeMin=time_min,
                        timeMax=time_max,
                        singleEvents=True,
                        orderBy="startTime",
                        pageToken=page_token,
                        maxResults=250,
                    )
                else:
                    raise
        if result is None:
            break

        for item in result.get("items", []):
            # Skip cancelled events — treat them as deleted
            if item.get("status") == "cancelled":
                continue

            start = item.get("start", {})
            end = item.get("end", {})
            start_dt = start.get("dateTime") or (start.get("date") + "T00:00:00+00:00")
            end_dt = end.get("dateTime") or (end.get("date") + "T00:00:00+00:00")
            attendees = [
                {
                    "email": a.get("email", ""),
                    "displayName": a.get("displayName", ""),
                    "responseStatus": a.get("responseStatus", "needsAction"),
                }
                for a in item.get("attendees", [])
            ]
            meet_link = ""
            for ep in item.get("conferenceData", {}).get("entryPoints", []):
                if ep.get("entryPointType") == "video":
                    meet_link = ep.get("uri", "")
                    break

            # Events pushed from AgentPM (action items / reminders) carry a private
            # extended property so we can restore their work_tracking calendar_id on
            # pull rather than misclassifying them as regular meetings.
            private_props = item.get("extendedProperties", {}).get("private", {})
            agentpm_source = private_props.get("agentpm_source", "")
            agentpm_airtable_id = private_props.get("agentpm_airtable_id", "")
            if agentpm_source == "action_item":
                resolved_calendar_id = "work_tracking"
            else:
                resolved_calendar_id = "primary"

            defaults = {
                "title": item.get("summary", "(No title)"),
                "description": item.get("description", ""),
                "location": item.get("location", ""),
                "start_datetime": start_dt,
                "end_datetime": end_dt,
                "all_day": "date" in start,
                "status": item.get("status", "confirmed"),
                "attendees": attendees,
                "meet_link": meet_link,
                "calendar_id": resolved_calendar_id,
                "is_synced": True,
            }
            # Only set agentpm_airtable_id when Google carries a value.
            # If it's blank, preserve whatever was stored locally (e.g. a stub
            # created when the user pasted Gong notes for this meeting).
            if agentpm_airtable_id:
                defaults["agentpm_airtable_id"] = agentpm_airtable_id

            obj, was_created = CalendarEvent.objects.update_or_create(
                owner=user,
                google_event_id=item["id"],
                defaults=defaults,
            )
            # If we just created this row and there's a matching stub keyed by our
            # internal PK, link it now so future syncs won't lose the connection.
            if was_created:
                stub = AirtableMeeting.objects.filter(
                    airtable_id__startswith=f"local-{obj.pk}-"
                ).first()
                if stub:
                    obj.agentpm_airtable_id = stub.airtable_id
                    obj.save(update_fields=["agentpm_airtable_id"])
            seen_ids.add(item["id"])
            if was_created:
                created += 1
            else:
                updated += 1

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    # Delete local events (primary AND work_tracking) that no longer exist in Google's
    # response — moved outside the window, deleted, or cancelled.
    # Guard: if Google returned nothing at all, skip deletion — likely a transient
    # auth/quota failure that already saw all items skipped as "cancelled".
    deleted_count = 0
    if seen_ids:
        deleted_qs = CalendarEvent.objects.filter(
            owner=user,
            calendar_id__in=["primary", "work_tracking"],
            is_synced=True,
        ).exclude(google_event_id__in=seen_ids)
        deleted_count, _ = deleted_qs.delete()
        if deleted_count:
            logger.info("Google Calendar sync: removed %d stale events for %s", deleted_count, user)

    SyncState.objects.update_or_create(
        user=user,
        provider="google",
        resource="calendar",
        defaults={"last_synced_at": now},
    )
    logger.info("Google Calendar sync complete for %s: %d created, %d updated, %d deleted", user, created, updated, deleted_count)


class GoogleOAuthInitView(APIView):
    """Kick off the Google OAuth2 flow — returns an authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.core import signing
        flow = _build_google_flow()
        flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
        # Embed the user ID in the state param (signed) so the callback can resolve
        # the user even when the popup runs in a different session context.
        state_payload = signing.dumps({"uid": request.user.pk}, salt="google-oauth")
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state_payload,
        )
        return Response({"authorization_url": auth_url})


class GoogleOAuthCallbackView(APIView):
    """Handle the OAuth2 redirect, exchange the code for tokens, and persist them."""

    permission_classes = [AllowAny]

    def get(self, request):
        serializer = GoogleOAuthCallbackSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)

        code = serializer.validated_data["code"]

        # Resolve the user from the signed state param embedded during init.
        from django.core import signing
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = None
        raw_state = request.query_params.get("state", "")
        try:
            payload = signing.loads(raw_state, salt="google-oauth", max_age=600)
            user = User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from OAuth state: %s", exc)
            return Response({"error": "invalid_state"}, status=status.HTTP_400_BAD_REQUEST)

        flow = _build_google_flow()
        flow.redirect_uri = settings.GOOGLE_REDIRECT_URI

        try:
            flow.fetch_token(code=code)
        except Exception as exc:
            logger.exception("Google OAuth token exchange failed: %s", exc)
            return Response(
                {"detail": "Token exchange failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        creds = flow.credentials

        # Save / update the OAuthCredential record so the status API reflects the connection.
        if user:
            import datetime
            from django.utils import timezone
            expiry = None
            if creds.expiry:
                expiry = timezone.make_aware(creds.expiry) if creds.expiry.tzinfo is None else creds.expiry
            OAuthCredential.objects.update_or_create(
                user=user,
                provider="google",
                defaults={
                    "access_token": creds.token or "",
                    "refresh_token": creds.refresh_token or "",
                    "token_expiry": expiry,
                    "scopes": " ".join(creds.scopes or GOOGLE_SCOPES),
                    "is_active": True,
                },
            )
            # Kick off an immediate calendar sync so events appear right away.
            try:
                _sync_google_calendar(user, creds)
            except Exception as exc:
                logger.warning("Initial Google Calendar sync failed: %s", exc)

        from django.http import HttpResponse
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Google Calendar connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


class GoogleCalendarSyncView(APIView):
    """Manually trigger a Google Calendar sync for the current user."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            cred = OAuthCredential.objects.get(user=request.user, provider="google", is_active=True)
        except OAuthCredential.DoesNotExist:
            return Response({"detail": "Google not connected."}, status=status.HTTP_400_BAD_REQUEST)

        from google.oauth2.credentials import Credentials
        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=cred.scopes.split(),
        )
        try:
            _sync_google_calendar(request.user, google_creds)
        except Exception:
            logger.exception("Manual Google Calendar sync failed")
            return Response({"detail": "An unexpected error occurred."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        from scheduler.models import CalendarEvent
        from realtime.sync import publish_activity_event
        count = CalendarEvent.objects.filter(owner=request.user).count()
        publish_activity_event(
            request.user, "sync.google_calendar",
            "**Synced** Google Calendar",
            detail=f"{count} events",
            metadata={"event_count": count},
        )
        return Response({"detail": "Sync complete.", "event_count": count})


class GoogleActionItemsPushView(APIView):
    """Push locally-scheduled action items to Google Calendar (create or update)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            cred = OAuthCredential.objects.get(user=request.user, provider="google", is_active=True)
        except OAuthCredential.DoesNotExist:
            return Response({"detail": "Google not connected."}, status=status.HTTP_400_BAD_REQUEST)

        items = request.data.get("items", [])
        if not isinstance(items, list):
            return Response({"detail": "items must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=cred.scopes.split(),
        )

        try:
            service = build("calendar", "v3", credentials=google_creds, cache_discovery=False)
        except Exception:
            logger.exception("Failed to build Google Calendar service for action item push")
            return Response({"detail": "Could not connect to Google Calendar."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        import time as _time
        from googleapiclient.errors import HttpError as _HttpError

        def _gcal_execute_with_retry(request_obj, label=""):
            """Execute a Google Calendar API request with exponential backoff on 429."""
            delay = 1
            for attempt in range(5):
                try:
                    return request_obj.execute()
                except _HttpError as exc:
                    if exc.status_code == 429 and attempt < 4:
                        logger.warning("Google Calendar rate limited (429) for %s; retrying in %ds", label, delay)
                        _time.sleep(delay)
                        delay = min(delay * 2, 16)
                    else:
                        raise
            return None  # unreachable

        results = []
        for idx, item in enumerate(items):
            airtable_id = item.get("airtableId", "")
            start = item.get("start", "")
            end = item.get("end", "")
            task = item.get("task", "Action Item")
            account_name = item.get("accountName") or ""
            existing_google_id = item.get("googleEventId") or ""

            if not airtable_id or not start or not end:
                continue

            # Throttle: small pause between items to stay under Google's quota
            if idx > 0:
                _time.sleep(0.2)

            # Ensure RFC3339 format — bare "YYYY-MM-DDTHH:MM:SS" (no tz) is
            # treated as UTC as a last-resort fallback; the frontend should
            # always send a proper offset like "...T09:00:00-07:00".
            if len(start) == 19:
                start = start + "Z"
            if len(end) == 19:
                end = end + "Z"

            description = f"Action Item from Agent PM\nAccount: {account_name}" if account_name else "Action Item from Agent PM"

            event_body = {
                "summary": task,
                "description": description,
                "start": {"dateTime": start},
                "end": {"dateTime": end},
                "extendedProperties": {
                    "private": {
                        "agentpm_airtable_id": airtable_id,
                        "agentpm_source": "action_item",
                    }
                },
                "colorId": "3",  # grape/purple in Google Calendar
            }

            try:
                # Dedup guard: check if this airtable_id already has a synced CalendarEvent
                # in our DB — if so, return its google_event_id without touching Google.
                from scheduler.models import CalendarEvent as CalEv
                existing_db_event = CalEv.objects.filter(
                    owner=request.user,
                    agentpm_airtable_id=airtable_id,
                    is_synced=True,
                ).exclude(google_event_id="").first()
                if existing_db_event:
                    results.append({
                        "airtableId": airtable_id,
                        "start": item.get("start"),
                        "googleEventId": existing_db_event.google_event_id,
                    })
                    continue

                if existing_google_id:
                    # Try to update; if the event was deleted from Google, fall through to create
                    try:
                        updated = _gcal_execute_with_retry(
                            service.events().update(
                                calendarId="primary",
                                eventId=existing_google_id,
                                body=event_body,
                            ),
                            label=airtable_id,
                        )
                        results.append({"airtableId": airtable_id, "start": item.get("start"), "googleEventId": updated["id"]})
                        continue
                    except Exception:
                        logger.warning("Google event %s not found for action item %s — will create a new one", existing_google_id, airtable_id)
                # Create new event (either no existing ID, or update failed above)
                created = _gcal_execute_with_retry(
                    service.events().insert(
                        calendarId="primary",
                        body=event_body,
                    ),
                    label=airtable_id,
                )
                results.append({"airtableId": airtable_id, "start": item.get("start"), "googleEventId": created["id"]})
            except Exception:
                logger.exception("Failed to push action item %s to Google Calendar", airtable_id)
                results.append({"airtableId": airtable_id, "start": item.get("start"), "googleEventId": ""})

        return Response({"results": results})


GMAIL_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]


class GmailOAuthInitView(APIView):
    """
    Kick off a dedicated Gmail OAuth2 flow (separate credential from Google Calendar).

    If GMAIL_OKTA_IDP_ID is set, the authorization URL is routed through the
    Okta-managed Google IdP tile — the user lands on the Okta SSO page rather
    than the standard Google consent screen.  Leave it blank to use Google directly.

    GET /api/v1/integrations/gmail/connect/
    Returns: { authorization_url: str }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.core import signing
        from urllib.parse import urlencode

        flow = _build_google_flow(scopes=GMAIL_SCOPES)
        flow.redirect_uri = settings.GMAIL_REDIRECT_URI

        state_payload = signing.dumps({"uid": request.user.pk}, salt="gmail-oauth")
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state_payload,
        )

        # If an Okta IdP is configured for this Google app, rewrite the auth URL
        # to route through Okta's IdP-initiated flow so the user goes through
        # the corporate SSO tile instead of the bare Google consent screen.
        okta_idp_id = getattr(settings, "GMAIL_OKTA_IDP_ID", "")
        if okta_idp_id:
            okta_domain = getattr(settings, "OKTA_AUTHORIZATION_ENDPOINT", "")
            # Extract the base domain from the OIDC authorization endpoint.
            # e.g. https://twilio.okta.com/oauth2/default/v1/authorize
            #   → https://twilio.okta.com
            import re as _re
            m = _re.match(r"(https://[^/]+)", okta_domain)
            if m:
                okta_base = m.group(1)
                idp_params = urlencode({
                    "fromURI": auth_url,
                    "idp": okta_idp_id,
                })
                auth_url = f"{okta_base}/login/login.htm?{idp_params}"

        return Response({"authorization_url": auth_url})


class GmailOAuthCallbackView(APIView):
    """
    Handle the Gmail-specific OAuth2 redirect.  Stores credentials under the
    'gmail' provider key (distinct from the 'google' Calendar credential) so
    the two can be connected and revoked independently.

    GET /api/v1/integrations/gmail/callback/
    """

    permission_classes = [AllowAny]

    def get(self, request):
        from django.core import signing
        from django.contrib.auth import get_user_model
        User = get_user_model()

        code = request.query_params.get("code")
        if not code:
            return Response({"error": "missing_code"}, status=status.HTTP_400_BAD_REQUEST)

        raw_state = request.query_params.get("state", "")
        try:
            payload = signing.loads(raw_state, salt="gmail-oauth", max_age=600)
            user = User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("GmailOAuthCallback: could not resolve user from state: %s", exc)
            return Response({"error": "invalid_state"}, status=status.HTTP_400_BAD_REQUEST)

        flow = _build_google_flow(scopes=GMAIL_SCOPES)
        flow.redirect_uri = settings.GMAIL_REDIRECT_URI

        try:
            flow.fetch_token(code=code)
        except Exception as exc:
            logger.exception("Gmail OAuth token exchange failed: %s", exc)
            return Response({"detail": "Token exchange failed."}, status=status.HTTP_400_BAD_REQUEST)

        creds = flow.credentials

        import datetime
        from django.utils import timezone
        expiry = None
        if creds.expiry:
            expiry = timezone.make_aware(creds.expiry) if creds.expiry.tzinfo is None else creds.expiry

        OAuthCredential.objects.update_or_create(
            user=user,
            provider="gmail",
            defaults={
                "access_token": creds.token or "",
                "refresh_token": creds.refresh_token or "",
                "token_expiry": expiry,
                "scopes": " ".join(creds.scopes or GMAIL_SCOPES),
                "is_active": True,
            },
        )

        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Gmail connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


class GmailTestView(APIView):
    """
    Smoke-test the Gmail connection by calling users.getProfile().
    Returns the authenticated Gmail address and whether the gmail.modify
    scope was actually granted.

    GET /api/v1/integrations/gmail/test/
    Returns: { ok: bool, email: str, scopes: [str], error?: str }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Prefer the standalone Gmail credential; fall back to the combined Google one.
        cred = (
            OAuthCredential.objects.filter(user=request.user, provider="gmail", is_active=True).first()
            or OAuthCredential.objects.filter(user=request.user, provider="google", is_active=True).first()
        )
        if not cred:
            return Response({"ok": False, "error": "Gmail not connected."}, status=status.HTTP_400_BAD_REQUEST)

        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build as g_build
        from google.auth.exceptions import RefreshError

        stored_scopes = cred.scopes.split() if cred.scopes else []
        gmail_scope = "https://www.googleapis.com/auth/gmail.modify"
        gmail_readonly_scope = "https://www.googleapis.com/auth/gmail.readonly"
        has_gmail_scope = any(s in stored_scopes for s in (gmail_scope, gmail_readonly_scope))

        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=stored_scopes,
        )

        try:
            gmail = g_build("gmail", "v1", credentials=google_creds, cache_discovery=False)
            profile = gmail.users().getProfile(userId="me").execute()
            return Response({
                "ok": True,
                "email": profile.get("emailAddress", ""),
                "messages_total": profile.get("messagesTotal"),
                "scopes": stored_scopes,
                "gmail_scope_granted": has_gmail_scope,
            })
        except RefreshError as exc:
            # Token is expired and the refresh failed — user needs to re-authorise.
            cred.is_active = False
            cred.save(update_fields=["is_active"])
            return Response({"ok": False, "error": f"Token expired and could not be refreshed: {exc}"}, status=status.HTTP_401_UNAUTHORIZED)
        except Exception as exc:
            return Response({"ok": False, "error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


class GmailThreadsView(APIView):
    """
    Fetch Gmail threads relevant to a customer account, then use Claude to
    summarise each thread and derive a current status.

    GET /api/v1/integrations/gmail/threads/?account_domain=acme.com&account_name=Acme Corp
    Returns: { threads: [ { id, subject, participants, message_count, last_date,
                             snippet, messages: [{from,date,body}],
                             summary, status, status_color } ] }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        account_domain = request.query_params.get("account_domain", "").strip().lower()
        account_name   = request.query_params.get("account_name",   "").strip()
        search_extra   = request.query_params.get("q", "").strip()

        if not account_domain and not account_name:
            return Response({"detail": "account_domain or account_name required."}, status=400)

        # ── 1. Build Gmail credentials from stored OAuth token ──────────────
        cred = (
            OAuthCredential.objects.filter(user=request.user, provider="gmail", is_active=True).first()
            or OAuthCredential.objects.filter(user=request.user, provider="google", is_active=True).first()
        )
        if not cred:
            return Response({"detail": "Gmail not connected. Connect Gmail from Settings."}, status=400)

        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build as g_build
        import base64, email as email_lib

        google_creds = Credentials(
            token=cred.access_token,
            refresh_token=cred.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            scopes=cred.scopes.split(),
        )

        gmail = g_build("gmail", "v1", credentials=google_creds, cache_discovery=False)

        # ── 2. Build search query ─────────────────────────────────────────────
        query_parts = []
        if account_domain:
            query_parts.append(f"from:{account_domain} OR to:{account_domain}")
        if account_name:
            query_parts.append(f'"{account_name}"')
        if search_extra:
            query_parts.append(search_extra)
        query = " OR ".join(f"({p})" for p in query_parts) if len(query_parts) > 1 else (query_parts[0] if query_parts else "")

        # ── 3. Fetch thread list (max 20) ─────────────────────────────────────
        resp = gmail.users().threads().list(
            userId="me", q=query, maxResults=20
        ).execute()
        raw_threads = resp.get("threads", [])

        # ── 4. Fetch each thread's messages ────────────────────────────────────
        def decode_body(part):
            data = part.get("body", {}).get("data", "")
            if not data:
                for sub in part.get("parts", []):
                    result = decode_body(sub)
                    if result:
                        return result
            if data:
                try:
                    return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
                except Exception:
                    return ""
            return ""

        def header(msg, name):
            return next(
                (h["value"] for h in msg.get("payload", {}).get("headers", [])
                 if h["name"].lower() == name.lower()),
                ""
            )

        threads_data = []
        for t in raw_threads:
            thread_detail = gmail.users().threads().get(
                userId="me", id=t["id"], format="full"
            ).execute()

            messages_raw = thread_detail.get("messages", [])
            if not messages_raw:
                continue

            messages = []
            for m in messages_raw:
                body = decode_body(m.get("payload", {}))
                # Strip quoted reply blocks (lines starting with >) for brevity
                clean = "\n".join(
                    l for l in body.splitlines()
                    if not l.strip().startswith(">") and not l.strip().startswith("On ")
                )[:2000]
                messages.append({
                    "from":    header(m, "from"),
                    "date":    header(m, "date"),
                    "subject": header(m, "subject"),
                    "body":    clean.strip(),
                })

            first_msg = messages_raw[0]
            last_msg  = messages_raw[-1]
            subject = header(first_msg, "subject") or "(no subject)"
            last_date = header(last_msg, "date")
            participants = list({
                header(m_raw, "from").split("<")[0].strip()
                for m_raw in messages_raw
            })

            threads_data.append({
                "id":            t["id"],
                "subject":       subject,
                "participants":  participants,
                "message_count": len(messages),
                "last_date":     last_date,
                "snippet":       messages_raw[-1].get("snippet", "")[:200],
                "messages":      messages,
                "summary":       None,
                "status":        None,
                "status_color":  None,
            })

        if not threads_data:
            return Response({"threads": []})

        # ── 5. Claude: summarise + status each thread ─────────────────────────
        import anthropic
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY) if hasattr(settings, "ANTHROPIC_API_KEY") and settings.ANTHROPIC_API_KEY else None

        if client:
            for t in threads_data:
                body_for_claude = "\n\n---\n\n".join(
                    f"From: {m['from']}\nDate: {m['date']}\n\n{m['body']}"
                    for m in t["messages"]
                )[:6000]
                prompt = (
                    f"You are a customer success assistant. Below is an email thread with subject: \"{t['subject']}\".\n\n"
                    f"{body_for_claude}\n\n"
                    "Respond with a JSON object (no markdown fences) with exactly these keys:\n"
                    "  summary: 2-3 sentence plain-English summary of what this thread is about and the key points\n"
                    "  status: one of: Open, In Progress, Resolved, Needs Attention, Waiting on Customer, Waiting on Us\n"
                    "  status_color: one of: red, amber, green, blue, gray\n"
                    "  next_action: one sentence on the recommended next step, or empty string if resolved"
                )
                try:
                    msg = client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=300,
                        messages=[{"role": "user", "content": prompt}],
                    )
                    import json as _json
                    parsed = _json.loads(msg.content[0].text)
                    t["summary"]      = parsed.get("summary", "")
                    t["status"]       = parsed.get("status", "Open")
                    t["status_color"] = parsed.get("status_color", "gray")
                    t["next_action"]  = parsed.get("next_action", "")
                except Exception:
                    t["summary"]      = t["snippet"]
                    t["status"]       = "Open"
                    t["status_color"] = "gray"
                    t["next_action"]  = ""
        else:
            for t in threads_data:
                t["summary"]      = t["snippet"]
                t["status"]       = "Open"
                t["status_color"] = "gray"
                t["next_action"]  = ""

        # Strip full message bodies from thread list response to keep payload light
        # (full messages returned on demand via separate endpoint)
        for t in threads_data:
            pass  # messages already included for chat context

        return Response({"threads": threads_data})


class IntegrationStatusView(APIView):
    """Return connected integrations for the current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        credentials = OAuthCredential.objects.filter(user=request.user, is_active=True)
        sync_states = SyncState.objects.filter(user=request.user)
        return Response(
            {
                "connected": OAuthCredentialSerializer(credentials, many=True).data,
                "sync_states": SyncStateSerializer(sync_states, many=True).data,
            }
        )


_VALID_PROVIDERS = {choice[0] for choice in OAuthCredential.PROVIDER_CHOICES}


class IntegrationDisconnectView(APIView):
    """
    Delete the caller's OAuthCredential for a given provider.

    Note: this removes the token from our database only — tokens remain valid
    at the provider until they expire. The next OAuth flow will re-issue.
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request, provider: str):
        provider = (provider or "").strip().lower()
        if provider not in _VALID_PROVIDERS:
            return Response({"detail": "Unknown provider."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = OAuthCredential.objects.filter(user=request.user, provider=provider).delete()
        SyncState.objects.filter(user=request.user, provider=provider).delete()
        if not deleted:
            return Response({"detail": "Not connected."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


SLACK_SCOPES = "channels:history,channels:read,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,reactions:read,users:read,users.profile:read"


class SlackOAuthInitView(APIView):
    """Kick off the Slack OAuth2 flow — returns an authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.SLACK_CLIENT_ID:
            return Response(
                {"detail": "SLACK_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from django.core import signing
        from urllib.parse import urlencode
        state = signing.dumps({"uid": request.user.pk}, salt="slack-oauth")
        params = {
            "client_id": settings.SLACK_CLIENT_ID,
            "scope": SLACK_SCOPES,
            "redirect_uri": settings.SLACK_REDIRECT_URI,
            "state": state,
        }
        auth_url = "https://slack.com/oauth/v2/authorize?" + urlencode(params)
        return Response({"authorization_url": auth_url, "state": state})


class SlackOAuthCallbackView(APIView):
    """Handle the Slack OAuth2 redirect, exchange code for token, persist it."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")
        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()
        user = None
        try:
            payload = signing.loads(raw_state, salt="slack-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from Slack OAuth state: %s", exc)
            return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

        resp = requests.post(
            "https://slack.com/api/oauth.v2.access",
            data={
                "code": code,
                "client_id": settings.SLACK_CLIENT_ID,
                "client_secret": settings.SLACK_CLIENT_SECRET,
                "redirect_uri": settings.SLACK_REDIRECT_URI,
            },
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            logger.error("Slack OAuth failed: %s", data.get("error"))
            return Response(
                {"detail": f"Slack error: {data.get('error')}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        OAuthCredential.objects.update_or_create(
            user=user,
            provider="slack",
            defaults={
                "access_token": data["access_token"],
                "refresh_token": "",
                "token_expiry": None,
                "scopes": SLACK_SCOPES,
                "is_active": True,
            },
        )
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Slack connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


class AirtableConnectView(APIView):
    """Mark Airtable as connected using the server-side API key from .env."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not settings.AIRTABLE_API_KEY:
            return Response(
                {"detail": "AIRTABLE_API_KEY is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        # Airtable uses a shared server-side API key — not a per-user credential.
        # We mark the user as connected without copying the key into their DB record.
        OAuthCredential.objects.update_or_create(
            user=request.user,
            provider="airtable",
            defaults={
                "access_token": "",
                "refresh_token": "",
                "token_expiry": None,
                "scopes": "data.records:read data.records:write schema.bases:read",
                "is_active": True,
            },
        )
        return Response({"detail": "Airtable connected successfully."})


class SalesforceOAuthInitView(APIView):
    """Kick off the Salesforce OAuth2 Authorization Code flow."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.SALESFORCE_CLIENT_ID:
            return Response(
                {"detail": "SALESFORCE_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from django.core import signing
        from urllib.parse import urlencode
        state = signing.dumps({"uid": request.user.pk}, salt="sf-oauth")
        params = {
            "response_type": "code",
            "client_id": settings.SALESFORCE_CLIENT_ID,
            "redirect_uri": settings.SALESFORCE_REDIRECT_URI,
            "scope": "api refresh_token full",
            "state": state,
        }
        base = settings.SALESFORCE_INSTANCE_URL.rstrip("/")
        auth_url = f"{base}/services/oauth2/authorize?" + urlencode(params)
        return Response({"authorization_url": auth_url})


class SalesforceOAuthCallbackView(APIView):
    """Handle the Salesforce OAuth2 callback — exchange code for tokens."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")

        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()
        user = None
        try:
            payload = signing.loads(raw_state, salt="sf-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from SF OAuth state: %s", exc)
            return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

        base = settings.SALESFORCE_INSTANCE_URL.rstrip("/")
        resp = requests.post(
            f"{base}/services/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.SALESFORCE_CLIENT_ID,
                "client_secret": settings.SALESFORCE_CLIENT_SECRET,
                "redirect_uri": settings.SALESFORCE_REDIRECT_URI,
            },
            timeout=15,
        )
        if not resp.ok:
            logger.error("SF token exchange failed: %s", resp.text)
            return Response(
                {"detail": "Salesforce authentication failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = resp.json()
        from django.utils import timezone
        import datetime

        OAuthCredential.objects.update_or_create(
            user=user,
            provider="salesforce",
            defaults={
                "access_token": data.get("access_token", ""),
                "refresh_token": data.get("refresh_token", ""),
                "token_expiry": None,
                "scopes": "api refresh_token full",
                "is_active": True,
            },
        )

        # Kick off an immediate sync + namespace discovery
        try:
            from salesforce_sync.sync import sync_all
            sync_all(user)
        except Exception as exc:
            logger.warning("Initial SF sync failed (non-fatal): %s", exc)

        from django.http import HttpResponse
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Salesforce connected!</h2>"
            "<p style='font-family:sans-serif'>Syncing your projects... You can close this tab.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


class TwilioWebhookView(TwilioSignatureRequiredMixin, APIView):
    """Receive inbound Twilio webhooks (voice, SMS, status callbacks)."""

    permission_classes = [AllowAny]

    def post(self, request):
        log = WebhookLog.objects.create(
            source="twilio",
            event_type=request.data.get("CallStatus") or request.data.get("MessageStatus") or "",
            payload=dict(request.data),
            headers=_scrub_headers(dict(request.headers)),
        )
        logger.info("Twilio webhook received: log_id=%s", log.pk)
        return Response({"detail": "Received."})


class SlackWebhookView(APIView):
    """Receive inbound Slack event webhooks."""

    permission_classes = [AllowAny]

    def post(self, request):
        if not settings.SLACK_SIGNING_SECRET:
            logger.error("SLACK_SIGNING_SECRET not configured — rejecting Slack webhook")
            return Response({"error": "Slack signing secret not configured"}, status=503)

        from slack_sdk.signature import SignatureVerifier
        verifier = SignatureVerifier(settings.SLACK_SIGNING_SECRET)
        if not verifier.is_valid_request(request.body, request.headers):
            logger.warning("Invalid Slack signature from %s", request.META.get("REMOTE_ADDR"))
            return HttpResponse("Forbidden", status=403)

        payload = request.data

        # Slack URL verification challenge.
        if payload.get("type") == "url_verification":
            return Response({"challenge": payload["challenge"]})

        log = WebhookLog.objects.create(
            source="slack",
            event_type=payload.get("event", {}).get("type", ""),
            payload=payload,
            headers=_scrub_headers(dict(request.headers)),
        )
        logger.info("Slack webhook received: log_id=%s", log.pk)
        return Response({"detail": "Received."})


# ── GitHub ─────────────────────────────────────────────────────────────────────

class GitHubOAuthInitView(APIView):
    """Kick off the GitHub OAuth2 flow — returns an authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.GITHUB_CLIENT_ID:
            return Response(
                {"detail": "GITHUB_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from django.core import signing
        from urllib.parse import urlencode
        state = signing.dumps({"uid": request.user.pk}, salt="github-oauth")
        params = {
            "client_id": settings.GITHUB_CLIENT_ID,
            "redirect_uri": settings.GITHUB_REDIRECT_URI,
            "scope": "repo,read:user,user:email",
            "state": state,
        }
        auth_url = "https://github.com/login/oauth/authorize?" + urlencode(params)
        return Response({"authorization_url": auth_url})


class GitHubOAuthCallbackView(APIView):
    """Handle the GitHub OAuth2 redirect, exchange code for token, persist it."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")
        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()
        try:
            payload = signing.loads(raw_state, salt="github-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from GitHub OAuth state: %s", exc)
            return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

        resp = requests.post(
            "https://github.com/login/oauth/access_token",
            data={
                "code": code,
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "redirect_uri": settings.GITHUB_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )
        if not resp.ok:
            logger.error("GitHub token exchange failed: %s", resp.text)
            return Response(
                {"detail": "GitHub authentication failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = resp.json()
        if "error" in data:
            logger.error("GitHub OAuth error: %s", data.get("error_description", data["error"]))
            return Response(
                {"detail": f"GitHub error: {data.get('error_description', data['error'])}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        OAuthCredential.objects.update_or_create(
            user=user,
            provider="github",
            defaults={
                "access_token": data.get("access_token", ""),
                "refresh_token": "",
                "token_expiry": None,
                "scopes": data.get("scope", "repo,read:user,user:email"),
                "is_active": True,
            },
        )
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>GitHub connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


# ── Google Drive / Docs / Sheets ───────────────────────────────────────────────

class GoogleDriveOAuthInitView(APIView):
    """Kick off the Google Drive/Docs/Sheets OAuth2 flow — returns an authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.core import signing
        flow = _build_google_flow(scopes=GOOGLE_DRIVE_SCOPES)
        flow.redirect_uri = settings.GOOGLE_DRIVE_REDIRECT_URI
        state_payload = signing.dumps({"uid": request.user.pk}, salt="gdrive-oauth")
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state_payload,
        )
        return Response({"authorization_url": auth_url})


class GoogleDriveOAuthCallbackView(APIView):
    """Handle the Google Drive OAuth2 redirect, exchange code for tokens, persist them."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")
        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()
        try:
            payload = signing.loads(raw_state, salt="gdrive-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from Google Drive OAuth state: %s", exc)
            return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

        flow = _build_google_flow(scopes=GOOGLE_DRIVE_SCOPES)
        flow.redirect_uri = settings.GOOGLE_DRIVE_REDIRECT_URI

        try:
            flow.fetch_token(code=code)
        except Exception as exc:
            logger.exception("Google Drive OAuth token exchange failed: %s", exc)
            return Response(
                {"detail": "Token exchange failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        creds = flow.credentials

        import datetime
        from django.utils import timezone
        expiry = None
        if creds.expiry:
            expiry = timezone.make_aware(creds.expiry) if creds.expiry.tzinfo is None else creds.expiry

        OAuthCredential.objects.update_or_create(
            user=user,
            provider="google_drive",
            defaults={
                "access_token": creds.token or "",
                "refresh_token": creds.refresh_token or "",
                "token_expiry": expiry,
                "scopes": " ".join(creds.scopes or GOOGLE_DRIVE_SCOPES),
                "is_active": True,
            },
        )
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Google Drive, Docs &amp; Sheets connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


# ── Notion ─────────────────────────────────────────────────────────────────────

class NotionOAuthInitView(APIView):
    """Kick off the Notion OAuth2 flow — returns an authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.NOTION_CLIENT_ID:
            return Response(
                {"detail": "NOTION_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from django.core import signing
        from urllib.parse import urlencode
        state = signing.dumps({"uid": request.user.pk}, salt="notion-oauth")
        params = {
            "client_id": settings.NOTION_CLIENT_ID,
            "redirect_uri": settings.NOTION_REDIRECT_URI,
            "response_type": "code",
            "owner": "user",
            "state": state,
        }
        auth_url = "https://api.notion.com/v1/oauth/authorize?" + urlencode(params)
        return Response({"authorization_url": auth_url})


class NotionOAuthCallbackView(APIView):
    """Handle the Notion OAuth2 redirect, exchange code for token, persist it."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")
        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()
        try:
            payload = signing.loads(raw_state, salt="notion-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from Notion OAuth state: %s", exc)
            return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

        resp = requests.post(
            "https://api.notion.com/v1/oauth/token",
            auth=(settings.NOTION_CLIENT_ID, settings.NOTION_CLIENT_SECRET),
            json={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.NOTION_REDIRECT_URI,
            },
            timeout=10,
        )
        if not resp.ok:
            logger.error("Notion token exchange failed: %s", resp.text)
            return Response(
                {"detail": "Notion authentication failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = resp.json()
        OAuthCredential.objects.update_or_create(
            user=user,
            provider="notion",
            defaults={
                "access_token": data.get("access_token", ""),
                "refresh_token": "",
                "token_expiry": None,
                "scopes": "",
                "is_active": True,
            },
        )
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Notion connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


# ── Microsoft Teams ────────────────────────────────────────────────────────────

MICROSOFT_SCOPES = "offline_access User.Read Team.ReadBasic.All Channel.ReadBasic.All Chat.Read"


class MicrosoftOAuthInitView(APIView):
    """Kick off the Microsoft OAuth2 flow — returns an authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.MICROSOFT_CLIENT_ID:
            return Response(
                {"detail": "MICROSOFT_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from django.core import signing
        from urllib.parse import urlencode
        state = signing.dumps({"uid": request.user.pk}, salt="ms-oauth")
        params = {
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": settings.MICROSOFT_REDIRECT_URI,
            "scope": MICROSOFT_SCOPES,
            "state": state,
        }
        auth_url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + urlencode(params)
        return Response({"authorization_url": auth_url})


class MicrosoftOAuthCallbackView(APIView):
    """Handle the Microsoft OAuth2 redirect, exchange code for tokens, persist them."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")
        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()
        try:
            payload = signing.loads(raw_state, salt="ms-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Could not resolve user from Microsoft OAuth state: %s", exc)
            return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

        resp = requests.post(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.MICROSOFT_CLIENT_ID,
                "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                "redirect_uri": settings.MICROSOFT_REDIRECT_URI,
                "scope": MICROSOFT_SCOPES,
            },
            timeout=15,
        )
        if not resp.ok:
            logger.error("Microsoft token exchange failed: %s", resp.text)
            return Response(
                {"detail": "Microsoft authentication failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = resp.json()
        OAuthCredential.objects.update_or_create(
            user=user,
            provider="microsoft",
            defaults={
                "access_token": data.get("access_token", ""),
                "refresh_token": data.get("refresh_token", ""),
                "token_expiry": None,
                "scopes": MICROSOFT_SCOPES,
                "is_active": True,
            },
        )
        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Microsoft Teams connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


class SlackNotifyMentionView(APIView):
    """
    POST /integrations/slack/notify-mention/
    Body: { slack_handle: str, message: str }

    Sends a DM to the team member via their Slack handle.
    Silently succeeds (200) when Slack is not configured so the frontend
    never needs to handle a hard error.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not settings.SLACK_BOT_TOKEN:
            return Response({"detail": "Slack not configured — notification skipped."})

        slack_handle = (request.data.get("slack_handle") or "").lstrip("@").strip()
        message = (request.data.get("message") or "").strip()

        if not slack_handle or not message:
            return Response(
                {"detail": "slack_handle and message are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from slack_sdk import WebClient
            client = WebClient(token=settings.SLACK_BOT_TOKEN)

            # Resolve @handle → Slack user ID via users.lookupByEmail is not
            # possible without email, so we search by display name instead.
            lookup = client.users_list(limit=200)
            members = lookup.get("members", [])
            slack_user_id = None
            for m in members:
                profile = m.get("profile", {})
                display = (profile.get("display_name") or "").lstrip("@").lower()
                real = (profile.get("real_name") or "").lower()
                handle_lc = slack_handle.lower()
                if display == handle_lc or real == handle_lc or m.get("name", "").lower() == handle_lc:
                    slack_user_id = m["id"]
                    break

            if not slack_user_id:
                logger.warning("SlackNotifyMention: could not find Slack user for handle '%s'", slack_handle)
                return Response({"detail": f"Slack user '@{slack_handle}' not found — notification skipped."})

            # Open a DM channel and post the message.
            conv = client.conversations_open(users=[slack_user_id])
            channel_id = conv["channel"]["id"]
            client.chat_postMessage(channel=channel_id, text=message)
            logger.info("SlackNotifyMention: sent DM to @%s (%s)", slack_handle, slack_user_id)
            return Response({"detail": "Sent."})

        except Exception:
            logger.exception("SlackNotifyMention: failed to send DM to @%s", slack_handle)
            return Response({"detail": "Slack notification failed — continuing."})


# ─────────────────────────────────────────────────────────────────────────────
# Atlassian OAuth (Confluence + JIRA — per-user)
# ─────────────────────────────────────────────────────────────────────────────

_ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token"
_ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"


def _atlassian_init(request, client_id_setting, redirect_uri_setting, scope, state_salt):
    """Shared helper for Confluence and JIRA OAuth init."""
    if not getattr(settings, client_id_setting, ""):
        return Response(
            {"detail": f"{client_id_setting} is not configured."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    from django.core import signing
    from urllib.parse import urlencode

    state = signing.dumps({"uid": request.user.pk}, salt=state_salt)
    params = {
        "audience": "api.atlassian.com",
        "client_id": getattr(settings, client_id_setting),
        "scope": scope,
        "redirect_uri": getattr(settings, redirect_uri_setting),
        "state": state,
        "response_type": "code",
        "prompt": "consent",
    }
    auth_url = "https://auth.atlassian.com/authorize?" + urlencode(params)
    return Response({"authorization_url": auth_url})


def _atlassian_callback(request, client_id_setting, client_secret_setting,
                        redirect_uri_setting, provider, state_salt, config_updater=None):
    """Shared helper for Confluence and JIRA OAuth callback."""
    code = request.query_params.get("code")
    raw_state = request.query_params.get("state", "")

    if not code:
        return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

    from django.core import signing
    from django.contrib.auth import get_user_model
    _User = get_user_model()

    try:
        payload = signing.loads(raw_state, salt=state_salt, max_age=600)
        user = _User.objects.get(pk=payload["uid"])
    except Exception as exc:
        logger.warning("Atlassian OAuth (%s): could not resolve user from state: %s", provider, exc)
        return Response({"detail": "Invalid state."}, status=status.HTTP_400_BAD_REQUEST)

    resp = requests.post(
        _ATLASSIAN_TOKEN_URL,
        json={
            "grant_type": "authorization_code",
            "client_id": getattr(settings, client_id_setting),
            "client_secret": getattr(settings, client_secret_setting),
            "code": code,
            "redirect_uri": getattr(settings, redirect_uri_setting),
        },
        headers={"Content-Type": "application/json"},
        timeout=15,
    )
    if not resp.ok:
        logger.error("Atlassian token exchange failed (%s): %s", provider, resp.text[:300])
        return Response(
            {"detail": "Atlassian authentication failed."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    data = resp.json()
    access_token = data.get("access_token", "")
    refresh_token = data.get("refresh_token", "")

    # Fetch the accessible cloud sites so we know the cloud_id for API calls.
    sites_resp = requests.get(
        _ATLASSIAN_RESOURCES_URL,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        timeout=10,
    )
    cloud_id = ""
    cloud_name = ""
    if sites_resp.ok:
        sites = sites_resp.json()
        if sites:
            cloud_id = sites[0].get("id", "")
            cloud_name = sites[0].get("name", "")

    OAuthCredential.objects.update_or_create(
        user=user,
        provider=provider,
        defaults={
            "access_token": access_token,
            "refresh_token": refresh_token,
            "scopes": "",
            "is_active": True,
        },
    )

    if config_updater and cloud_id:
        config_updater(user=user, cloud_id=cloud_id, cloud_name=cloud_name)

    label = "Confluence" if provider == "confluence" else "JIRA"
    return HttpResponse(
        f"<h2 style='font-family:sans-serif;color:#4caf50'>{label} connected!</h2>"
        "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
        "<script>setTimeout(() => window.close(), 2000)</script>"
    )


class ConfluenceOAuthInitView(APIView):
    """GET /integrations/confluence/connect/ — return the Atlassian authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return _atlassian_init(
            request,
            client_id_setting="CONFLUENCE_CLIENT_ID",
            redirect_uri_setting="CONFLUENCE_REDIRECT_URI",
            scope="read:confluence-content.all offline_access",
            state_salt="confluence-oauth",
        )


class ConfluenceOAuthCallbackView(APIView):
    """GET /integrations/confluence/callback/ — exchange code, store credential."""

    permission_classes = [AllowAny]

    def get(self, request):
        def _update_config(user, cloud_id, cloud_name):
            from confluence_sync.models import ConfluenceConfig
            ConfluenceConfig.objects.update_or_create(
                user=user, defaults={"cloud_id": cloud_id}
            )

        return _atlassian_callback(
            request,
            client_id_setting="CONFLUENCE_CLIENT_ID",
            client_secret_setting="CONFLUENCE_CLIENT_SECRET",
            redirect_uri_setting="CONFLUENCE_REDIRECT_URI",
            provider="confluence",
            state_salt="confluence-oauth",
            config_updater=_update_config,
        )


class JiraOAuthInitView(APIView):
    """GET /integrations/jira/connect/ — return the Atlassian authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return _atlassian_init(
            request,
            client_id_setting="JIRA_CLIENT_ID",
            redirect_uri_setting="JIRA_REDIRECT_URI",
            scope="read:jira-work read:jira-user offline_access",
            state_salt="jira-oauth",
        )


class JiraOAuthCallbackView(APIView):
    """GET /integrations/jira/callback/ — exchange code, store credential."""

    permission_classes = [AllowAny]

    def get(self, request):
        def _update_config(user, cloud_id, cloud_name):
            from jira_sync.models import JiraConfig
            JiraConfig.objects.update_or_create(
                user=user, defaults={"cloud_id": cloud_id, "cloud_name": cloud_name}
            )

        return _atlassian_callback(
            request,
            client_id_setting="JIRA_CLIENT_ID",
            client_secret_setting="JIRA_CLIENT_SECRET",
            redirect_uri_setting="JIRA_REDIRECT_URI",
            provider="jira",
            state_salt="jira-oauth",
            config_updater=_update_config,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Zendesk per-user OAuth
# ─────────────────────────────────────────────────────────────────────────────

class ZendeskOAuthInitView(APIView):
    """GET /integrations/zendesk/connect/ — return the Zendesk authorization URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not settings.ZENDESK_CLIENT_ID:
            return Response(
                {"detail": "ZENDESK_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if not settings.ZENDESK_SUBDOMAIN:
            return Response(
                {"detail": "ZENDESK_SUBDOMAIN is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        from django.core import signing
        from urllib.parse import urlencode

        state = signing.dumps({"uid": request.user.pk}, salt="zendesk-oauth")
        params = {
            "response_type": "code",
            "client_id": settings.ZENDESK_CLIENT_ID,
            "redirect_uri": settings.ZENDESK_REDIRECT_URI,
            "scope": "read",
            "state": state,
        }
        auth_url = (
            f"https://{settings.ZENDESK_SUBDOMAIN}.zendesk.com/oauth/authorizations/new?"
            + urlencode(params)
        )
        return Response({"authorization_url": auth_url})


class ZendeskOAuthCallbackView(APIView):
    """GET /integrations/zendesk/callback/ — exchange code, store per-user credential."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")

        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()

        try:
            payload = signing.loads(raw_state, salt="zendesk-oauth", max_age=600)
            user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Zendesk per-user OAuth: could not resolve user from state: %s", exc)
            return Response({"detail": "Invalid or expired state."}, status=status.HTTP_400_BAD_REQUEST)

        resp = requests.post(
            f"https://{settings.ZENDESK_SUBDOMAIN}.zendesk.com/oauth/tokens",
            json={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.ZENDESK_CLIENT_ID,
                "client_secret": settings.ZENDESK_CLIENT_SECRET,
                "redirect_uri": settings.ZENDESK_REDIRECT_URI,
                "scope": "read",
            },
            headers={"Content-Type": "application/json"},
            timeout=15,
        )

        if not resp.ok:
            logger.error("Zendesk per-user token exchange failed: %s", resp.text[:300])
            return Response(
                {"detail": "Zendesk authentication failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = resp.json()
        access_token = data.get("access_token", "")
        if not access_token:
            return Response(
                {"detail": "No access_token in Zendesk response."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        OAuthCredential.objects.update_or_create(
            user=user,
            provider="zendesk",
            defaults={
                "access_token": access_token,
                "refresh_token": "",
                "scopes": "read",
                "is_active": True,
            },
        )

        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Zendesk connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab and reload the dashboard.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Org-managed scraper views
# ─────────────────────────────────────────────────────────────────────────────

class ScraperStatusView(APIView):
    """
    GET /integrations/scraper-status/

    Returns which org-managed scraper tokens are configured.
    Confluence and JIRA share an Atlassian API token; Zendesk has its own
    admin OAuthCredential created by the admin connect flow.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "confluence": bool(settings.ATLASSIAN_API_TOKEN),
            "jira": bool(settings.ATLASSIAN_API_TOKEN),
            "zendesk": self._has_zendesk_admin_cred(),
            "gong": bool(settings.GONG_ACCESS_KEY),
            "notion": bool(settings.NOTION_INTEGRATION_TOKEN),
        })

    @staticmethod
    def _has_zendesk_admin_cred():
        return OAuthCredential.objects.filter(provider="zendesk_admin", is_active=True).exists()


class ConfluenceAPITokenConnectView(APIView):
    """
    POST /integrations/confluence/connect-token/
    Body: { email: str, api_token: str }

    Admin-triggered: validates the Atlassian API token against the configured
    Atlassian instance and stores it as an OAuthCredential for the requesting user.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        import base64
        email = (request.data.get("email") or "").strip()
        api_token = (request.data.get("api_token") or "").strip()
        if not email or not api_token:
            return Response(
                {"detail": "email and api_token are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Derive subdomain from ATLASSIAN_BASE_URL, e.g. "twilio-productivity"
        base_url = settings.ATLASSIAN_BASE_URL.rstrip("/")
        subdomain = base_url.split("//")[-1].split(".")[0]

        encoded = base64.b64encode(f"{email}:{api_token}".encode()).decode()
        headers = {"Authorization": f"Basic {encoded}", "Accept": "application/json"}
        test_url = f"{base_url}/wiki/rest/api/space?limit=1"

        try:
            resp = requests.get(test_url, headers=headers, timeout=10)
        except requests.RequestException as exc:
            logger.error("Confluence token validation request failed: %s", exc)
            return Response(
                {"detail": "Could not reach Atlassian instance."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not resp.ok:
            return Response(
                {"detail": f"Atlassian returned {resp.status_code}. Check email and API token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        OAuthCredential.objects.update_or_create(
            user=request.user,
            provider="confluence",
            defaults={
                "access_token": api_token,
                "refresh_token": "",
                "scopes": "read",
                "is_active": True,
            },
        )

        from confluence_sync.models import ConfluenceConfig
        ConfluenceConfig.objects.update_or_create(
            user=request.user,
            defaults={
                "cloud_id": subdomain,
                "atlassian_email": email,
            },
        )

        return Response({"detail": "Confluence connected."})


class ZendeskAdminConnectView(APIView):
    """
    GET /integrations/zendesk/admin-connect/

    Staff-only. Returns the Zendesk OAuth authorization URL so the admin can
    start the one-time OAuth flow. Requires ZENDESK_CLIENT_ID and
    ZENDESK_SUBDOMAIN to be set in .env.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.is_staff:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)

        if not settings.ZENDESK_CLIENT_ID:
            return Response(
                {"detail": "ZENDESK_CLIENT_ID is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        from django.core import signing
        from urllib.parse import urlencode

        state = signing.dumps({"uid": request.user.pk}, salt="zendesk-admin-oauth")
        params = {
            "response_type": "code",
            "client_id": settings.ZENDESK_CLIENT_ID,
            "redirect_uri": settings.ZENDESK_ADMIN_REDIRECT_URI,
            "scope": "read",
            "state": state,
        }
        auth_url = (
            f"https://{settings.ZENDESK_SUBDOMAIN}.zendesk.com/oauth/authorizations/new?"
            + urlencode(params)
        )
        return Response({"authorization_url": auth_url})


class ZendeskAdminCallbackView(APIView):
    """
    GET /integrations/zendesk/admin-callback/

    Receives the authorization code from Zendesk, exchanges it for an access
    token, and stores it as an OAuthCredential with provider="zendesk_admin".
    Only the admin user encoded in the state param can complete this flow.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        code = request.query_params.get("code")
        raw_state = request.query_params.get("state", "")

        if not code:
            return Response({"detail": "Missing code."}, status=status.HTTP_400_BAD_REQUEST)

        from django.core import signing
        from django.contrib.auth import get_user_model
        _User = get_user_model()

        try:
            payload = signing.loads(raw_state, salt="zendesk-admin-oauth", max_age=600)
            admin_user = _User.objects.get(pk=payload["uid"])
        except Exception as exc:
            logger.warning("Zendesk admin OAuth: could not resolve user from state: %s", exc)
            return Response({"detail": "Invalid or expired state."}, status=status.HTTP_400_BAD_REQUEST)

        if not admin_user.is_staff:
            return Response({"detail": "Staff access required."}, status=status.HTTP_403_FORBIDDEN)

        resp = requests.post(
            f"https://{settings.ZENDESK_SUBDOMAIN}.zendesk.com/oauth/tokens",
            json={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.ZENDESK_CLIENT_ID,
                "client_secret": settings.ZENDESK_CLIENT_SECRET,
                "redirect_uri": settings.ZENDESK_ADMIN_REDIRECT_URI,
                "scope": "read",
            },
            headers={"Content-Type": "application/json"},
            timeout=15,
        )

        if not resp.ok:
            logger.error("Zendesk token exchange failed: %s", resp.text[:300])
            return Response(
                {"detail": "Zendesk authentication failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = resp.json()
        access_token = data.get("access_token", "")
        if not access_token:
            return Response(
                {"detail": "No access_token in Zendesk response."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        OAuthCredential.objects.update_or_create(
            provider="zendesk_admin",
            defaults={
                "user": admin_user,
                "access_token": access_token,
                "refresh_token": "",
                "scopes": "read",
                "is_active": True,
            },
        )

        return HttpResponse(
            "<h2 style='font-family:sans-serif;color:#4caf50'>Zendesk connected!</h2>"
            "<p style='font-family:sans-serif'>You can close this tab.</p>"
            "<script>setTimeout(() => window.close(), 2000)</script>"
        )

