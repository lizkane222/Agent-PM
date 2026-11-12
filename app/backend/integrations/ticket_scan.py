"""Gmail scanner that files JIRA / Zendesk / Product Gap emails as account tickets.

READ-ONLY toward Gmail: only ``messages().list`` and ``messages().get`` are ever called -
nothing is sent, drafted, labelled or modified, and no new Google scope is requested.
The only outward effect is one in-app ``Notification`` for a record that needs review.

Rules (see CLAUDE.md session log): new records only (an email about a ticket we already
hold creates nothing and notifies nobody), matched account -> confirmed record, no
account -> ``needs_review`` + exactly one notification, idempotent, one bad message never
stops the run, and logs carry ids only (never email content or exception text).
"""

import logging
import re
from datetime import datetime, timedelta, timezone as dt_timezone
from email.utils import parseaddr, parsedate_to_datetime

from django.db.models import Q
from django.utils import timezone

from accounts.ticket_links import (
    find_ticket_url,
    jira_key_from_text,
    parse_ticket_url,
    zendesk_key_from_text,
)

from .gmail_utils import build_gmail_service, extract_plain_body, header

logger = logging.getLogger(__name__)

FIRST_RUN_LOOKBACK_DAYS = 14
MAX_MESSAGES_PER_RUN = 100
MAX_LISTED_IDS = 500
SYNC_PROVIDER = "google"
SYNC_RESOURCE = "ticket_scan"

KIND_LABELS = {"jira": "JIRA", "zendesk": "Zendesk ticket", "product_gap": "Product Gap"}

# Configurable detection lists: (sender regexes, subject regexes) per kind.
KIND_PATTERNS: dict[str, dict[str, list[re.Pattern]]] = {
    "jira": {
        "sender": [re.compile(p, re.I) for p in (r"@[\w.-]*atlassian\.net\b", r"@[\w.-]*atlassian\.com\b", r"^jira@")],
        "subject": [re.compile(p, re.I) for p in (r"\[JIRA\]", r"\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b")],
    },
    "zendesk": {
        "sender": [re.compile(p, re.I) for p in (r"@[\w.-]*zendesk\.com\b",)],
        "subject": [re.compile(p, re.I) for p in (r"\[Request\s*#\d+\]", r"\bTicket\s*#\s*\d+", r"\bSupport ticket\b")],
    },
    "product_gap": {
        "sender": [],
        "subject": [re.compile(p, re.I) for p in (r"product[\s-]*gap", r"feature[\s-]*request[\s-]*gap", r"^\s*\[gap\]", r"^\s*gap\s*:")],
    },
}

_RESOLVED_RE = re.compile(r"\b(resolved|closed|done|solved)\b", re.I)
_CREATED_RE = re.compile(r"\b(created|new ticket|opened|submitted)\b", re.I)
_GENERIC_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "atlassian.net", "atlassian.com", "zendesk.com", "twilio.com", "segment.com",
}


def classify(sender: str, subject: str) -> str:
    """Which ticket kind (if any) this sender/subject belongs to."""
    addr = parseaddr(sender or "")[1] or sender or ""
    for kind in ("jira", "zendesk", "product_gap"):
        pats = KIND_PATTERNS[kind]
        if any(p.search(addr) for p in pats["sender"]) or any(p.search(subject or "") for p in pats["subject"]):
            return kind
    return ""


def clean_title(subject: str) -> str:
    t = re.sub(r"^\s*((re|fwd?)\s*:\s*)+", "", subject or "", flags=re.I)
    t = re.sub(r"\[(JIRA|Request\s*#\d+)\]\s*", "", t, flags=re.I)
    return t.strip()[:500]


def extract(kind: str, subject: str, body: str) -> dict:
    """external_key / url / status hint from one email (no DB access)."""
    url = find_ticket_url(body, kind) if kind in ("jira", "zendesk") else ""
    key = ""
    if url:
        key = parse_ticket_url(url)["external_key"]
    if not key and kind == "jira":
        key = jira_key_from_text(subject) or jira_key_from_text(body[:2000])
    if not key and kind == "zendesk":
        key = zendesk_key_from_text(subject) or zendesk_key_from_text(body[:2000])
    status, resolved = "open", False
    if _RESOLVED_RE.search(subject or ""):
        status, resolved = "resolved", True
    return {"external_key": key, "url": url, "status": status, "resolved": resolved,
            "created_hint": bool(_CREATED_RE.search(subject or ""))}


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def user_accounts(user):
    from accounts.models import Account

    return list(
        Account.objects.filter(Q(team_members__user=user) | Q(admin_owner=user), is_admin_account=False).distinct()
    )


def match_account(accounts, sender: str, subject: str, body: str):
    """The single account the email is about, or None (none or ambiguous)."""
    from urllib.parse import urlparse

    text = _norm(f"{subject} {body[:3000]}")
    raw = f"{sender} {subject} {body[:3000]}".lower()
    hits = {}
    for acct in accounts:
        name = _norm(acct.company_name)
        score = 0
        if len(name) >= 4 and re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", text):
            score = len(name)
        domains = set()
        host = (urlparse(acct.website).hostname or "") if acct.website else ""
        if host:
            domains.add(host.lower().removeprefix("www."))
        for email in acct.contacts.exclude(email="").values_list("email", flat=True):
            domains.add(email.rsplit("@", 1)[-1].lower())
        for d in domains - _GENERIC_DOMAINS:
            if d and re.search(rf"(?<![a-z0-9.-]){re.escape(d)}\b", raw):
                score = max(score, len(d) + 100)
        if score:
            hits[acct.pk] = (score, acct)
    if not hits:
        return None
    best = max(s for s, _ in hits.values())
    top = [a for s, a in hits.values() if s == best]
    return top[0] if len(top) == 1 else None


def _already_have(user, accounts, kind, key, message_id) -> bool:
    from accounts.models import AccountTicket

    if message_id and AccountTicket.objects.filter(found_by=user, source_message_id=message_id).exists():
        return True
    if key:
        visible = Q(account__in=[a.pk for a in accounts]) | Q(found_by=user)
        if AccountTicket.objects.filter(visible, kind=kind, external_key__iexact=key).exists():
            return True
    return False


def _parse_date(msg) -> datetime:
    try:
        dt = parsedate_to_datetime(header(msg, "date"))
        if dt is not None:
            return timezone.make_aware(dt, dt_timezone.utc) if timezone.is_naive(dt) else dt
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromtimestamp(int(msg.get("internalDate", "0")) / 1000, tz=dt_timezone.utc)
    except (TypeError, ValueError):
        return timezone.now()


def build_query(since: datetime) -> str:
    senders = "from:atlassian.net OR from:atlassian.com OR from:jira OR from:zendesk.com"
    subjects = 'subject:"product gap" OR subject:"feature request gap" OR subject:"[gap]" OR subject:ticket OR subject:request'
    return f"({senders} OR {subjects}) after:{int(since.timestamp())}"


def _handle_message(user, accounts, msg, counts) -> None:
    from accounts.models import AccountTicket
    from team.notifications import record_notification

    sender, subject = header(msg, "from"), header(msg, "subject")
    kind = classify(sender, subject)
    if not kind:
        counts["ignored"] += 1
        return
    body = extract_plain_body(msg.get("payload", {}))
    info = extract(kind, subject, body)
    if kind in ("jira", "zendesk") and not info["external_key"]:
        counts["ignored"] += 1
        return
    message_id = msg.get("threadId") or msg.get("id", "")
    if _already_have(user, accounts, kind, info["external_key"], message_id):
        counts["existing"] += 1
        return
    when = _parse_date(msg)
    account = match_account(accounts, sender, subject, body)
    ticket = AccountTicket.objects.create(
        account=account,
        kind=kind,
        url=info["url"],
        external_key=info["external_key"],
        title=clean_title(subject),
        status=info["status"],
        source_created_at=when,
        source_updated_at=when,
        resolved_at=when if info["resolved"] else None,
        review_state="confirmed" if account else "needs_review",
        found_by=user,
        created_by=user if account else None,
        source_message_id=message_id,
        source_subject=(subject or "")[:500],
        source_sender=(sender or "")[:300],
        source_snippet=(msg.get("snippet") or "")[:300],
    )
    if account:
        counts["created"] += 1
        return
    counts["needs_review"] += 1
    record_notification(
        user, "in_app", "ticket_review",
        f"New {KIND_LABELS[kind]} needs review",
        body=(subject or "")[:300],
        link="/profile#ticket-review",
    )
    logger.info("ticket_scan: ticket %s needs review for user %s", ticket.pk, user.pk)


def scan_user_tickets(user, now=None) -> dict:
    """Scan one user's mailbox. Returns counts. Raises nothing for a single bad message."""
    from integrations.models import SyncState

    now = now or timezone.now()
    counts = {"created": 0, "needs_review": 0, "existing": 0, "ignored": 0, "failed": 0, "connected": True}
    gmail = build_gmail_service(user)
    if gmail is None:
        counts["connected"] = False
        return counts

    state, _ = SyncState.objects.get_or_create(user=user, provider=SYNC_PROVIDER, resource=SYNC_RESOURCE)
    since = state.last_synced_at or now - timedelta(days=FIRST_RUN_LOOKBACK_DAYS)
    since = max(since - timedelta(minutes=5), now - timedelta(days=FIRST_RUN_LOOKBACK_DAYS))  # small overlap; re-runs are deduped

    ids, token = [], None
    while len(ids) < MAX_LISTED_IDS:
        kwargs = {"userId": "me", "q": build_query(since), "maxResults": 100}
        if token:
            kwargs["pageToken"] = token
        listing = gmail.users().messages().list(**kwargs).execute()
        ids.extend(m["id"] for m in listing.get("messages", []) or [])
        token = listing.get("nextPageToken")
        if not token:
            break

    # Gmail lists newest first; work oldest first so a capped run can resume lossless.
    ids.reverse()
    batch, remaining = ids[:MAX_MESSAGES_PER_RUN], len(ids) > MAX_MESSAGES_PER_RUN or bool(token)
    accounts = user_accounts(user)
    last_seen = None
    for mid in batch:
        try:
            msg = gmail.users().messages().get(userId="me", id=mid, format="full").execute()
            last_seen = _parse_date(msg)
            _handle_message(user, accounts, msg, counts)
        except Exception:
            counts["failed"] += 1
            logger.warning("ticket_scan: message %s failed for user %s", mid, user.pk)

    state.last_synced_at = last_seen if (remaining and last_seen) else now
    state.save(update_fields=["last_synced_at", "updated_at"])
    return counts
