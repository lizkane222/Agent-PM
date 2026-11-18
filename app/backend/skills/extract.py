"""Plain-text extraction for skill attachments (md/txt/html/docx/pdf)."""

from __future__ import annotations

import io
import logging
import re
from html import unescape

logger = logging.getLogger(__name__)

# Stored text feeds every run prompt, so it is capped at upload.
MAX_EXTRACTED_CHARS = 60_000

# Resource caps: an upload is untrusted. A .docx is a zip (decompression bomb), a PDF can have
# thousands of pages, and the tag regexes below are quadratic on input full of unclosed "<".
MAX_HTML_CHARS = 1_000_000
MAX_DOCX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024
MAX_ZIP_MEMBERS = 500
MAX_PDF_PAGES = 200
MAX_DOCX_PARAGRAPHS = 20_000

_BLOCK_START_RE = re.compile(r"<(script|style)\b")
_TAG_RE = re.compile(r"<[^<>]{1,2000}>")
_BLOCK_END_RE = re.compile(r"</(p|div|li|h[1-6]|tr|br)>|<br\s*/?>", re.I)


def _decode(raw: bytes) -> str:
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


def _html_to_text(markup: str) -> str:
    markup = markup[:MAX_HTML_CHARS]
    markup = _strip_blocks(markup)
    return unescape(_TAG_RE.sub("", _BLOCK_END_RE.sub("\n", markup)))


def _strip_blocks(markup: str) -> str:
    """Drop <script>/<style> blocks in one linear pass (a nested-scan regex is quadratic on hostile input)."""
    lowered = markup.lower()
    out, pos = [], 0
    for m in _BLOCK_START_RE.finditer(lowered):
        if m.start() < pos:
            continue
        end = lowered.find(f"</{m.group(1)}>", m.end())
        out.append(markup[pos:m.start()])
        if end == -1:  # unclosed: drop the rest
            return "".join(out)
        pos = end + len(m.group(1)) + 3
    out.append(markup[pos:])
    return "".join(out)


def _docx_text(raw: bytes) -> str:
    import zipfile

    import docx

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_MEMBERS or sum(i.file_size for i in infos) > MAX_DOCX_UNCOMPRESSED_BYTES:
            raise ValueError("docx expands beyond the allowed size")
    document = docx.Document(io.BytesIO(raw))
    lines = []
    for p in document.paragraphs[:MAX_DOCX_PARAGRAPHS]:
        text = p.text.strip()
        if not text:
            continue
        style = (p.style.name or "") if p.style is not None else ""
        if style.startswith("Heading"):
            level = "".join(c for c in style if c.isdigit()) or "1"
            lines.append(f"{'#' * int(level)} {text}")
        elif "List" in style:
            lines.append(f"* {text}")
        else:
            lines.append(text)
    return "\n".join(lines)


def _pdf_text(raw: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted:
        return ""
    out: list[str] = []
    total = 0
    for page in reader.pages[:MAX_PDF_PAGES]:
        chunk = page.extract_text() or ""
        out.append(chunk)
        total += len(chunk)
        if total > MAX_EXTRACTED_CHARS:
            break
    return "\n".join(out)


def extract_text(name: str, raw: bytes) -> str:
    """Best-effort text of `raw`. Unreadable or unsupported types yield ""."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    try:
        if ext in ("md", "markdown", "txt", "csv", "json"):
            text = _decode(raw[:MAX_HTML_CHARS * 2])
        elif ext in ("html", "htm"):
            text = _html_to_text(_decode(raw[:MAX_HTML_CHARS * 2]))
        elif ext == "docx":
            text = _docx_text(raw)
        elif ext == "pdf":
            text = _pdf_text(raw)
        else:
            text = ""
    except Exception:  # a corrupt file must not fail the upload
        logger.warning("Could not extract text from %s", name, exc_info=True)
        return ""
    return text.strip()[:MAX_EXTRACTED_CHARS]


_H_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
_MIN_BODY = 40


def _clean_title(raw: str) -> str:
    title = re.sub(r"[*_`]+", "", raw)
    title = re.sub(r"\\(.)", r"\1", title)
    # Drop leading emoji/symbol decoration and trailing colons.
    title = re.sub(r"^[^\w\[(]+", "", title, flags=re.UNICODE).strip().rstrip(":").strip()
    return title or "Untitled"


def split_sections(text: str) -> dict:
    """
    Split a markdown document into selectable templates.

    Splits at the shallowest heading level that yields at least two sections with real
    body text. Everything before the first such section, and any heading-only chunks
    (a document title, a section divider), becomes `intro` rather than a template.
    Returns {intro: str, sections: [{key, title, markdown}]}.
    """
    lines = text.splitlines()
    for level in range(1, 4):
        chunks, current = [], None
        preamble: list[str] = []
        for line in lines:
            m = _H_RE.match(line)
            if m and len(m.group(1)) == level:
                current = {"title": _clean_title(m.group(2)), "lines": [line]}
                chunks.append(current)
            elif current is None:
                preamble.append(line)
            else:
                current["lines"].append(line)
        real = [c for c in chunks if len(_body_text(c["lines"])) >= _MIN_BODY]
        if len(real) >= 2:
            intro_parts = ["\n".join(preamble).strip()] + [
                "\n".join(c["lines"]).strip() for c in chunks if c not in real]
            sections, used = [], set()
            for c in real:
                key = re.sub(r"[^a-z0-9]+", "-", c["title"].lower()).strip("-")[:40] or "section"
                base, n = key, 2
                while key in used:
                    key, n = f"{base}-{n}", n + 1
                used.add(key)
                sections.append({"key": key, "title": c["title"], "markdown": "\n".join(c["lines"][1:]).strip()})
            return {"intro": "\n\n".join(p for p in intro_parts if p), "sections": sections}
    return {"intro": "", "sections": []}


def _body_text(lines: list[str]) -> str:
    return " ".join(l.strip() for l in lines[1:] if l.strip() and not _H_RE.match(l))
