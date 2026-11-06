"""
Slack conversations for skill context: list channels/DMs and read recent messages.

Dormant until a token exists. A user's own OAuth credential (`OAuthCredential`,
provider="slack") is preferred — it is the only token that can see that person's DMs.
`SLACK_BOT_TOKEN` is a channels-only fallback: a bot never sees other people's DMs, so
asking it for them would only return confusing empties. With neither, every function
reports `enabled: False` so the UI can show a "not connected yet" state instead of erroring.
"""

from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

MAX_CONVERSATIONS = 400
MAX_MESSAGES = 50


def _token_for(user) -> tuple[str, bool]:
    """(token, can_read_dms). ("", False) when Slack is not connected."""
    from .models import OAuthCredential

    cred = OAuthCredential.objects.filter(user=user, provider="slack", is_active=True).first()
    if cred and cred.access_token:
        return cred.access_token, True
    bot = getattr(settings, "SLACK_BOT_TOKEN", "")
    return (bot, False) if bot else ("", False)


def _client(token: str):
    from slack_sdk import WebClient

    return WebClient(token=token, timeout=10)


def list_conversations(user, query: str = "") -> dict:
    """
    {enabled, dms_available, conversations:[{id, kind, label}]}.
    `kind` is channel | private_channel | dm | group_dm.
    """
    token, can_dm = _token_for(user)
    if not token:
        return {"enabled": False, "dms_available": False, "conversations": [],
                "detail": "Slack isn't connected yet."}
    types = "public_channel,private_channel" + (",im,mpim" if can_dm else "")
    client = _client(token)
    out: list[dict] = []
    users: dict[str, str] = {}
    try:
        cursor = None
        while len(out) < MAX_CONVERSATIONS:
            resp = client.conversations_list(types=types, exclude_archived=True, limit=200, cursor=cursor)
            for c in resp.get("channels", []):
                if c.get("is_im"):
                    out.append({"id": c["id"], "kind": "dm", "label": c.get("user", "")})
                elif c.get("is_mpim"):
                    out.append({"id": c["id"], "kind": "group_dm", "label": c.get("name", "")})
                else:
                    out.append({"id": c["id"], "kind": "private_channel" if c.get("is_private") else "channel",
                                "label": "#" + c.get("name", "")})
            cursor = (resp.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                break
        if any(c["kind"] == "dm" for c in out):
            for u in client.users_list(limit=500).get("members", []):
                users[u["id"]] = u.get("real_name") or u.get("name") or u["id"]
            for c in out:
                if c["kind"] == "dm":
                    c["label"] = users.get(c["label"], c["label"])
    except Exception:
        logger.warning("Slack conversations.list failed", exc_info=True)
        return {"enabled": False, "dms_available": can_dm, "conversations": [],
                "detail": "Slack didn't respond. Reconnect Slack in Settings."}
    q = (query or "").strip().lower()
    if q:
        out = [c for c in out if q in c["label"].lower()]
    out.sort(key=lambda c: (c["kind"] in ("dm", "group_dm"), c["label"].lower()))
    return {"enabled": True, "dms_available": can_dm, "conversations": out[:MAX_CONVERSATIONS]}


def fetch_messages(user, conversation: str, limit: int = 20, oldest: str | None = None,
                   latest: str | None = None) -> dict:
    """Recent messages from a channel id or #name the user can see."""
    token, can_dm = _token_for(user)
    if not token:
        return {"enabled": False, "messages": [], "detail": "Slack isn't connected yet."}
    client = _client(token)
    channel = conversation
    try:
        if conversation.startswith("#") or not conversation[:1] in ("C", "D", "G"):
            wanted = conversation.lstrip("#").lower()
            found = next((c for c in list_conversations(user)["conversations"]
                          if c["label"].lstrip("#").lower() == wanted), None)
            if not found:
                return {"enabled": True, "messages": [], "detail": f"No Slack conversation named '{conversation}'."}
            channel = found["id"]
        if channel.startswith("D") and not can_dm:
            return {"enabled": True, "messages": [], "detail": "Connect your own Slack account to read DMs."}
        kwargs = {"channel": channel, "limit": max(1, min(int(limit or 20), MAX_MESSAGES))}
        if oldest:
            kwargs["oldest"] = oldest
        if latest:
            kwargs["latest"] = latest
        resp = client.conversations_history(**kwargs)
        names = {}
        msgs = []
        for m in resp.get("messages", []):
            uid = m.get("user", "")
            if uid and uid not in names:
                try:
                    names[uid] = client.users_info(user=uid)["user"].get("real_name") or uid
                except Exception:
                    names[uid] = uid
            msgs.append({"user": names.get(uid, uid or m.get("username", "")), "ts": m.get("ts"),
                         "text": (m.get("text") or "")[:1500]})
    except Exception:
        logger.warning("Slack conversations.history failed", exc_info=True)
        return {"enabled": True, "messages": [], "detail": "Slack didn't return those messages."}
    return {"enabled": True, "messages": msgs}
