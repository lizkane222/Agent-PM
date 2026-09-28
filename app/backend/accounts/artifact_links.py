"""Reverse lookup: which records reference a given AccountArtifact.

Batched into exactly 3 queries regardless of how many artifacts/accounts are
being resolved — the same batching discipline used for comment summaries and
the artifacts-batch route (see CLAUDE.md's 2026-08-18 session log entries).
"""
from __future__ import annotations


def used_in_map(artifact_ids, account_ids):
    """Return ``{artifact_id: [{resource_type, resource_id, label, url}]}``.

    ``artifact_ids`` / ``account_ids`` may be any iterable; both are coerced
    to sets. Artifacts with no known usage are simply absent from the
    returned dict — callers should default to ``[]`` via ``.get(id, [])``.
    """
    artifact_ids = {int(a) for a in artifact_ids}
    account_ids = {a for a in account_ids if a is not None}
    result: dict[int, list[dict]] = {}

    if not artifact_ids:
        return result

    def _append(artifact_id: int, entry: dict) -> None:
        result.setdefault(artifact_id, []).append(entry)

    # 1. Meetings (CalendarEvent) linking artifacts via `artifact_ids`
    if account_ids:
        from scheduler.models import CalendarEvent

        events = (
            CalendarEvent.objects.filter(account_id__in=account_ids)
            .exclude(artifact_ids=[])
            .only("id", "title", "artifact_ids", "account_id")
        )
        for ev in events:
            for aid in ev.artifact_ids or []:
                try:
                    aid_int = int(aid)
                except (TypeError, ValueError):
                    continue
                if aid_int in artifact_ids:
                    _append(aid_int, {
                        "resource_type": "calendar_event",
                        "resource_id": ev.id,
                        "label": ev.title or "(Untitled)",
                        "url": "/calendar",
                    })

    # 2. Goals/Projects linking artifacts via `resources` (id="artifact-<id>")
    if account_ids:
        from .models import AccountProject

        projects = AccountProject.objects.filter(account_id__in=account_ids).only(
            "id", "name", "kind", "resources", "account_id"
        )
        for proj in projects:
            for res in proj.resources or []:
                rid = res.get("id") if isinstance(res, dict) else None
                if not isinstance(rid, str) or not rid.startswith("artifact-"):
                    continue
                try:
                    aid_int = int(rid[len("artifact-"):])
                except ValueError:
                    continue
                if aid_int in artifact_ids:
                    _append(aid_int, {
                        "resource_type": "goal" if proj.kind == "goal" else "project",
                        "resource_id": proj.id,
                        "label": proj.name or "(Untitled)",
                        "url": f"/accounts/{proj.account_id}",
                    })

    # 3. Action-item attachments picked from an artifact via ArtifactPicker
    from airtable_sync.models import ActionItemAttachment

    attachments = (
        ActionItemAttachment.objects.filter(source_artifact_id__in=artifact_ids)
        .select_related("action_item")
        .only(
            "id", "source_artifact_id",
            "action_item__id", "action_item__task",
        )
    )
    for att in attachments:
        item = att.action_item
        _append(att.source_artifact_id, {
            "resource_type": "action_item",
            "resource_id": item.id,
            "label": item.task or "(Untitled)",
            "url": "/action-items",
        })

    return result
