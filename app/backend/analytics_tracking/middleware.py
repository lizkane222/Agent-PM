"""
SegmentTrackingMiddleware — fires backend Segment track() calls for every
successful mutating API request (POST/PUT/PATCH/DELETE to /api/v1/…).

This single middleware replaces per-viewset instrumentation so no per-view
code is needed.  It runs *after* the view so it reads the real response status
and the saved resource data from the JSON body.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from . import segment

logger = logging.getLogger(__name__)

# Maps URL regex patterns (checked in order) to human-readable labels.
# Nested action routes include a numeric PK between the resource and sub-path
# (e.g. /accounts/accounts/3/artifacts/), so substring matching is insufficient;
# regex with \d+ handles those cases. More-specific patterns must precede their
# prefixes (e.g. nested artifact before catch-all /accounts).
RESOURCE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Airtable (most specific first)
    (re.compile(r"/airtable/action-items"), "Action Item"),
    (re.compile(r"/airtable/meetings"), "Meeting"),
    (re.compile(r"/airtable/accounts"), "Airtable Account"),
    # Nested account sub-resources — pk sits between "accounts" and sub-path
    (re.compile(r"/accounts/accounts/\d+/artifacts"), "Account Artifact"),
    (re.compile(r"/accounts/accounts/\d+/notes"), "Account Note"),
    (re.compile(r"/accounts/accounts/\d+/quick-links"), "Account Quick Link"),
    (re.compile(r"/accounts/accounts/\d+/action-items"), "Action Item"),
    (re.compile(r"/accounts/accounts/\d+/reminders"), "Reminder"),
    (re.compile(r"/accounts/accounts/\d+/team-members"), "Account"),
    # Standalone account sub-resource viewsets
    (re.compile(r"/accounts/artifacts"), "Account Artifact"),
    (re.compile(r"/accounts/notes"), "Account Note"),
    (re.compile(r"/accounts/quick-links"), "Account Quick Link"),
    # Nested contact notes
    (re.compile(r"/accounts/contacts/\d+/notes"), "Contact Note"),
    (re.compile(r"/accounts/contact-notes"), "Contact Note"),
    (re.compile(r"/accounts/contacts"), "Contact"),
    (re.compile(r"/accounts"), "Account"),
    # Scheduler
    (re.compile(r"/scheduler/events"), "Calendar Event"),
    (re.compile(r"/scheduler/action-items"), "Action Item"),
    (re.compile(r"/scheduler/reminders"), "Reminder"),
    (re.compile(r"/scheduler/tasks"), "Task"),
    (re.compile(r"/scheduler/meeting-notes"), "Meeting Note"),
    # Team
    (re.compile(r"/team/members"), "Team Member"),
    (re.compile(r"/team/profile"), "Profile"),
    # Other
    (re.compile(r"/comments"), "Comment"),
    (re.compile(r"/skills"), "Claude Skill"),
    (re.compile(r"/layouts"), "Page Layout"),
    (re.compile(r"/salesforce/log-time"), "Salesforce Time Log"),
    (re.compile(r"/discover"), "Discover Applet"),
    (re.compile(r"/integrations/google"), "Google Integration"),
    (re.compile(r"/integrations/slack"), "Slack Integration"),
    (re.compile(r"/integrations/salesforce"), "Salesforce Integration"),
]

METHOD_VERBS: dict[str, str] = {
    "POST": "Created",
    "PUT": "Updated",
    "PATCH": "Updated",
    "DELETE": "Deleted",
}

SUCCESS_STATUSES: dict[str, set[int]] = {
    "POST": {200, 201},
    "PUT": {200},
    "PATCH": {200},
    "DELETE": {200, 204},
}


def _resource_for_path(path: str) -> str | None:
    for pattern, label in RESOURCE_PATTERNS:
        if pattern.search(path):
            return label
    return None


def _props_from_body(body: bytes) -> dict[str, Any]:
    props: dict[str, Any] = {}
    try:
        data = json.loads(body)
        if not isinstance(data, dict):
            return props
        if data.get("id"):
            props["id"] = data["id"]
        for name_field in ("name", "title", "task", "company_name", "subject"):
            if data.get(name_field):
                props["name"] = data[name_field]
                break
        for extra in ("status", "priority", "account_name", "account"):
            if data.get(extra):
                props[extra] = data[extra]
    except Exception:
        pass
    return props


class SegmentTrackingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        method = request.method or ""
        verb = METHOD_VERBS.get(method)
        if not verb:
            return response

        path = request.path
        if not path.startswith("/api/v1/"):
            return response

        ok_statuses = SUCCESS_STATUSES.get(method, set())
        if response.status_code not in ok_statuses:
            return response

        resource = _resource_for_path(path)
        if not resource:
            return response

        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return response

        try:
            props = _props_from_body(getattr(response, "content", b""))
            props["resource"] = resource
            segment.track(user.pk, f"{resource} {verb}", props)
        except Exception:
            logger.debug("Segment middleware track failed", exc_info=True)

        return response
