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

# Vendor subject boilerplate wrapped around the actual meeting name. Both ends are
# stripped, repeatedly, so "Re: Meeting assets for Acme <> Twilio are ready!" reduces to
# "acme twilio".
#
# These are the formats actually observed in the wild, which are not the ones the vendor
# docs suggest — verify against a real mailbox before adding to this list:
#   Gong: "<name>: Call recording and analysis is ready"   (name is a PREFIX)
#   Zoom: "Meeting assets for <name> are ready!"           (name is in the MIDDLE)
_VENDOR_PREFIX_RES = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^\s*meeting\s+assets\s+for\s+",
        r"^\s*gong\s*(call\s*)?(recap|summary|notes)\s*[:\-–—]\s*",
        r"^\s*your\s+(call|meeting)\s+(recap|summary)\s*(is\s+ready)?\s*[:\-–—]?\s*",
        r"^\s*(zoom\s+)?ai\s+companion\s*[:\-–—]\s*",
        r"^\s*(ai\s+)?(meeting|call)\s+(summary|recap|notes)\s+(for|with|of|from)\s+",
        r"^\s*(ai\s+)?(meeting|call)\s+(summary|recap|notes)\s*[:\-–—]\s*",
        r"^\s*(summary|recap|notes)\s+(for|of|from)\s+",
        r"^\s*(summary|recap|notes)\s*[:\-–—]\s*",
    )
]

# Order matters: the Gong-specific patterns must be tried before the bare
# "... is/are ready" catch-all, which would otherwise strip only the tail of
# "…: Call recording and analysis is ready" and leave the boilerplate behind.
_VENDOR_SUFFIX_RES = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\s*[:\-–—]\s*call\s+recording\b.*?\bis\s+ready[.!]*\s*$",
        r"\s*[:\-–—]\s*(call\s+)?(recording|analysis|transcript)s?\b.*?\b(is|are)\s+ready[.!]*\s*$",
        r"\s+(is|are)\s+ready[.!]*\s*$",
    )
]

# Subjects that are notifications *about* a meeting rather than a recap of one. Without
# this they sail through matching and their body — which has no summary — gets treated as
# a candidate.
_NON_RECAP_SUBJECT_RES = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bhas\s+been\s+(deleted|cancell?ed|removed)\b",
        r"\bis\s+(cancell?ed|starting)\b",
        r"\byou(r|'ve)?\s+(been\s+)?invited\b",
        r"\bregistration\b",
        r"\bpassword\b",
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
    # Strip Re:/Fwd: and vendor boilerplate off both ends until nothing more comes off.
    changed = True
    while changed:
        changed = False
        stripped = _REPLY_PREFIX_RE.sub("", cleaned)
        if stripped != cleaned:
            cleaned, changed = stripped, True
        for pattern in _VENDOR_SUFFIX_RES:
            stripped = pattern.sub("", cleaned)
            if stripped != cleaned:
                cleaned, changed = stripped, True
                break
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


def _event_has_matching_recap(probe, messages: list[dict]) -> bool:
    """True when some message carries a real summary for this event's name and date.

    Takes an unsaved AirtableMeeting-shaped probe so the name/date matching rules are
    exactly the ones used for saved meetings. Only a message with an actual summary
    counts — a bare recording notification is not worth creating a row for.
    """
    return any(
        m["has_summary"]
        and dates_match(probe.date, m["date"])
        and titles_match(probe.name, m["subject"])
        for m in messages
    )


def candidate_events(user, days: int, account_name: str = "", account: str = ""):
    """Calendar events the user owns that have no AirtableMeeting behind them yet.

    Events already linked to a meeting are excluded — that meeting is covered by
    `candidate_meetings`, and importing twice would double-report it.

    Account scoping is best-effort: an event is only kept in a *scoped* scan when its
    account resolves to the requested one. Events with no account FK are therefore
    scanned only in unscoped (profile / role page) runs — a scoped run must not quietly
    import a meeting that doesn't belong to the account being viewed.
    """
    from accounts.models import Account as DjangoAccount
    from airtable_sync.models import AirtableAccount
    from scheduler.models import CalendarEvent

    now = timezone.now()
    # Empty airtable_ids are excluded from the subquery so events with no link at all
    # (agentpm_airtable_id="") are kept rather than matching a blank.
    linked_ids = AirtableMeeting.objects.exclude(airtable_id="").values_list(
        "airtable_id", flat=True
    )
    qs = CalendarEvent.objects.filter(
        owner=user,
        start_datetime__gte=now - timedelta(days=days),
        start_datetime__lte=now,
    ).exclude(agentpm_airtable_id__in=linked_ids)

    token = (account or "").strip()
    if token:
        # `account` is an AirtableAccount PK or rec* id; CalendarEvent points at a Django
        # Account, so bridge the two on airtable_id.
        if token.isdigit():
            at_ids = list(
                AirtableAccount.objects.filter(pk=int(token)).values_list(
                    "airtable_id", flat=True
                )
            )
        else:
            at_ids = [token]
        at_ids = [i for i in at_ids if i]
        accounts = DjangoAccount.objects.filter(airtable_id__in=at_ids) if at_ids \
            else DjangoAccount.objects.none()
        qs = qs.filter(account_id__in=accounts.values_list("pk", flat=True))
    elif account_name:
        qs = qs.filter(account__company_name__iexact=account_name)

    return qs.order_by("-start_datetime")


def candidate_meetings(user, days: int, account_name: str = "", account: str = ""):
    """Past meetings inside the lookback window that could still need a summary.

    `account` narrows to one AirtableAccount and accepts either a numeric PK or an
    Airtable `rec*` id, the same shape `AirtableMeetingViewSet` takes — the account
    detail page already prefers the `rec*` id over the display name, and a Django
    Account whose `company_name` has drifted from its AirtableAccount `name` would match
    nothing by name. `account_name` stays as the fallback for accounts with no Airtable
    link at all (notably per-user Admin workspaces) and for the agent, which knows names
    rather than ids.

    A present-but-unresolvable filter narrows to empty rather than falling through to
    "every meeting the caller can see" — matching the convention in core/query_params.py.
    """
    now = timezone.now()
    qs = visible_meetings_for(user).filter(
        date__isnull=False,
        date__gte=now - timedelta(days=days),
        date__lte=now,
    )
    token = (account or "").strip()
    if token:
        qs = qs.filter(account_id=int(token)) if token.isdigit() else qs.filter(
            account__airtable_id=token
        )
    elif account_name:
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
        subject = header(msg, "subject")
        if any(pattern.search(subject) for pattern in _NON_RECAP_SUBJECT_RES):
            # A cancellation or invite notice, not a recap.
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

        body = extract_plain_body(msg.get("payload", {}))
        out.append({
            "id": msg.get("id", ref.get("id", "")),
            "source": source,
            "subject": subject,
            "from": header(msg, "from"),
            "date": email_dt,
            "body": body,
            # Computed once here so the matcher can tell a recap from a bare
            # "your recording is ready" notification without re-scanning the body.
            "has_summary": email_contains_summary(body),
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

# A vendor "your recording is ready" notification and a vendor recap email look alike from
# the outside — same sender, same subject shape — and only one of them contains anything
# worth saving. Zoom in particular renders "Meeting summary" as a *link label*: the words
# are in the email, the summary itself is only in the Zoom web app. Importing that gives a
# meeting a set of notes made of link text, which is worse than leaving it empty.
#
# The discriminator is how much of the body is prose rather than labels and links. Measured
# over a real mailbox (30 days, 28 emails): Gong recaps 3139–4505 chars of prose, Zoom
# notifications 0–238. 400 sits in the gap with a wide margin on both sides.
MIN_SUMMARY_CONTENT_CHARS = 400

# Eight words is long enough to exclude labels and field rows ("Meeting summary", "Topic:
# …", "Duration: 01:07:26", "The Zoom Team") without excluding a real bullet.
_MIN_WORDS_PER_CONTENT_LINE = 8


def summary_content_chars(body: str) -> int:
    """Characters of prose in `body`, ignoring URLs and short label/field lines."""
    total = 0
    for line in _URL_RE.sub("", body or "").splitlines():
        stripped = line.strip()
        if len(stripped.split()) >= _MIN_WORDS_PER_CONTENT_LINE:
            total += len(stripped)
    return total


def email_contains_summary(body: str) -> bool:
    """True when the email actually carries a recap, not just links to one."""
    return summary_content_chars(body) >= MIN_SUMMARY_CONTENT_CHARS


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
    account: str = "",
    max_emails: int = MAX_EMAILS,
    max_summaries: int = MAX_SUMMARIES,
    gmail=None,
) -> dict:
    """Match recap emails to the user's meetings and fill in missing summaries.

    Pass `account` (or `account_name`) to scope the scan to one account — what the
    account detail page does. Omit both to cover every meeting the caller can see, which
    is what the profile and role pages do.

    Returns a report dict rather than raising on partial failure — a meeting whose
    summarisation blows up is recorded in `errors` and the rest still complete.
    """
    days = max(1, min(int(days or DEFAULT_LOOKBACK_DAYS), MAX_LOOKBACK_DAYS))
    gmail = gmail or build_gmail_service(user)
    if gmail is None:
        raise GmailNotConnected("Gmail is not connected for this user.")

    from airtable_sync import write_back
    from airtable_sync.meeting_stubs import get_or_create_meeting_for_event

    messages = fetch_vendor_messages(gmail, days, max_emails=max_emails)
    meetings = list(candidate_meetings(user, days, account_name, account))
    events = list(candidate_events(user, days, account_name, account))

    report: dict = {
        "days": days,
        "account_name": account_name,
        "account": account,
        # True when the scan was narrowed to one account; the UI words its result
        # differently for "this account" vs "all your accounts".
        "scoped_to_account": bool(account or account_name),
        "scanned_emails": len(messages),
        "scanned_meetings": len(meetings),
        # Calendar events with no meeting row behind them, considered in a second pass.
        "scanned_unlinked_events": len(events),
        "updated": [],
        "skipped": [],
        "errors": [],
        "summaries_truncated": False,
        "max_summaries": max_summaries,
    }

    state = {"summaries_done": 0}

    def import_for_meeting(meeting) -> dict:
        """Try every provider against `meeting`. Returns a per-meeting outcome dict.

        Mutates `report["errors"]` / `report["summaries_truncated"]` directly; the caller
        decides whether the outcome belongs in `updated` or `skipped`.
        """
        matched_sources: list[str] = []
        # Providers whose email matched but carried no recap, and those whose recording
        # link we saved anyway. Both feed the skip reason so "nothing happened" is never
        # reported without saying why.
        matched_without_summary: set[str] = set()
        linked_sources: list[str] = []
        hit_summary_cap = False
        email_subjects: dict[str, str] = {}

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

            if not best["has_summary"]:
                # A notification, not a recap: the summary lives in the provider's web
                # app, not the email. Save the recording link if we can — that's the only
                # thing of value in it — and record why no notes appeared.
                matched_without_summary.add(source)
                url = extract_provider_url(best["body"], provider["url_domains"])
                if url and not getattr(meeting, provider["url_field"], ""):
                    setattr(meeting, provider["url_field"], url)
                    meeting.save(update_fields=[provider["url_field"]])
                    linked_sources.append(source)
                continue

            if state["summaries_done"] >= max_summaries:
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

            state["summaries_done"] += 1
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
            email_subjects[source] = best["subject"]

        return {
            "sources": matched_sources,
            "linked_sources": linked_sources,
            "without_summary": matched_without_summary,
            "hit_summary_cap": hit_summary_cap,
            "email_subjects": email_subjects,
        }

    def record(meeting, outcome, created_stub=False):
        if outcome["sources"]:
            note = {
                "meeting_id": meeting.pk,
                "airtable_id": meeting.airtable_id,
                "meeting_name": meeting.name,
                "date": meeting.date.isoformat() if meeting.date else None,
                "account_name": meeting.account.name if meeting.account else None,
                "sources": outcome["sources"],
            }
            if outcome["email_subjects"]:
                note["email_subjects"] = outcome["email_subjects"]
            if outcome["linked_sources"]:
                note["linked_sources"] = outcome["linked_sources"]
            if created_stub:
                # The meeting row didn't exist until this import created it.
                note["created_meeting"] = True
            report["updated"].append(note)
            return

        if outcome["hit_summary_cap"]:
            reason = "summary_limit_reached"
        elif outcome["without_summary"]:
            # The user can see these emails in their inbox, so "no matching email"
            # would read as a bug. Name the real cause instead.
            reason = "email_has_no_summary"
        elif meeting.gong_notes.strip() or meeting.zoom_notes.strip():
            reason = "already_summarized"
        else:
            reason = "no_matching_email"
        entry = {
            "meeting_id": meeting.pk,
            "meeting_name": meeting.name,
            "reason": reason,
        }
        if outcome["without_summary"]:
            entry["sources_without_summary"] = sorted(outcome["without_summary"])
        if outcome["linked_sources"]:
            entry["linked_sources"] = outcome["linked_sources"]
        report["skipped"].append(entry)

    for meeting in meetings:
        record(meeting, import_for_meeting(meeting))

    # Second pass: calendar events with no AirtableMeeting behind them.
    #
    # Notes hang off AirtableMeeting, but most meetings only exist as a Google Calendar
    # event — on a real account 3 of 11 Gong recaps had no row to attach to, so they were
    # silently skipped while the user could plainly see the email. When a recap matches
    # such an event we create the same `local-*` stub the manual paste path creates and
    # import into it. A stub is only created when there is a real summary to store: a
    # bare recording link isn't worth a new row.
    for event in events:
        stub = AirtableMeeting(
            airtable_id="",
            account=None,
            name=event.title or "",
            date=event.start_datetime,
        )
        if not _event_has_matching_recap(stub, messages):
            continue
        meeting = get_or_create_meeting_for_event(event)
        record(meeting, import_for_meeting(meeting), created_stub=True)

    # Rolled up so a caller doesn't have to walk `skipped` to explain a zero-import run.
    report["no_summary_in_email"] = sum(
        1 for s in report["skipped"] if s["reason"] == "email_has_no_summary"
    )
    report["meetings_created"] = sum(
        1 for item in report["updated"] if item.get("created_meeting")
    )
    report["recordings_linked"] = sum(
        len(item.get("linked_sources", []))
        for item in (*report["updated"], *report["skipped"])
    )
    return report
