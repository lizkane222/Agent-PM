"""
Account matching for calendar events.

Priority order:
  1. Attendee email domain → exact match on AirtableAccount.email_domain
  2. Title keywords → fuzzy account name match against event title
  3. Full-text scan → search all event text fields
  4. No match → returns None (caller should prompt user)

When a domain match is found and the account's email_domain is blank,
we write it back to Airtable automatically.
"""
import re
import logging
from difflib import SequenceMatcher

from .models import AirtableAccount, CalendarEventAccountLink
from .airtable_client import get_table, TABLE_ACCOUNTS, FIELD_ACCOUNT_EMAIL_DOMAIN

logger = logging.getLogger(__name__)

INTERNAL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "me.com", "aol.com", "protonmail.com",
}

FUZZY_THRESHOLD = 0.6  # SequenceMatcher ratio


def _domain_from_email(email: str) -> str:
    parts = email.lower().split("@")
    return parts[-1] if len(parts) == 2 else ""


def _fuzzy_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _strip_legal(name: str) -> str:
    """Remove common company suffixes for cleaner comparison."""
    return re.sub(
        r"\b(inc|llc|ltd|corp|co|group|holdings|technologies|solutions|platform|platforms)\b\.?",
        "", name, flags=re.IGNORECASE
    ).strip(" ,.")


def _match_by_domain(attendee_emails: list[str]) -> tuple[AirtableAccount | None, str]:
    """Returns (account, domain) or (None, '')."""
    domains = {
        _domain_from_email(e)
        for e in attendee_emails
        if _domain_from_email(e) and _domain_from_email(e) not in INTERNAL_DOMAINS
    }
    accounts = list(AirtableAccount.objects.all())
    for domain in domains:
        # Exact domain match
        for acc in accounts:
            if acc.email_domain and acc.email_domain.lower() == domain:
                return acc, domain
        # Domain root matches account name (e.g. "acme.com" → "Acme")
        domain_root = domain.split(".")[0]
        for acc in accounts:
            if _fuzzy_ratio(_strip_legal(acc.name), domain_root) >= FUZZY_THRESHOLD:
                return acc, domain
    return None, ""


def _match_by_text(text: str) -> AirtableAccount | None:
    accounts = list(AirtableAccount.objects.all())
    best_acc, best_ratio = None, 0.0
    for acc in accounts:
        ratio = _fuzzy_ratio(_strip_legal(acc.name), text)
        if ratio > best_ratio:
            best_ratio = ratio
            best_acc = acc
        # Also check if account name appears as substring
        if _strip_legal(acc.name).lower() in text.lower():
            return acc
    if best_ratio >= FUZZY_THRESHOLD:
        return best_acc
    return None


def _write_domain_to_airtable(account: AirtableAccount, domain: str):
    """Back-fill the Email Domain field when we discover it."""
    try:
        table = get_table(TABLE_ACCOUNTS)
        table.update(account.airtable_id, {"Email Domain": domain})
        account.email_domain = domain
        account.save(update_fields=["email_domain"])
        logger.info("Wrote email domain %s to account %s", domain, account.name)
    except Exception:
        logger.exception("Failed to write email domain to Airtable")


def match_event_to_account(
    event_uid: str,
    title: str,
    description: str,
    attendee_emails: list[str],
) -> CalendarEventAccountLink | None:
    """
    Returns the cached or newly computed CalendarEventAccountLink.
    Returns None if we need the user to categorize.
    """
    # Return cached result
    existing = CalendarEventAccountLink.objects.filter(
        calendar_event_uid=event_uid
    ).first()
    if existing:
        return existing

    # 1. Domain match
    account, domain = _match_by_domain(attendee_emails)
    if account:
        if not account.email_domain and domain:
            _write_domain_to_airtable(account, domain)
        link, _ = CalendarEventAccountLink.objects.get_or_create(
            calendar_event_uid=event_uid,
            defaults={"account": account, "match_method": "domain"},
        )
        return link

    # 2. Title keywords
    account = _match_by_text(title)
    if account:
        link, _ = CalendarEventAccountLink.objects.get_or_create(
            calendar_event_uid=event_uid,
            defaults={"account": account, "match_method": "title"},
        )
        return link

    # 3. Full-text scan (title + description)
    full_text = f"{title} {description or ''}"
    account = _match_by_text(full_text)
    if account:
        link, _ = CalendarEventAccountLink.objects.get_or_create(
            calendar_event_uid=event_uid,
            defaults={"account": account, "match_method": "fulltext"},
        )
        return link

    # 4. No match — caller must prompt user
    return None


def set_manual_categorization(
    event_uid: str,
    account_id: int | None,
    categorization: str,
) -> CalendarEventAccountLink:
    """Called when the user manually selects an account or a category (Internal/Admin)."""
    account = None
    if account_id:
        account = AirtableAccount.objects.filter(pk=account_id).first()

    link, _ = CalendarEventAccountLink.objects.update_or_create(
        calendar_event_uid=event_uid,
        defaults={
            "account": account,
            "categorization": categorization,
            "match_method": "manual",
        },
    )
    return link
