"""Shared plumbing for one-shot Claude calls that must return a JSON object."""

from __future__ import annotations

import json


def loads_object(raw: str) -> dict:
    """
    Parse the JSON object in `raw`, tolerating a code-fence wrapper or surrounding prose.

    Takes the first "{" to the last "}" rather than stripping fences by splitting on
    triple-backticks: a string *inside* the object (markdown instructions, say) can contain
    its own code blocks, and splitting on those cuts the object off mid-string.
    """
    text = (raw or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object in the model reply.")
    obj = json.loads(text[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("Model reply was not a JSON object.")
    return obj
