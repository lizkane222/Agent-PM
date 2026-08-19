"""Fill missing AI meeting summaries on meetings from the user's Gmail.

Gong and Zoom both email a recap after a call. This module finds those emails,
matches each one to a meeting by **name and date**, and — only when that meeting has
no summary for that provider yet — normalises the email into the bulleted shape the
meeting-notes UI already renders and saves it.

Both providers are stored side by side (`AirtableMeeting.gong_notes` /
`.zoom_notes`); the UI prefers Gong and offers a toggle. Nothing here ever overwrites
an existing summary, so a manually pasted or previously imported recap always wins.
"""

from __future__ import annotations

import logging
import re
from datetime import timedelta
from datetime import timezone as dt_timezone
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from airtable_sync.models import AirtableMeeting
from core.mixins import _staff_sees_all

from .gmail_utils import build_gmail_service, extract_plain_body, header

logger = logging.getLogger(__name__)


class GmailNotConnected(Exception):
    """Raised when the caller has no active Gmail-capable OAuth credential."""


# ── Providers ─────────────────────────────────────────────────────────────────

# Sender domains, and the column pair each provider writes. Order is significance
# order: when a meeting matches emails from both providers the first one listed is the
# one the UI shows by default ("prefer Gong over Zoom").
PROVIDERS: dict[str, dict] = {
    "gong": {
        "domains": ("gong.io",),
        "notes_field": "gong_notes",
        "url_field": "gong_url",
        "url_domains": ("gong.io",),
    },
    "zoom": {
        "domains": ("zoom.us", "zoom.com"),
        "notes_field": "zoom_notes",
        "url_field": "zoom_url",
        "url_domains": ("zoom.us", "zoom.com"),
    },
}
SOURCE_PRIORITY = ("gong", "zoom")

# Hard ceilings so one click can't fan out into an unbounded number of Gmail reads or
# Claude calls. Both are reported back in the response when they bite.
MAX_LOOKBACK_DAYS = 180
DEFAULT_LOOKBACK_DAYS = 30
MAX_EMAILS = 150
MAX_SUMMARIES = 25

# A recap lands after the call, usually within minutes but sometimes the next working
# day. A day of slack on the early side absorbs timezone skew in the meeting record.
EMAIL_WINDOW_BEFORE = timedelta(days=1)
EMAIL_WINDOW_AFTER = timedelta(days=3)

SUMMARY_MODEL = "claude-opus-5"

FUZZY_THRESHOLD = 0.72
# Below this length a normalised title is too generic for containment to mean anything
# ("sync", "1:1"), so those fall through to the fuzzy ratio instead.
MIN_CONTAINMENT_LEN = 5


# ── Title normalisation and matching ──────────────────────────────────────────

_REPLY_PREFIX_RE = re.compile(r"^\s*(re|fwd?|fw)\s*:\s*", re.IGNORECASE)

# Vendor subject boilerplate wrapped around the actual meeting name. Applied
# repeatedly, so "Re: Gong Call Recap: Acme <> Twilio" reduces to "acme twilio".
_VENDOR_PREFIX_RES = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^\s*gong\s*(call\s*)?(recap|summary|notes)\s*[:\-–—]\s*",
        r"^\s*your\s+(call|meeting)\s+(recap|summary)\s*(is\s+ready)?\s*[:\-–—]?\s*",
        r"^\s*(zoom\s+)?ai\s+companion\s*[:\-–—]\s*",
        r"^\s*(ai\s+)?(meeting|call)\s+(summary|recap|notes)\s+(for|with|of|from)\s+",
        r"^\s*(ai\s+)?(meeting|call)\s+(summary|recap|notes)\s*[:\-–—]\s*",
        r"^\s*(summary|recap|notes)\s+(for|of|from)\s+",
        r"^\s*(summary|recap|notes)\s*[:\-–—]\s*",
    )
]

# Trailing decorations: a bracketed/parenthesised aside, or a " - Mar 3, 2026" tail.
_TRAILING_BRACKET_RE = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]\s*$")
_TRAILING_DATE_RE = re.compile(
    r"\s*[\-–—|,]\s*"
    r"(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|"
    r"jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d.*$",
    re.IGNORECASE,
)
_NON_WORD_RE = re.compile(r"[^a-z0-9]+")

# Filler words that carry no identifying signal in a meeting title.
_STOPWORDS = {"the", "a", "an", "and", "with", "meeting", "call", "sync", "weekly", "biweekly"}


def normalize_title(text: str) -> str:
    """Reduce a meeting name or email subject to a comparable token string."""
    if not text:
        return ""
    cleaned = text.strip()
    # Strip Re:/Fwd: and vendor boilerplate until nothing more comes off.
    changed = True
    while changed:
        changed = False
        stripped = _REPLY_PREFIX_RE.sub("", cleaned)
        if stripped != cleaned:
            cleaned, changed = stripped, True
        for pattern in _VENDOR_PREFIX_RES:
            stripped = pattern.sub("", cleaned)
            if stripped != cleaned:
                cleaned, changed = stripped, True
    cleaned = _TRAILING_DATE_RE.sub("", cleaned)
    cleaned = _TRAILING_BRACKET_RE.sub("", cleaned).strip()
    tokens = [t for t in _NON_WORD_RE.sub(" ", cleaned.lower()).split() if t]
    # Drop stopwords only if something identifying survives — "Weekly Sync" would
    # otherwise normalise to the empty string and match nothing at all.
    meaningful = [t for t in tokens if t not in _STOPWORDS]
    return " ".join(meaningful or tokens)


def titles_match(meeting_name: str, email_subject: str) -> bool:
    """True when an email subject plausibly names the same meeting."""
    a = normalize_title(meeting_name)
    b = normalize_title(email_subject)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = sorted((a, b), key=len)
    if len(shorter) >= MIN_CONTAINMENT_LEN and shorter in longer:
        return True
    return SequenceMatcher(None, a, b).ratio() >= FUZZY_THRESHOLD


def dates_match(meeting_dt, email_dt) -> bool:
    """True when the email arrived in the recap window around the meeting."""
    if meeting_dt is None or email_dt is None:
        return False
    return (meeting_dt - EMAIL_WINDOW_BEFORE) <= email_dt <= (meeting_dt + EMAIL_WINDOW_AFTER)


# ── Candidate meetings ────────────────────────────────────────────────────────

def visible_meetings_for(user):
    """Meetings this user can act on.

    Deliberately the union of two things, because either alone leaves real gaps: the
    meetings of accounts they're a team member of, and the meetings linked to calendar
    events they own (which covers 1:1s and internal calls with no account at all).
    Staff see everything, matching the rest of the meeting endpoints.
    """
    qs = AirtableMeeting.objects.select_related("account")
    if _staff_sees_all(user):
        return qs

    from accounts.models import Account
    from scheduler.models import CalendarEvent

    team_account_ids = set(
        Account.objects.filter(team_members__user=user)
        .exclude(airtable_id="")
        .values_list("airtable_id", flat=True)
    )
    own_event_meeting_ids = set(
        CalendarEvent.objects.filter(owner=user)
        .exclude(agentpm_airtable_id="")
        .values_list("agentpm_airtable_id", flat=True)
    )
    if not team_account_ids and not own_event_meeting_ids:
        return qs.none()
    return qs.filter(
        Q(account__airtable_id__in=team_account_ids)
        | Q(airtable_id__in=own_event_meeting_ids)
    )


def candidate_meetings(user, days: int, account_name: str = ""):
    """Past meetings inside the lookback window that could still need a summary."""
    now = timezone.now()
    qs = visible_meetings_for(user).filter(
        date__isnull=False,
        date__gte=now - timedelta(days=days),
        date__lte=now,
    )
    if account_name:
        qs = qs.filter(account__name__iexact=account_name)
    return qs.order_by("-date")


# ── Gmail fetch ───────────────────────────────────────────────────────────────

def _classify_source(from_header: str) -> str:
    lowered = (from_header or "").lower()
    for source in SOURCE_PRIORITY:
        if any(domain in lowered for domain in PROVIDERS[source]["domains"]):
            return source
    return ""


def build_search_query(days: int) -> str:
    """Gmail query for recap mail from any supported provider inside the window."""
    since = (timezone.now() - timedelta(days=days)).strftime("%Y/%m/%d")
    senders = " OR ".join(
        f"from:{domain}"
        for source in SOURCE_PRIORITY
        for domain in PROVIDERS[source]["domains"]
    )
    return f"({senders}) after:{since}"


def fetch_vendor_messages(gmail, days: int, max_emails: int = MAX_EMAILS) -> list[dict]:
    """Return recap emails as {source, subject, date, from, body, id} dicts.

    A message whose sender doesn't resolve to a known provider, or whose Date header
    won't parse, is dropped rather than raising — one malformed message shouldn't sink
    the whole scan.
    """
    query = build_search_query(days)
    listing = (
        gmail.users()
        .messages()
        .list(userId="me", q=query, maxResults=max_emails)
        .execute()
    )
    out: list[dict] = []
    for ref in listing.get("messages", []) or []:
        try:
            msg = (
                gmail.users()
                .messages()
                .get(userId="me", id=ref["id"], format="full")
                .execute()
            )
        except Exception:
            logger.exception("meeting_notes: failed to fetch Gmail message %s", ref.get("id"))
            continue

        source = _classify_source(header(msg, "from"))
        if not source:
            continue
        raw_date = header(msg, "date")
        try:
            email_dt = parsedate_to_datetime(raw_date)
        except (TypeError, ValueError):
            continue
        if email_dt is None:
            continue
        if timezone.is_naive(email_dt):
            # A Date header without an offset is rare but legal; assume UTC rather than
            # the server's local zone so the window check is deterministic.
            email_dt = timezone.make_aware(email_dt, dt_timezone.utc)

        out.append({
            "id": msg.get("id", ref.get("id", "")),
            "source": source,
            "subject": header(msg, "subject"),
            "from": header(msg, "from"),
            "date": email_dt,
            "body": extract_plain_body(msg.get("payload", {})),
        })
    return out


# ── Summarisation ─────────────────────────────────────────────────────────────

# The frontend's parseBullets() promotes these exact words to section headings, so the
# prompt asks for them verbatim rather than letting the model pick its own structure.
_HEADINGS = ("Recap", "Key Points", "Next Steps")

_SUMMARY_PROMPT = """\
Below is the automated recap email for a meeting titled "{meeting_name}", sent by \
{source_label}.

Rewrite it as meeting notes using EXACTLY this structure:

Recap
- one or two bullets summarising what the meeting was about

Key Points
- one bullet per substantive point discussed

Next Steps
- one bullet per commitment or follow-up, naming the person responsible where the \
email says who

Rules:
- Output only those three heading lines and their bullets. No preamble, no closing \
remarks, no markdown fences, no bold or italic markers.
- Every bullet starts with "- ".
- Use only information present in the email. Do not infer or invent commitments.
- Omit a section entirely if the email contains nothing for it.
- Strip email chrome: unsubscribe links, "view in browser", legal footers, \
recording links, and calendar boilerplate.

Email body:
{body}
"""

_FOOTER_MARKERS = (
    "unsubscribe",
    "view in browser",
    "view this email in your browser",
    "manage your notification",
    "manage notification",
    "this email was sent to",
    "©",
    "all rights reserved",
    "do not reply to this email",
)


def _looks_like_footer(line: str) -> bool:
    lowered = line.lower()
    return any(marker in lowered for marker in _FOOTER_MARKERS)


def fallback_bullets(body: str, max_chars: int = 4000) -> str:
    """Best-effort bulleting without Claude.

    Used when no API key is configured or the model call fails: keeps the vendor's own
    text (which is what the user would otherwise paste by hand) rather than dropping
    the recap entirely. Lines that already look like headings or bullets are preserved
    as-is so parseBullets() still finds structure.
    """
    lines: list[str] = []
    for raw in (body or "").splitlines():
        line = raw.strip()
        if not line or _looks_like_footer(line):
            continue
        if re.match(r"^[\-•*▪◦–—]\s+", line) or re.match(r"^\d+[.)]\s+", line):
            lines.append(line)
        elif line.rstrip(":").strip().lower() in {h.lower() for h in _HEADINGS} | {
            "quick recap", "summary", "collaboration"
        }:
            lines.append(line.rstrip(":"))
        else:
            lines.append(f"- {line}")
    text = "\n".join(lines).strip()
    return text[:max_chars]


def summarize_email(body: str, meeting_name: str, source: str) -> str:
    """Normalise a recap email into headed bullets, falling back to the raw text."""
    body = (body or "").strip()
    if not body:
        return ""

    api_key = getattr(settings, "ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.info("meeting_notes: ANTHROPIC_API_KEY unset — using unsummarised recap text")
        return fallback_bullets(body)

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=SUMMARY_MODEL,
            max_tokens=2000,
            messages=[{
                "role": "user",
                "content": _SUMMARY_PROMPT.format(
                    meeting_name=meeting_name or "(untitled)",
                    source_label="Gong" if source == "gong" else "Zoom AI Companion",
                    # Recap emails are short; the cap only guards against a pathological
                    # thread being quoted back in full.
                    body=body[:20000],
                ),
            }],
        )
        text = "".join(
            block.text for block in message.content if getattr(block, "type", "") == "text"
        ).strip()
        return text or fallback_bullets(body)
    except Exception:
        logger.exception("meeting_notes: Claude summarisation failed — falling back to raw text")
        return fallback_bullets(body)


_URL_RE = re.compile(r"https?://[^\s<>\"')]+")


def extract_provider_url(body: str, domains: tuple[str, ...]) -> str:
    """First URL in the email pointing at one of `domains`, or ''."""
    for url in _URL_RE.findall(body or ""):
        if any(domain in url.lower() for domain in domains):
            return url[:200]
    return ""


# ── Entry point ───────────────────────────────────────────────────────────────

def sync_meeting_notes_from_email(
    user,
    days: int = DEFAULT_LOOKBACK_DAYS,
    account_name: str = "",
    max_emails: int = MAX_EMAILS,
    max_summaries: int = MAX_SUMMARIES,
    gmail=None,
) -> dict:
    """Match recap emails to the user's meetings and fill in missing summaries.

    Returns a report dict rather than raising on partial failure — a meeting whose
    summarisation blows up is recorded in `errors` and the rest still complete.
    """
    days = max(1, min(int(days or DEFAULT_LOOKBACK_DAYS), MAX_LOOKBACK_DAYS))
    gmail = gmail or build_gmail_service(user)
    if gmail is None:
        raise GmailNotConnected("Gmail is not connected for this user.")

    from airtable_sync import write_back

    messages = fetch_vendor_messages(gmail, days, max_emails=max_emails)
    meetings = list(candidate_meetings(user, days, account_name))

    report: dict = {
        "days": days,
        "account_name": account_name,
        "scanned_emails": len(messages),
        "scanned_meetings": len(meetings),
        "updated": [],
        "skipped": [],
        "errors": [],
        "summaries_truncated": False,
        "max_summaries": max_summaries,
    }

    summaries_done = 0
    for meeting in meetings:
        matched_sources: list[str] = []
        hit_summary_cap = False
        note: dict = {
            "meeting_id": meeting.pk,
            "airtable_id": meeting.airtable_id,
            "meeting_name": meeting.name,
            "date": meeting.date.isoformat() if meeting.date else None,
            "account_name": meeting.account.name if meeting.account else None,
            "sources": matched_sources,
        }

        for source in SOURCE_PRIORITY:
            provider = PROVIDERS[source]
            # `.strip()`, not truthiness: an Airtable richText column that was written
            # once and later cleared reports "\n" forever, and a bare truthiness check
            # would read that as an existing summary and skip the meeting permanently.
            if (getattr(meeting, provider["notes_field"], "") or "").strip():
                # Already summarised for this provider — never overwrite.
                continue

            candidates = [
                m for m in messages
                if m["source"] == source
                and dates_match(meeting.date, m["date"])
                and titles_match(meeting.name, m["subject"])
            ]
            if not candidates:
                continue
            # Closest to the meeting time wins if the provider sent more than one.
            best = min(candidates, key=lambda m: abs(m["date"] - meeting.date))

            if summaries_done >= max_summaries:
                # A match was found but the per-request ceiling is spent. Surface it
                # rather than reporting the meeting as unmatched — a silent cap reads
                # as "nothing to import" when there was.
                report["summaries_truncated"] = True
                hit_summary_cap = True
                continue

            try:
                summary = summarize_email(best["body"], meeting.name, source)
            except Exception as exc:  # defensive: summarize_email already catches
                logger.exception("meeting_notes: summarisation failed for meeting %s", meeting.pk)
                report["errors"].append({
                    "meeting_id": meeting.pk,
                    "meeting_name": meeting.name,
                    "source": source,
                    "detail": str(exc),
                })
                continue

            summaries_done += 1
            if not summary.strip():
                continue

            update_fields = [provider["notes_field"]]
            setattr(meeting, provider["notes_field"], summary)
            if not getattr(meeting, provider["url_field"], ""):
                url = extract_provider_url(best["body"], provider["url_domains"])
                if url:
                    setattr(meeting, provider["url_field"], url)
                    update_fields.append(provider["url_field"])
            meeting.save(update_fields=update_fields)

            # Mirror to Airtable per provider so a missing Zoom column can't take the
            # Gong write down with it (see write_back.push_meeting_zoom_notes).
            pusher = (
                write_back.push_meeting_gong_notes
                if source == "gong"
                else write_back.push_meeting_zoom_notes
            )
            try:
                pusher(meeting)
            except Exception:
                logger.exception(
                    "meeting_notes: Airtable mirror failed for meeting %s (%s)",
                    meeting.pk, source,
                )

            matched_sources.append(source)
            note.setdefault("email_subjects", {})[source] = best["subject"]

        if matched_sources:
            report["updated"].append(note)
        else:
            if hit_summary_cap:
                reason = "summary_limit_reached"
            elif meeting.gong_notes.strip() or meeting.zoom_notes.strip():
                reason = "already_summarized"
            else:
                reason = "no_matching_email"
            report["skipped"].append({
                "meeting_id": meeting.pk,
                "meeting_name": meeting.name,
                "reason": reason,
            })

    return report
