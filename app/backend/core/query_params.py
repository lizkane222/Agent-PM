"""
Helpers for parsing multi-valued query parameters.

Several list endpoints used to accept a single ID (``?event=5``) and the frontend
compensated by firing one request per ID — which burst past the DRF
``user`` throttle (see ``core.settings.REST_FRAMEWORK`` DEFAULT_THROTTLE_RATES)
and returned 429s. These helpers let a filter accept a comma-separated batch
(``?event=5,6,7``) so the client can collapse the fan-out into one request.

Parsing is deliberately lenient and additive: a single value still yields a
one-element list, so existing callers are unaffected.
"""


def csv_params(raw: str | None) -> list[str]:
    """Split a comma-separated query param into a list of non-empty tokens.

    ``None`` / ``""`` -> ``[]``. Whitespace around tokens is stripped, and empty
    tokens (from ``"1,,2"`` or a trailing comma) are dropped.
    """
    if not raw:
        return []
    return [token.strip() for token in raw.split(",") if token.strip()]


def csv_int_params(raw: str | None) -> list[int]:
    """Split a comma-separated query param into a list of ints.

    Non-numeric tokens are ignored rather than raising, so a malformed param
    degrades to a narrower filter instead of a 500.
    """
    return [int(token) for token in csv_params(raw) if token.isdigit()]
