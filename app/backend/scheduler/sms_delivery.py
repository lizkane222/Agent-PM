"""
What happened to a text after Twilio accepted it.

`messages.create` succeeding only means Twilio queued the message. The carrier can still
reject it seconds later (error 30034: a US 10DLC number with no A2P registration is the
common one), and the app used to record that as "sent". These helpers read the final status
back so the Notification history and the Settings test button tell the truth.

Exception text is never surfaced: Twilio's errors contain the account SID. Only a Twilio
*error code* is mapped to a fixed, actionable sentence.
"""

from __future__ import annotations

import logging
import time

from django.conf import settings

logger = logging.getLogger(__name__)

FAILED_STATUSES = frozenset({"undelivered", "failed", "canceled"})
DELIVERED_STATUSES = frozenset({"delivered", "read"})

# Seconds to wait before re-checking a message that is still in flight.
RECHECK_DELAYS = (45, 120, 300)

ERROR_HELP = {
    30034: "The carrier blocked it: the sending number isn't registered for US A2P 10DLC "
           "(or isn't a verified toll-free number). Register the number in the Twilio console.",
    30007: "The carrier filtered the message as spam.",
    30003: "The phone is unreachable or switched off.",
    30004: "The recipient has blocked messages from this number.",
    30005: "The destination number doesn't exist or can't receive texts.",
    30006: "The destination is a landline or a carrier that can't receive texts.",
    30008: "The carrier couldn't deliver it (unknown error).",
    21211: "That isn't a valid phone number — check it includes the country code.",
    21608: "The Twilio account is a trial and can only text verified numbers.",
    21610: "The recipient replied STOP, so Twilio won't text them until they reply START.",
    21614: "That number can't receive texts.",
    63038: "The Twilio account hit its daily message limit.",
}
GENERIC_HELP = "Twilio could not deliver the text."


def describe_error(code) -> str:
    try:
        return ERROR_HELP.get(int(code), GENERIC_HELP)
    except (TypeError, ValueError):
        return GENERIC_HELP


def fetch_outcome(message_sid: str):
    """`(status, error_code)` for a message, or None if Twilio can't be asked right now."""
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN):
        return None
    try:
        from twilio.rest import Client

        msg = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN).messages(message_sid).fetch()
        return msg.status, msg.error_code
    except Exception:
        logger.warning("Could not fetch SMS status for %s", message_sid, exc_info=True)
        return None


def wait_for_outcome(message_sid: str, timeout: float = 8.0, interval: float = 2.0):
    """
    Poll until the message reaches a final state or `timeout` passes.
    Returns `(status, error_code)` of the last successful read, or None.
    """
    deadline = time.monotonic() + timeout
    last = None
    while True:
        outcome = fetch_outcome(message_sid)
        if outcome is not None:
            last = outcome
            if outcome[0] in FAILED_STATUSES | DELIVERED_STATUSES:
                return last
        if time.monotonic() + interval > deadline:
            return last
        time.sleep(interval)
