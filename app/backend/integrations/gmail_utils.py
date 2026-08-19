"""Shared Gmail helpers.

Extracted from `integrations.views` so the meeting-notes scanner and the existing
thread views build credentials and decode message payloads exactly the same way —
a second copy of the credential-resolution order would silently diverge the first
time someone changed one of them.
"""

from __future__ import annotations

import base64
import re

from django.conf import settings

from .models import OAuthCredential

# Some accounts only ever authorised the combined Google credential (Calendar + Gmail),
# others went through the dedicated Gmail flow. Prefer the dedicated one and fall back.
_CREDENTIAL_PROVIDER_ORDER = ("gmail", "google")

GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


def find_gmail_credential(user):
    """Return the user's active Gmail-capable OAuthCredential, or None."""
    for provider in _CREDENTIAL_PROVIDER_ORDER:
        cred = OAuthCredential.objects.filter(
            user=user, provider=provider, is_active=True
        ).first()
        if cred:
            return cred
    return None


def build_gmail_service(user):
    """Return an authorised Gmail v1 service for `user`, or None if not connected.

    Kept separate from the views so the scanner can be unit-tested by patching this
    one function rather than the whole googleapiclient stack.
    """
    cred = find_gmail_credential(user)
    if not cred:
        return None

    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build as g_build

    google_creds = Credentials(
        token=cred.access_token,
        refresh_token=cred.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=cred.scopes.split() if cred.scopes else [],
    )
    return g_build("gmail", "v1", credentials=google_creds, cache_discovery=False)


def header(msg: dict, name: str) -> str:
    """Return a header value from a Gmail message payload, case-insensitively."""
    return next(
        (
            h["value"]
            for h in msg.get("payload", {}).get("headers", [])
            if h.get("name", "").lower() == name.lower()
        ),
        "",
    )


def _decode(data: str) -> str:
    """Decode a Gmail base64url body chunk. Returns '' on malformed input."""
    try:
        # Gmail omits padding; '==' is always safe to append for urlsafe_b64decode.
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    except Exception:
        return ""


_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b.*?</\1>", re.IGNORECASE | re.DOTALL)
_BLOCK_BREAK_RE = re.compile(
    r"</(p|div|tr|li|h[1-6]|table|blockquote)\s*>|<br\s*/?>", re.IGNORECASE
)
_ENTITIES = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&apos;": "'", "&mdash;": "—", "&ndash;": "–",
}


def strip_html(html: str) -> str:
    """Flatten an HTML email body to readable plain text.

    Vendor recap emails (Gong, Zoom AI Companion) are HTML-only more often than not,
    and their bullet structure lives in block-level tags — so block ends become
    newlines rather than being collapsed away with the rest of the markup.
    """
    text = _SCRIPT_STYLE_RE.sub(" ", html)
    text = _BLOCK_BREAK_RE.sub("\n", text)
    text = _TAG_RE.sub("", text)
    for entity, char in _ENTITIES.items():
        text = text.replace(entity, char)
    text = re.sub(r"&#\d+;", " ", text)
    # Collapse runs of blank lines and trailing spaces the tag strip leaves behind.
    lines = [line.strip() for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def _walk_parts(payload: dict, mime_type: str) -> str:
    """Depth-first search for the first non-empty body of `mime_type`."""
    if payload.get("mimeType") == mime_type:
        body = _decode(payload.get("body", {}).get("data", ""))
        if body:
            return body
    for part in payload.get("parts", []) or []:
        found = _walk_parts(part, mime_type)
        if found:
            return found
    return ""


def extract_plain_body(payload: dict) -> str:
    """Return the message body as plain text.

    Prefers a real `text/plain` part; falls back to flattening `text/html`; finally
    falls back to whatever the top-level body holds. `decode_body` (below) is the
    older, mime-type-blind walk kept for the thread views' existing behaviour.
    """
    plain = _walk_parts(payload, "text/plain")
    if plain.strip():
        return plain
    html = _walk_parts(payload, "text/html")
    if html.strip():
        return strip_html(html)
    return _decode(payload.get("body", {}).get("data", ""))


def decode_body(part: dict) -> str:
    """First non-empty body found anywhere in the payload tree, ignoring mime type.

    This is the original `GmailThreadsView` behaviour, preserved verbatim: it returns
    the top-level body when present and otherwise recurses. Prefer
    `extract_plain_body` for new code — it knows the difference between the plain-text
    and HTML alternatives of the same message.
    """
    data = part.get("body", {}).get("data", "")
    if not data:
        for sub in part.get("parts", []) or []:
            result = decode_body(sub)
            if result:
                return result
    if data:
        return _decode(data)
    return ""
