"""Pure helpers: recognise ticket links and guess kind / external key from a URL."""

import re
from urllib.parse import parse_qs, urlparse

_JIRA_KEY = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b")
_JIRA_BROWSE = re.compile(r"/browse/([A-Z][A-Z0-9]{1,9}-\d{1,7})(?:[/?#]|$)", re.I)
_ZD_AGENT = re.compile(r"/agent/tickets/(\d+)", re.I)
_ZD_REQUESTS = re.compile(r"/requests/(\d+)", re.I)
_ZD_HC = re.compile(r"/hc/", re.I)

URL_IN_TEXT = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def is_http_url(url: str) -> bool:
    try:
        return urlparse(url or "").scheme in ("http", "https")
    except ValueError:
        return False


def parse_ticket_url(url: str) -> dict:
    """Return {kind, external_key} for a recognised link; empty strings when unknown."""
    out = {"kind": "", "external_key": ""}
    if not url or not is_http_url(url):
        return out
    try:
        parsed = urlparse(url)
    except ValueError:
        return out
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host.endswith(".atlassian.net") or host == "atlassian.net" or "jira" in host:
        m = _JIRA_BROWSE.search(path)
        key = m.group(1).upper() if m else ""
        if not key:
            sel = parse_qs(parsed.query).get("selectedIssue")
            if sel and _JIRA_KEY.fullmatch(sel[0].upper()):
                key = sel[0].upper()
        if key or host.endswith(".atlassian.net"):
            return {"kind": "jira", "external_key": key}
    if host.endswith(".zendesk.com") or host == "zendesk.com":
        m = _ZD_AGENT.search(path) or _ZD_REQUESTS.search(path)
        if m:
            return {"kind": "zendesk", "external_key": f"#{m.group(1)}"}
        if _ZD_HC.search(path):
            return {"kind": "zendesk", "external_key": ""}
        return {"kind": "zendesk", "external_key": ""}
    return out


def find_ticket_url(text: str, kind: str = "") -> str:
    """First link in `text` that parses as a ticket (of `kind` when given)."""
    for m in URL_IN_TEXT.finditer(text or ""):
        url = m.group(0).rstrip(".,;")
        parsed = parse_ticket_url(url)
        if parsed["kind"] and (not kind or parsed["kind"] == kind) and parsed["external_key"]:
            return url
    return ""


def jira_key_from_text(text: str) -> str:
    m = _JIRA_KEY.search(text or "")
    return m.group(1) if m else ""


def zendesk_key_from_text(text: str) -> str:
    m = re.search(r"(?:Request|Ticket)\s*#\s*(\d+)|#(\d{3,})", text or "", re.I)
    if not m:
        return ""
    return f"#{m.group(1) or m.group(2)}"
