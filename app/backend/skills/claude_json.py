"""Shared plumbing for one-shot Claude calls that must return a JSON object."""

from __future__ import annotations

import json


def loads_object(raw: str) -> dict:
    """Parse the first JSON object in `raw`, tolerating code fences and surrounding prose."""
    text = (raw or "").strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in the model reply.")
    obj = json.loads(text[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("Model reply was not a JSON object.")
    return obj
