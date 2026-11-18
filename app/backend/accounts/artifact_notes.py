"""Helpers for ArtifactNote text."""
from html import unescape
import re

_BLOCK_END = re.compile(r"</(p|div|li|h[1-6]|tr)>|<br\s*/?>", re.I)
_TAG = re.compile(r"<[^>]+>")


def html_to_text(markup: str) -> str:
    """Plain text of sanitized note HTML (block ends become newlines)."""
    text = unescape(_TAG.sub("", _BLOCK_END.sub("\n", markup or "")))
    return re.sub(r"\n{3,}", "\n\n", text).strip()
