"""
Call the app's own REST endpoints in-process, as the signed-in user, from an agent tool.

This is how the agent's create/read/update tools get *exactly* the permissions the app
gives that user — not a hand-rewritten approximation. The earlier tools each re-implemented
their own checks, and an audit found several that allowed more than the UI: editing another
person's action items, renaming accounts as a non-owner, re-filing meetings onto accounts
the caller wasn't on. Routing through the real view also brings every side effect along
for free: Airtable write-back, the Google push, the activity log, Cloud Coach membership.

Mechanics:

* The path is resolved through Django's real URLconf (`django.urls.resolve`), so a typo
  raises instead of quietly reaching a different view, and URL-level routing order applies
  exactly as it does for the browser.
* A DRF `APIRequestFactory` request is built and `force_authenticate`d as the user. The view
  then runs its full stack — authentication, permission classes, the user's normal DRF
  throttle (so an agent turn spends the same 200/min budget the browser does and cannot
  route around it), `get_queryset` scoping, serializer validation, `perform_*` hooks. A
  throttled call surfaces as `rate_limited` with the view's own Retry-After.
* The response is rendered and returned as a plain `(status_code, data)` pair; `check()`
  turns a 4xx/5xx into a `ToolPolicyError` carrying the view's own message, which is
  already written for end users and contains no internals.

Everything here is synchronous; tools call it through `sync_to_async(thread_sensitive=True)`
so ORM work stays on the request thread (and is visible inside a TestCase transaction).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urlencode

from django.urls import Resolver404, resolve
from rest_framework.test import APIRequestFactory, force_authenticate

from .tool_policy import ToolPolicyError

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1/"
_factory = APIRequestFactory()


def call(user, method: str, path: str, *, data: Any = None, params: dict | None = None) -> tuple[int, Any]:
    """
    Run `method path` against the real view as `user`. Returns (status_code, data).

    `path` is relative to /api/v1/ (e.g. "scheduler/reminders/"). `params` become the query
    string; `data` is the JSON body.
    """
    method = method.upper()
    rel = path.lstrip("/")
    full_path = f"{API_PREFIX}{rel}"
    query = f"?{urlencode({k: v for k, v in (params or {}).items() if v is not None}, doseq=True)}" if params else ""

    try:
        match = resolve(full_path)
    except Resolver404:
        logger.error("rest_bridge: no route for %s %s", method, full_path)
        raise ToolPolicyError("internal_error", "That action is not available.")

    builder = getattr(_factory, method.lower())
    if method in ("GET", "DELETE"):
        request = builder(full_path + query)
    else:
        request = builder(full_path + query, data=json.dumps(data if data is not None else {}),
                          content_type="application/json")
    force_authenticate(request, user=user)

    response = match.func(request, *match.args, **match.kwargs)
    if hasattr(response, "render"):
        response.render()

    payload: Any = getattr(response, "data", None)
    if payload is None and getattr(response, "content", b""):
        try:
            payload = json.loads(response.content)
        except (ValueError, TypeError):
            payload = None
    return response.status_code, payload


def check(status_code: int, data: Any, *, action: str) -> Any:
    """Return `data` on 2xx, otherwise raise a ToolPolicyError with the view's own message."""
    if 200 <= status_code < 300:
        return data
    message = _message_from(data) or {
        400: f"The request to {action} was rejected as invalid.",
        403: f"You don't have permission to {action}.",
        404: f"Couldn't find that record, or you don't have access to it.",
        409: f"That conflicts with the current state of the record.",
    }.get(status_code, f"Could not {action}.")
    if status_code == 404:
        # Same wording for "missing" and "not yours", so existence cannot be probed.
        message = "Couldn't find that record, or you don't have access to it."
    code = {400: "invalid_arguments", 403: "forbidden", 404: "not_found", 409: "conflict",
            429: "rate_limited"}.get(status_code, "upstream_unavailable" if status_code >= 500 else "request_failed")
    retry_after = None
    if status_code == 429:
        retry_after = _wait_seconds(data) or 60
    raise ToolPolicyError(code, message, retryable=status_code >= 500 or status_code == 429,
                          retry_after=retry_after)


def _wait_seconds(data: Any) -> int | None:
    """DRF's throttle body is 'Request was throttled. Expected available in N seconds.'"""
    import re

    match = re.search(r"(\d+) second", _message_from(data))
    return int(match.group(1)) if match else None


def _message_from(data: Any) -> str:
    """Flatten a DRF error body into one readable sentence."""
    if not data:
        return ""
    if isinstance(data, str):
        return data[:500]
    if isinstance(data, list):
        return "; ".join(_message_from(d) for d in data if d)[:500]
    if isinstance(data, dict):
        for key in ("detail", "error", "message"):
            if key in data and isinstance(data[key], str):
                return data[key][:500]
        parts = []
        for key, value in data.items():
            text = _message_from(value)
            if text:
                parts.append(f"{key}: {text}" if key != "non_field_errors" else text)
        return "; ".join(parts)[:500]
    return str(data)[:500]


def results(data: Any) -> list:
    """Unwrap a DRF list response, paginated envelope or bare list."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        return data["results"]
    return []
