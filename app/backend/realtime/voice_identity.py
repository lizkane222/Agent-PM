"""
Resolve the Django user behind a ConversationRelay voice call.

The relay's WebSocket is authenticated by a single pre-shared VOICE_RELAY_TOKEN,
which proves the connection came from Twilio — it says nothing about *which* user
started the call. Tool calls need a real user or every one of them returns
empty/"not authorized", so the identity has to travel from the TwiML request (where
the browser's Voice SDK identity is visible as `From="client:<pk>"`) to the
consumer's setup frame.

It travels as a signed, short-lived, call-bound token in a <Parameter> child of
<ConversationRelay>, which Twilio echoes back in setup.customParameters.

Why not the obvious alternatives:

* `device.connect({params: {user_id}})` — Twilio documents connect params as
  browser-controlled. Any user could pass another pk and get read/write across
  every tool.
* A bare `<Parameter name="user_pk" value="42"/>` — customParameters are echoed
  verbatim, so anyone holding the shared VOICE_RELAY_TOKEN could open the socket and
  send a hand-crafted setup frame naming any pk. One shared secret cannot express
  per-user authorization.
* Looking up VoiceSession by CallSid in the consumer — VoiceSession.user is set
  *from* this module, and VoiceStatusCallbackView races the relay setup frame, so
  the row may not exist yet. CallSid is not a secret either; it is visible in the
  browser's own call.parameters.
* A long-lived app JWT in the relay URL — Twilio logs relay URLs.

The payload is deliberately minimal — `{"u": pk, "c": call_sid}`. No username, no
email, no permissions: the consumer re-reads the live User row, so a token minted
before an account was deactivated cannot be used to act as that account.
"""

from __future__ import annotations

import logging

from channels.db import database_sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing

logger = logging.getLogger(__name__)

IDENTITY_SALT = "realtime.voice.identity.v1"
# The <Parameter name=...> Twilio echoes into setup.customParameters.
IDENTITY_PARAM = "identity_token"

# Reasons surfaced in logs and in the call's handoffData — the only observability
# available for a call that never reached the database.
REASON_MISSING = "missing"
REASON_BAD_SIGNATURE = "bad_signature"
REASON_EXPIRED = "expired"
REASON_CALL_MISMATCH = "call_mismatch"
REASON_USER_INACTIVE = "user_inactive"


class IdentityError(Exception):
    """Raised when an identity token cannot be trusted. `reason` is a REASON_* code."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def user_pk_from_twilio_from(from_value: str) -> int | None:
    """
    Parse Twilio's `From="client:<pk>"` into an int pk.

    Returns None for inbound PSTN calls (From is a phone number) and for anything
    malformed. SyncTokenView already issues tokens with identity=str(user.pk), which
    is digits-only and so satisfies Twilio's alphanumeric identity rule.
    """
    if not from_value or not from_value.startswith("client:"):
        return None
    raw = from_value[len("client:"):].strip()
    if not raw.isdigit():
        return None
    try:
        return int(raw)
    except ValueError:  # pragma: no cover — isdigit() already guarantees this
        return None


def mint_identity_token(user_pk: int, call_sid: str) -> str:
    """Sign a call-bound identity token. Uses TimestampSigner via signing.dumps."""
    return signing.dumps({"u": int(user_pk), "c": call_sid}, salt=IDENTITY_SALT)


def read_identity_token(token: str, call_sid: str) -> int:
    """
    Verify a token against `call_sid` and return the user pk.

    Call-SID binding is the anti-replay teeth: a captured token is useless on any
    other call, so even a leaked one cannot be replayed to impersonate a user on a
    call an attacker started.

    Raises IdentityError with a REASON_* code.
    """
    if not token:
        raise IdentityError(REASON_MISSING)
    max_age = getattr(settings, "VOICE_IDENTITY_MAX_AGE", 120)
    try:
        payload = signing.loads(token, salt=IDENTITY_SALT, max_age=max_age)
    except signing.SignatureExpired:
        raise IdentityError(REASON_EXPIRED) from None
    except signing.BadSignature:
        raise IdentityError(REASON_BAD_SIGNATURE) from None
    if not isinstance(payload, dict):
        raise IdentityError(REASON_BAD_SIGNATURE)
    if payload.get("c") != call_sid:
        raise IdentityError(REASON_CALL_MISMATCH)
    pk = payload.get("u")
    if not isinstance(pk, int):
        raise IdentityError(REASON_BAD_SIGNATURE)
    return pk


def resolve_user_sync(user_pk: int):
    """Return the active User for this pk, or None. Sync — for use in DRF views."""
    User = get_user_model()
    return User.objects.filter(pk=user_pk, is_active=True).first()


@database_sync_to_async
def load_user(user_pk: int):
    """
    Return the active User for this pk, or None.

    Re-reading the row (rather than trusting the token payload) is what makes a
    deactivated account unable to ride an in-flight token.
    """
    return resolve_user_sync(user_pk)
