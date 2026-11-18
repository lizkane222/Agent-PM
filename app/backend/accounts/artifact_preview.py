"""Server-side previews for artifact files the browser cannot show natively.

The preview overlay renders images, PDFs, video and audio straight from the file URL. Everything
else (text and code, CSV, HTML, Office documents, archives) is turned into a small JSON
description here, so:

* nothing is ever sent to a third-party viewer (the files can be internal);
* the browser never needs a cross-origin fetch of the file (the API and the media are on a
  different origin in development);
* untrusted file content is parsed with the standard library under hard limits.

Limits: files over 25 MB are refused, text is cut at 512 KB, tables at 200 rows x 50 columns,
archives list at most 500 entries, and a preview must finish inside ``BUDGET_SECONDS``. A zip-based
Office file whose *uncompressed* size is implausible is refused before anything is parsed, and XML
that declares a DOCTYPE or an ENTITY is rejected (entity expansion attacks).

``build_preview`` never raises and never puts exception text in its result; failures are logged
and answered with a fixed sentence.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import tarfile
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import PurePosixPath

from core.html_sanitize import sanitize_html

logger = logging.getLogger(__name__)

MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024
MAX_TEXT_BYTES = 512 * 1024
MAX_DOCUMENT_CHARS = 200_000
MAX_TABLE_ROWS = 200
MAX_TABLE_COLS = 50
MAX_SHEETS = 5
MAX_SLIDES = 100
MAX_ARCHIVE_ENTRIES = 500
MAX_XML_MEMBER_BYTES = 20 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024
BUDGET_SECONDS = 8.0

TEXT_EXTENSIONS = {
    "txt", "log", "md", "markdown", "json", "yaml", "yml", "ini", "toml", "cfg", "conf", "env",
    "sql", "css", "java", "go", "c", "h", "cpp", "hpp", "rs", "swift", "kt", "r", "scala",
    "lua", "gradle", "properties", "rtf", "tex", "diff", "patch", "graphql", "proto",
}
TABLE_EXTENSIONS = {"csv", "tsv"}
HTML_EXTENSIONS = {"html", "htm", "xhtml"}
NATIVE_PREFIXES = ("image/", "video/", "audio/")

_NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_NS_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


class PreviewTimeout(Exception):
    pass


class _Budget:
    def __init__(self, seconds: float | None = None):
        self._deadline = time.monotonic() + (BUDGET_SECONDS if seconds is None else seconds)

    def check(self) -> None:
        if time.monotonic() > self._deadline:
            raise PreviewTimeout()


class _Refused(Exception):
    """A file we will not parse (carries a result dict, never exception text)."""

    def __init__(self, result: dict):
        self.result = result


def _extension(name: str) -> str:
    return name.lower().rsplit(".", 1)[-1] if "." in name else ""


def _decode(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16", errors="replace")
    return raw.decode("utf-8-sig", errors="replace")


def _looks_binary(raw: bytes) -> bool:
    return b"\x00" in raw[:4096] and not raw.startswith((b"\xff\xfe", b"\xfe\xff"))


# ── zip-based Office files ────────────────────────────────────────────────────

def _open_zip(raw: bytes) -> zipfile.ZipFile:
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise _Refused({"kind": "unsupported", "reason": "corrupt"})
    infos = zf.infolist()
    if len(infos) > 20_000 or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED_BYTES:
        raise _Refused({"kind": "too_large", "reason": "archive_expands_too_far"})
    return zf


def _read_xml(zf: zipfile.ZipFile, name: str, budget: _Budget):
    """Parse one XML member, or None when absent. Refuses DTDs/entities and huge members."""
    budget.check()
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_XML_MEMBER_BYTES:
        raise _Refused({"kind": "too_large", "reason": "xml_too_large"})
    data = zf.read(name)
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise _Refused({"kind": "unsupported", "reason": "unsafe_xml"})
    return ET.fromstring(data)


def _column_index(ref: str) -> int:
    letters = re.match(r"[A-Za-z]+", ref or "")
    if not letters:
        return 0
    n = 0
    for ch in letters.group(0).upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _shared_strings(zf, budget) -> list[str]:
    root = _read_xml(zf, "xl/sharedStrings.xml", budget)
    if root is None:
        return []
    out = []
    for si in root.iter(f"{_NS_MAIN}si"):
        out.append("".join(t.text or "" for t in si.iter(f"{_NS_MAIN}t")))
        if len(out) >= 50_000:
            break
    return out


def _sheet_files(zf, budget) -> list[tuple[str, str]]:
    """[(sheet name, member path)] in workbook order."""
    wb = _read_xml(zf, "xl/workbook.xml", budget)
    rels = _read_xml(zf, "xl/_rels/workbook.xml.rels", budget)
    targets = {}
    if rels is not None:
        for rel in rels.iter(f"{_NS_PKG_REL}Relationship"):
            target = rel.get("Target", "")
            path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            targets[rel.get("Id")] = str(PurePosixPath(path))
    out = []
    if wb is not None:
        for sheet in wb.iter(f"{_NS_MAIN}sheet"):
            path = targets.get(sheet.get(f"{_NS_REL}id"))
            if path:
                out.append((sheet.get("name") or f"Sheet {len(out) + 1}", path))
    if not out:
        names = sorted(
            (n for n in zf.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
            key=lambda n: int(re.findall(r"\d+", n)[-1]),
        )
        out = [(f"Sheet {i + 1}", n) for i, n in enumerate(names)]
    return out


def _xlsx_preview(raw: bytes, budget: _Budget) -> dict:
    zf = _open_zip(raw)
    strings = _shared_strings(zf, budget)
    sheets, truncated = [], False
    files = _sheet_files(zf, budget)
    if len(files) > MAX_SHEETS:
        truncated = True
    for name, path in files[:MAX_SHEETS]:
        root = _read_xml(zf, path, budget)
        if root is None:
            continue
        rows: list[list[str]] = []
        for row in root.iter(f"{_NS_MAIN}row"):
            budget.check()
            if len(rows) >= MAX_TABLE_ROWS:
                truncated = True
                break
            cells: list[str] = []
            for c in row.iter(f"{_NS_MAIN}c"):
                idx = _column_index(c.get("r", ""))
                if idx >= MAX_TABLE_COLS:
                    truncated = True
                    continue
                kind = c.get("t")
                v = c.find(f"{_NS_MAIN}v")
                if kind == "s" and v is not None and (v.text or "").isdigit():
                    i = int(v.text)
                    value = strings[i] if i < len(strings) else ""
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in c.iter(f"{_NS_MAIN}t"))
                else:
                    value = (v.text or "") if v is not None else ""
                while len(cells) <= idx:
                    cells.append("")
                cells[idx] = value
            rows.append(cells)
        sheets.append({"name": name, "rows": rows})
    return {"kind": "table", "sheets": sheets, "truncated": truncated}


def _pptx_preview(raw: bytes, budget: _Budget) -> dict:
    zf = _open_zip(raw)
    names = sorted(
        (n for n in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
        key=lambda n: int(re.findall(r"\d+", n)[-1]),
    )
    slides = []
    for n in names[:MAX_SLIDES]:
        root = _read_xml(zf, n, budget)
        lines = []
        for para in root.iter(f"{_NS_A}p"):
            text = "".join(t.text or "" for t in para.iter(f"{_NS_A}t")).strip()
            if text:
                lines.append(text)
        slides.append({"index": len(slides) + 1, "lines": lines})
    return {"kind": "slides", "slides": slides, "truncated": len(names) > MAX_SLIDES}


def _docx_preview(raw: bytes, budget: _Budget) -> dict:
    _open_zip(raw)  # same bomb guard before python-docx reads it
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(io.BytesIO(raw))
    lines: list[str] = []
    for child in document.element.body.iterchildren():
        budget.check()
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = Paragraph(child, document).text.strip()
            if text:
                lines.append(text)
        elif tag == "tbl":
            for row in Table(child, document).rows:
                cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                if any(cells):
                    lines.append(" | ".join(cells))
        if sum(len(x) for x in lines) > MAX_DOCUMENT_CHARS:
            break
    text = "\n".join(lines)
    return {"kind": "document", "text": text[:MAX_DOCUMENT_CHARS], "truncated": len(text) > MAX_DOCUMENT_CHARS}


# ── archives ─────────────────────────────────────────────────────────────────

def _zip_listing(raw: bytes, budget: _Budget) -> dict:
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        return {"kind": "unsupported", "reason": "corrupt"}
    infos = zf.infolist()
    entries = [{"name": i.filename[:300], "size": i.file_size} for i in infos[:MAX_ARCHIVE_ENTRIES]]
    return {"kind": "archive", "entries": entries, "truncated": len(infos) > MAX_ARCHIVE_ENTRIES}


def _tar_listing(raw: bytes, budget: _Budget) -> dict:
    # Plain .tar only: listing a compressed tar means decompressing everything before the next
    # header, which an attacker can make arbitrarily expensive.
    entries, truncated = [], False
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tf:
            for member in tf:
                budget.check()
                if len(entries) >= MAX_ARCHIVE_ENTRIES:
                    truncated = True
                    break
                entries.append({"name": member.name[:300], "size": member.size})
    except tarfile.TarError:
        return {"kind": "unsupported", "reason": "corrupt"}
    return {"kind": "archive", "entries": entries, "truncated": truncated}


# ── text-like files ──────────────────────────────────────────────────────────

def _table_from_delimited(text: str, delimiter: str, budget: _Budget) -> dict:
    rows, truncated = [], False
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        budget.check()
        if len(rows) >= MAX_TABLE_ROWS:
            truncated = True
            break
        if len(row) > MAX_TABLE_COLS:
            row, truncated = row[:MAX_TABLE_COLS], True
        rows.append([c[:2000] for c in row])
    return {"kind": "table", "sheets": [{"name": "", "rows": rows}], "truncated": truncated}


def _text_preview(raw: bytes, ext: str, file_truncated: bool, budget: _Budget) -> dict:
    if _looks_binary(raw):
        return {"kind": "unsupported", "reason": "binary"}
    text = _decode(raw)
    if ext in TABLE_EXTENSIONS:
        result = _table_from_delimited(text, "\t" if ext == "tsv" else ",", budget)
        result["truncated"] = result["truncated"] or file_truncated
        return result
    if ext in HTML_EXTENSIONS:
        # Uploads are already sanitized; do it again so a row written another way is safe too.
        return {"kind": "html", "html": sanitize_html(text), "truncated": file_truncated}
    fmt = "markdown" if ext in ("md", "markdown") else "json" if ext == "json" else "code" if ext not in ("txt", "log") else "plain"
    return {"kind": "text", "format": fmt, "text": text, "truncated": file_truncated}


def _is_text_like(ext: str, mime: str) -> bool:
    return ext in TEXT_EXTENSIONS or ext in TABLE_EXTENSIONS or ext in HTML_EXTENSIONS or mime.startswith("text/") or mime in (
        "application/json", "application/x-yaml", "application/yaml")


def build_preview(artifact) -> dict:
    """The preview description for `artifact` (see module docstring). Never raises."""
    try:
        return _build(artifact)
    except _Refused as refused:
        return refused.result
    except PreviewTimeout:
        return {"kind": "error", "detail": "This preview took too long to build."}
    except Exception:
        logger.warning("Artifact preview failed for artifact %s", getattr(artifact, "pk", None), exc_info=True)
        return {"kind": "error", "detail": "This file could not be read for a preview."}


def _build(artifact) -> dict:
    if artifact.artifact_type != "file" or not artifact.file:
        return {"kind": "unsupported", "reason": "not_a_file"}
    mime = (artifact.mime_type or "").lower()
    ext = _extension(artifact.name or artifact.file.name or "")
    if mime.startswith(NATIVE_PREFIXES) or ext == "pdf":
        return {"kind": "native"}
    try:
        size = artifact.file.size
    except (OSError, ValueError):
        return {"kind": "unavailable"}
    if size > MAX_PREVIEW_FILE_BYTES:
        return {"kind": "too_large", "size": size}

    budget = _Budget()
    text_like = _is_text_like(ext, mime)
    try:
        with artifact.file.open("rb") as fh:
            raw = fh.read((MAX_TEXT_BYTES + 1) if text_like else (MAX_PREVIEW_FILE_BYTES + 1))
    except (OSError, ValueError):
        return {"kind": "unavailable"}

    if text_like:
        truncated = len(raw) > MAX_TEXT_BYTES
        return _text_preview(raw[:MAX_TEXT_BYTES], ext, truncated, budget)
    if ext == "docx":
        return _docx_preview(raw, budget)
    if ext == "xlsx":
        return _xlsx_preview(raw, budget)
    if ext == "pptx":
        return _pptx_preview(raw, budget)
    if ext == "zip":
        return _zip_listing(raw, budget)
    if ext == "tar":
        return _tar_listing(raw, budget)
    return {"kind": "unsupported", "reason": "type"}


__all__ = ["build_preview", "MAX_PREVIEW_FILE_BYTES", "MAX_TEXT_BYTES"]
