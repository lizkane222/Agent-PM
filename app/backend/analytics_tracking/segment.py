"""
Segment HTTP Tracking API client.

Uses the standard HTTP API directly (no extra pip package) so there are
zero new dependencies. All calls are fire-and-forget in a background thread
so they never block request handling.
"""

import json
import logging
import os
import ssl
import threading
import urllib.request
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.segment.io/v1"
_TIMEOUT = 5  # seconds — must not block a request


def _write_key() -> str:
    # Read lazily so the key is always resolved after Django's load_dotenv() runs.
    return os.environ.get("SEGMENT_BACKEND_WRITE_KEY", "")


def _ssl_context() -> ssl.SSLContext:
    # Python 3.14 added a strict RFC 5280 check that rejects Zscaler's CA cert
    # because its Basic Constraints extension isn't marked critical.  We load the
    # default context (which includes Zscaler via REQUESTS_CA_BUNDLE or the system
    # keychain) and then relax the one flag that triggers the failure.
    ctx = ssl.create_default_context()
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    # Disable the strict Basic Constraints criticality check introduced in 3.14.
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT  # type: ignore[attr-defined]
    return ctx


def _post(path: str, payload: dict[str, Any]) -> None:
    key = _write_key()
    if not key:
        return
    import base64
    body = json.dumps(payload).encode()
    token = base64.b64encode(f"{key}:".encode()).decode()
    req = urllib.request.Request(
        f"{_ENDPOINT}{path}",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, context=_ssl_context(), timeout=_TIMEOUT):
            pass
    except Exception:
        logger.warning("Segment request failed (non-blocking)", exc_info=True)


def _fire(path: str, payload: dict[str, Any]) -> None:
    """Send asynchronously — never blocks the caller."""
    threading.Thread(target=_post, args=(path, payload), daemon=True).start()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def identify(user_id: int | str, traits: dict[str, Any] | None = None) -> None:
    _fire("/identify", {
        "userId": str(user_id),
        "traits": traits or {},
        "timestamp": _now(),
    })


def track(
    user_id: int | str,
    event: str,
    properties: dict[str, Any] | None = None,
) -> None:
    _fire("/track", {
        "userId": str(user_id),
        "event": event,
        "properties": properties or {},
        "timestamp": _now(),
    })


def page(
    user_id: int | str,
    name: str,
    properties: dict[str, Any] | None = None,
) -> None:
    _fire("/page", {
        "userId": str(user_id),
        "name": name,
        "properties": properties or {},
        "timestamp": _now(),
    })
