"""Validation for `Account.slack_channels`: the Slack channels used for an account."""

from __future__ import annotations

from urllib.parse import urlparse

from rest_framework import serializers

CHANNEL_TYPES = ("customer_facing", "account_team")
MAX_CHANNELS = 30
MAX_WORKSPACE = 100
MAX_CHANNEL = 120
MAX_URL = 500


def clean_slack_channels(value) -> list[dict]:
    """Return a normalised list, or raise ValidationError.

    Only http(s) URLs are accepted (blocks `javascript:` and friends); a leading `#` on the
    channel name is dropped; unknown keys are discarded. `workspace_icon` is an optional http(s) image URL.
    """
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise serializers.ValidationError("Slack channels must be a list.")
    if len(value) > MAX_CHANNELS:
        raise serializers.ValidationError(f"At most {MAX_CHANNELS} Slack channels.")
    cleaned = []
    for entry in value:
        if not isinstance(entry, dict):
            raise serializers.ValidationError("Each Slack channel must be an object.")
        workspace = str(entry.get("workspace", "")).strip()
        channel = str(entry.get("channel", "")).strip().lstrip("#").strip()
        url = str(entry.get("url", "")).strip()
        kind = entry.get("type")
        if not workspace or not channel:
            raise serializers.ValidationError("Each Slack channel needs a workspace and a channel name.")
        if len(workspace) > MAX_WORKSPACE or len(channel) > MAX_CHANNEL or len(url) > MAX_URL:
            raise serializers.ValidationError("A Slack channel field is too long.")
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise serializers.ValidationError("Slack channel URLs must start with http:// or https://.")
        if kind not in CHANNEL_TYPES:
            raise serializers.ValidationError("Slack channel type must be customer_facing or account_team.")
        item = {"workspace": workspace, "channel": channel, "url": url, "type": kind}
        # Optional icon for a custom workspace; preset workspaces draw a built-in icon instead.
        icon = entry.get("workspace_icon")
        icon = str(icon).strip() if icon else ""
        if icon:
            iparsed = urlparse(icon)
            if len(icon) > MAX_URL or iparsed.scheme not in ("http", "https") or not iparsed.netloc:
                raise serializers.ValidationError("Workspace icon URLs must start with http:// or https://.")
            item["workspace_icon"] = icon
        cleaned.append(item)
    return cleaned
