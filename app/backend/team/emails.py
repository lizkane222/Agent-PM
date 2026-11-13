"""A team member's addresses: one primary `email` plus `additional_emails`.

Anything that must pick ONE address prefers the twilio.com one. Mirrors
frontend/src/lib/teamEmails.ts.
"""

PREFERRED_DOMAIN = "twilio.com"


def all_emails(member) -> list[str]:
    out: list[str] = []
    for raw in [member.email, *(member.additional_emails or [])]:
        e = (raw or "").strip()
        if e and e.lower() not in {x.lower() for x in out}:
            out.append(e)
    return out


def preferred_email(member) -> str:
    emails = all_emails(member)
    for e in emails:
        if e.lower().endswith("@" + PREFERRED_DOMAIN):
            return e
    return emails[0] if emails else ""


def second_email(member) -> str:
    """The best address that is not the preferred one ('' when there is only one)."""
    pref = preferred_email(member)
    for e in all_emails(member):
        if e.lower() != pref.lower():
            return e
    return ""
