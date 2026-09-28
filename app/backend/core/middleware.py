"""Project-wide middleware."""

from django.conf import settings


class MediaSecurityHeadersMiddleware:
    """
    Lock down user-uploaded files served under ``MEDIA_URL``.

    Uploaded HTML artifacts render from the application's own origin, so without
    this a document stored there would execute in the viewer's session. HTML
    responses are given a maximally-restrictive ``sandbox`` — no tokens, so the
    document lands in a unique opaque origin with scripting disabled entirely —
    which makes script execution a browser-enforced impossibility rather than
    something that depends on ``core.html_sanitize`` catching every vector.

    The two layers are complementary, not redundant: the sanitizer protects the
    bytes at rest (they may also be served by nginx/S3 in production, where this
    middleware never runs), and this header protects against anything the
    sanitizer missed.

    Deliberately scoped to HTML content types. Applying ``sandbox`` to every
    media response would also hit PDFs, whose built-in browser viewers rely on
    scripting — that would turn a security header into a visible regression.
    ``nosniff`` is safe for everything and is applied to all of ``MEDIA_URL``,
    so a mislabelled file cannot be re-interpreted as HTML.

    Must be listed BEFORE ``csp.middleware.CSPMiddleware`` in ``MIDDLEWARE``:
    response phases run in reverse order, so an earlier entry runs later and
    therefore wins when both set ``Content-Security-Policy``.
    """

    _HTML_TYPES = {"text/html", "application/xhtml+xml", "text/xml", "application/xml"}

    _SANDBOX_CSP = (
        "sandbox; "
        "default-src 'none'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'none'"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        media_url = settings.MEDIA_URL or "/media/"
        if not request.path.startswith(media_url):
            return response

        response["X-Content-Type-Options"] = "nosniff"
        content_type = (response.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type in self._HTML_TYPES:
            response["Content-Security-Policy"] = self._SANDBOX_CSP
            response["Referrer-Policy"] = "no-referrer"
        return response
