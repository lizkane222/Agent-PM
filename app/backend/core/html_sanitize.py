"""
Sanitize user-uploaded HTML so it can be stored and rendered in-app.

Uploaded HTML artifacts are served from the application's own origin
(``MEDIA_URL``), so anything the browser will execute from them runs with access
to the viewer's session. This module strips the executable surface at upload
time, before the bytes ever hit disk.

It is deliberately the *first* of two layers. The second is the
``Content-Security-Policy: sandbox`` header applied when an HTML artifact is
served (see ``accounts.views.artifact_file``), which blocks script execution in
the browser regardless of what this module missed. Sanitizing matters anyway:
``MEDIA_ROOT`` files can also be reached directly at ``/media/…``, a path that
carries no such header, so the stored bytes have to be safe on their own.

Allowlist, not blocklist: an unrecognised tag is dropped rather than trusted,
so a novel embedding vector fails closed.

No third-party dependency (``bleach`` / ``nh3`` / ``lxml_html_clean``) is used
here on purpose — this repo's ``app/backend/.venv`` resolves into the original
app's virtualenv, which must never be modified, so ``pip install`` is not
available. Everything below is stdlib.
"""

from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser

# Elements dropped together with everything inside them. `script` and `style`
# hold raw character data; the rest can load or execute remote content.
_DROP_WITH_CONTENT = frozenset({
    "script", "iframe", "object", "embed", "applet", "frame", "frameset",
    "noscript", "template", "portal",
})

# Elements dropped, but whose children are kept and re-emitted. `form` is here
# rather than above so the text of a report inside one survives; the submit
# behaviour is what we are removing.
_UNWRAP = frozenset({"form", "base", "link", "meta"})

# Everything the renderer is allowed to see. Structural + textual + tabular +
# inline SVG (charts in exported reports are commonly inline SVG).
_ALLOWED = frozenset({
    "html", "head", "body", "title", "style",
    "div", "span", "p", "br", "hr", "pre", "code", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "a", "img", "figure", "figcaption",
    "strong", "b", "em", "i", "u", "s", "strike", "small", "sub", "sup", "mark",
    "abbr", "cite", "q", "time", "kbd", "samp", "var", "wbr",
    "header", "footer", "main", "section", "article", "aside", "nav", "details", "summary",
    # inline SVG
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "defs", "marker", "linearGradient", "radialGradient", "stop",
    "clipPath", "mask", "pattern", "use", "symbol", "title", "desc",
})

# `foreignObject` is deliberately absent from _ALLOWED: it re-opens arbitrary
# HTML inside an SVG subtree, which is a known sanitizer-bypass shape.

_VOID = frozenset({
    "br", "hr", "img", "col", "wbr", "path", "rect", "circle", "ellipse",
    "line", "polyline", "polygon", "stop", "use",
})

# Attributes carrying a URL — value must pass _safe_url.
_URL_ATTRS = frozenset({"href", "src", "action", "formaction", "xlink:href", "poster", "background"})

_ALLOWED_ATTRS = frozenset({
    "class", "id", "title", "alt", "style", "href", "src", "width", "height",
    "colspan", "rowspan", "span", "align", "valign", "border", "cellpadding",
    "cellspacing", "dir", "lang", "datetime", "cite", "target", "rel", "type",
    "start", "reversed", "value", "open", "scope", "headers", "abbr", "summary",
    # SVG presentation attributes
    "viewBox", "xmlns", "d", "fill", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-dasharray", "transform", "x", "y", "x1", "x2",
    "y1", "y2", "cx", "cy", "r", "rx", "ry", "points", "offset", "opacity",
    "fill-opacity", "stroke-opacity", "font-family", "font-size", "font-weight",
    "text-anchor", "dominant-baseline", "gradientUnits", "patternUnits",
    "clip-path", "mask", "marker-end", "marker-start", "preserveAspectRatio",
})

# Schemes permitted in a URL attribute. `data:` is allowed for images only and
# only for still-image subtypes — `data:text/html` and `data:image/svg+xml` are
# both script-capable, so neither passes.
_SAFE_SCHEMES = ("http:", "https:", "mailto:", "tel:")
_SAFE_DATA_IMAGE = re.compile(r"^data:image/(png|jpe?g|gif|webp|bmp|x-icon)\s*;\s*base64\s*,", re.I)

# Matches a scheme at the start of a URL, tolerating the control characters and
# whitespace browsers strip before parsing (the classic `java\tscript:` bypass).
_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.\-]*:", re.I)
_STRIP_IN_URL = re.compile(r"[\x00-\x20\x7f]+")

# CSS constructs that can execute or fetch. `expression(` is legacy IE;
# `url(` is restricted because it can reference a javascript: target.
_UNSAFE_CSS = re.compile(r"(expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|@import|url\s*\(\s*['\"]?\s*(?!data:image/(?:png|jpe?g|gif|webp))[a-z]*script)", re.I)


def _safe_url(value: str) -> bool:
    """True when `value` is a URL we are willing to emit."""
    cleaned = _STRIP_IN_URL.sub("", value or "")
    if not cleaned:
        return False
    if _SAFE_DATA_IMAGE.match(cleaned):
        return True
    match = _SCHEME_RE.match(cleaned)
    if not match:
        # Relative URL (./report.css, #anchor, /media/x.png) — no scheme to abuse.
        return True
    return cleaned[: match.end()].lower() in _SAFE_SCHEMES


def _safe_style(value: str) -> str:
    """Return the style value, or "" if it contains anything executable."""
    return "" if _UNSAFE_CSS.search(value or "") else (value or "")


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        # convert_charrefs=False keeps entities as-authored so `&lt;` in the
        # source cannot be decoded here and re-emitted as a live `<`.
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self._suppress_depth = 0
        self._suppressing: str | None = None

    # ── helpers ──────────────────────────────────────────────────────────────

    def _clean_attrs(self, tag: str, attrs) -> str:
        out = []
        for raw_name, raw_value in attrs:
            name = (raw_name or "").lower()
            value = raw_value or ""
            # Every event handler, in one rule.
            if name.startswith("on"):
                continue
            if name in {"srcdoc", "srcset", "formtarget", "http-equiv", "ping"}:
                continue
            if name not in _ALLOWED_ATTRS and name not in _URL_ATTRS:
                continue
            if name in _URL_ATTRS and not _safe_url(value):
                continue
            if name == "style":
                value = _safe_style(value)
                if not value:
                    continue
            out.append(f' {escape(name, quote=True)}="{escape(value, quote=True)}"')
        # Any link that survived opens in a new context; without noopener the
        # opened page gets a handle back to this document via window.opener.
        if tag == "a":
            rendered = "".join(out)
            if "rel=" not in rendered:
                out.append(' rel="noopener noreferrer nofollow"')
        return "".join(out)

    # ── HTMLParser hooks ─────────────────────────────────────────────────────

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self._suppress_depth:
            if tag == self._suppressing:
                self._suppress_depth += 1
            return
        if tag in _DROP_WITH_CONTENT:
            self._suppressing = tag
            self._suppress_depth = 1
            return
        if tag in _UNWRAP or tag not in _ALLOWED:
            return
        self.parts.append(f"<{tag}{self._clean_attrs(tag, attrs)}>")

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if self._suppress_depth:
            return
        if tag in _DROP_WITH_CONTENT or tag in _UNWRAP or tag not in _ALLOWED:
            return
        self.parts.append(f"<{tag}{self._clean_attrs(tag, attrs)}/>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._suppress_depth:
            if tag == self._suppressing:
                self._suppress_depth -= 1
                if self._suppress_depth == 0:
                    self._suppressing = None
            return
        if tag in _UNWRAP or tag not in _ALLOWED or tag in _VOID:
            return
        self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if self._suppress_depth:
            return
        self.parts.append(data)

    def handle_entityref(self, name):
        if not self._suppress_depth:
            self.parts.append(f"&{name};")

    def handle_charref(self, name):
        if not self._suppress_depth:
            self.parts.append(f"&#{name};")

    def handle_comment(self, data):
        # Dropped entirely: IE conditional comments are a script vector, and a
        # comment is never load-bearing for rendering.
        return

    def handle_decl(self, decl):
        if not self._suppress_depth and decl.lower().startswith("doctype"):
            self.parts.append(f"<!{decl}>")

    def unknown_decl(self, data):
        # Covers CDATA sections, which can smuggle markup past a naive parser.
        return

    def handle_pi(self, data):
        # Processing instructions (`<?php`, `<?xml-stylesheet`) are never needed.
        return


def sanitize_html(markup: str) -> str:
    """Return `markup` with every executable construct removed."""
    parser = _Sanitizer()
    parser.feed(markup or "")
    parser.close()
    return "".join(parser.parts)


def is_html_filename(name: str) -> bool:
    """True for the extensions we sanitize and serve sandboxed."""
    return (name or "").lower().rsplit(".", 1)[-1] in {"html", "htm", "xhtml"} and "." in (name or "")
