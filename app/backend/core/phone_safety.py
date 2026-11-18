"""
Guard against toll fraud when the app sends a text or places a call.

A user can type any number into their profile, and reminders / agent tools then text or call
it from the organisation's Twilio line. Premium-rate and satellite/shared-revenue numbers are
the classic way to turn that into a bill, so they are refused everywhere a number is stored or
used. An optional country allow-list (`TWILIO_ALLOWED_COUNTRY_CODES`, comma separated, e.g.
"1,44") narrows it further; unset means any country except the blocked ranges.
"""

import re

from django.conf import settings

E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")

# Prefixes (digits after "+") that are never texted or called.
#  1900 / 1976      North American premium-rate
#  870 881 882 883  satellite and shared-revenue "international networks"
#  888 979 878      international premium / shared cost
#  44 9 / 44 70     UK premium (09xx) and personal-numbering (070) ranges
BLOCKED_PREFIXES = (
    "1900", "1976", "870", "881", "882", "883", "888", "979", "878",
    "449", "4470",
)


def clean(raw: str) -> str:
    return re.sub(r"[\s().-]", "", str(raw or ""))


def check_number(raw: str) -> str:
    """Return the cleaned E.164 number, or raise ValueError with a user-safe reason."""
    number = clean(raw)
    if not E164_RE.match(number):
        raise ValueError("The number must include its country code, e.g. +14155550123.")
    digits = number[1:]
    if digits.startswith(BLOCKED_PREFIXES):
        raise ValueError("Premium-rate and satellite numbers can't be texted or called.")
    allowed = [c.strip() for c in str(getattr(settings, "TWILIO_ALLOWED_COUNTRY_CODES", "") or "").split(",") if c.strip()]
    if allowed and not any(digits.startswith(c) for c in allowed):
        raise ValueError("Numbers in that country aren't enabled for texts or calls.")
    return number


def is_sendable(raw: str) -> bool:
    try:
        check_number(raw)
    except ValueError:
        return False
    return True
