"""Global fuzzy search across all bases."""
from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


def _icontains_q(fields: list[str], term: str) -> Q:
    q = Q()
    for f in fields:
        q |= Q(**{f"{f}__icontains": term})
    return q


def _score(text: str, term: str) -> int:
    """Higher = better match. Title-starts-with > contains > word-contains."""
    t = text.lower()
    s = term.lower()
    if t.startswith(s):
        return 3
    if s in t:
        return 2
    if any(w.startswith(s) for w in t.split()):
        return 1
    return 0


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def global_search(request):
    """
    GET /api/v1/search/?q=<term>&page_context=<type>

    Returns up to 60 results grouped by type. Results matching page_context
    appear first within their group, but all types are returned.
    """
    term = (request.query_params.get("q") or "").strip()
    if not term or len(term) < 2:
        return Response({"results": []})

    page_context = request.query_params.get("page_context", "")
    user = request.user
    is_staff = bool(getattr(user, "is_staff", False))
    results: list[dict[str, Any]] = []

    # Pre-compute the set of Django Account IDs and Airtable IDs the user can
    # see. Every entity block below scopes its query through one of these two
    # sets to prevent cross-team leakage via global search.
    from accounts.models import Account as _AccountForScope
    if is_staff:
        _allowed_account_ids = None  # sentinel — "no restriction"
        _allowed_airtable_ids = None
    else:
        _allowed_account_ids = set(
            _AccountForScope.objects.filter(team_members__user=user)
            .values_list("id", flat=True)
            .distinct()
        )
        _allowed_airtable_ids = set(
            _AccountForScope.objects.filter(team_members__user=user)
            .exclude(airtable_id__exact="")
            .values_list("airtable_id", flat=True)
            .distinct()
        )

    # ── Airtable Action Items ──────────────────────────────────────────────────
    try:
        from airtable_sync.models import AirtableActionItem
        # account_name is a SerializerMethodField — filter via FK traversal account__name.
        # due_date and slack_thread_url removed: icontains on a DateField/URL is semantically wrong.
        qs = AirtableActionItem.objects.filter(
            _icontains_q(["task", "task_details", "assignee_name", "account__name",
                          "status", "priority"], term)
        ).select_related("account")
        if _allowed_airtable_ids is not None:
            qs = qs.filter(
                Q(account__isnull=True) | Q(account__airtable_id__in=_allowed_airtable_ids)
            )
        qs = qs[:20]
        for obj in qs:
            results.append({
                "type": "action_item",
                "type_label": "Action Item",
                "id": obj.airtable_id,
                "title": obj.task or "(Untitled)",
                "detail": obj.task_details[:120] if obj.task_details else "",
                "account": (obj.account.name if obj.account_id else "") or "",
                "meta": f"{obj.status} · {obj.priority}" + (f" · Due {obj.due_date}" if obj.due_date else ""),
                "url": "/action-items",
                "accent": "#6366f1",
            })
    except Exception:
        logger.exception("search: action_items section failed")

    # ── Airtable Meetings ──────────────────────────────────────────────────────
    try:
        from airtable_sync.models import AirtableMeeting
        # account_name is a SerializerMethodField — use account__name for DB traversal.
        qs = AirtableMeeting.objects.filter(
            _icontains_q(["name", "expected_topics", "gong_notes", "gong_url",
                          "customer_slack", "account_team_slack", "account__name"], term)
        ).select_related("account")
        if _allowed_airtable_ids is not None:
            qs = qs.filter(account__airtable_id__in=_allowed_airtable_ids)
        qs = qs[:15]
        for obj in qs:
            results.append({
                "type": "meeting",
                "type_label": "Meeting",
                "id": obj.airtable_id,
                "title": obj.name or "(Untitled)",
                "detail": (obj.expected_topics or obj.gong_notes or "")[:120],
                "account": (obj.account.name if obj.account_id else "") or "",
                "meta": (f"Date {obj.date}" if obj.date else ""),
                "url": "/calendar",
                "accent": "#0ea5e9",
            })
    except Exception:
        logger.exception("search: meetings section failed")

    # ── Airtable Accounts ──────────────────────────────────────────────────────
    # Only include AirtableAccount records that do NOT have a corresponding Django
    # Account row — those are already returned below with a proper /accounts/{id} URL.
    try:
        from airtable_sync.models import AirtableAccount
        from accounts.models import Account as _Account
        synced_airtable_ids = set(
            _Account.objects.filter(airtable_id__gt="").values_list("airtable_id", flat=True)
        )
        qs = AirtableAccount.objects.filter(
            _icontains_q(["name", "email_domain", "health_score",
                          "salesforce_account_id", "segment_workspaces"], term)
        ).exclude(airtable_id__in=synced_airtable_ids)
        if _allowed_airtable_ids is not None:
            qs = qs.filter(airtable_id__in=_allowed_airtable_ids)
        qs = qs[:10]
        for obj in qs:
            results.append({
                "type": "airtable_account",
                "type_label": "Account",
                "id": obj.airtable_id,
                "title": obj.name,
                "detail": obj.email_domain or "",
                "account": obj.name,
                "meta": f"Health {obj.health_score}" if obj.health_score else "",
                "url": "/accounts",
                "accent": "#10b981",
            })
    except Exception:
        logger.exception("search: airtable_accounts section failed")

    # ── Reminders ─────────────────────────────────────────────────────────────
    try:
        from scheduler.models import Reminder
        qs = Reminder.objects.filter(created_by=user).filter(
            _icontains_q(["title", "body", "resource_label", "resource_type",
                          "status", "due_at"], term)
        )[:15]
        for obj in qs:
            results.append({
                "type": "reminder",
                "type_label": "Reminder",
                "id": obj.id,
                "title": obj.title,
                "detail": obj.body[:120] if obj.body else "",
                "account": obj.resource_label or "",
                "meta": f"{obj.status} · Due {obj.due_at.strftime('%b %d %Y %H:%M') if obj.due_at else ''}",
                "url": "/reminders",
                "accent": "#f59e0b",
            })
    except Exception:
        logger.exception("search: reminders section failed")

    # ── Calendar Events ────────────────────────────────────────────────────────
    try:
        from scheduler.models import CalendarEvent
        qs = CalendarEvent.objects.filter(owner=user).filter(
            _icontains_q(["title", "description", "location", "meet_link"], term)
        ).order_by("start_datetime")[:15]
        for obj in qs:
            results.append({
                "type": "calendar_event",
                "type_label": "Calendar Event",
                "id": obj.id,
                "title": obj.title,
                "detail": obj.description[:120] if obj.description else obj.location,
                "account": "",
                "meta": obj.start_datetime.strftime("%b %d %Y %H:%M") if obj.start_datetime else "",
                "url": "/calendar",
                "accent": "#0ea5e9",
            })
    except Exception:
        logger.exception("search: calendar_events section failed")

    # ── Account Notes ──────────────────────────────────────────────────────────
    try:
        from accounts.models import AccountNote
        qs = AccountNote.objects.filter(
            _icontains_q(["content"], term)
        ).select_related("account")
        if _allowed_account_ids is not None:
            qs = qs.filter(account_id__in=_allowed_account_ids)
        qs = qs[:10]
        for obj in qs:
            results.append({
                "type": "account_note",
                "type_label": "Account Note",
                "id": obj.id,
                "title": obj.content[:80],
                "detail": obj.content[:200],
                "account": obj.account.company_name if obj.account else "",
                "meta": obj.created_at.strftime("%b %d %Y") if obj.created_at else "",
                "url": f"/accounts/{obj.account_id}" if obj.account_id else "/accounts",
                "accent": "#8b5cf6",
            })
    except Exception:
        logger.exception("search: account_notes section failed")

    # ── Account Artifacts ─────────────────────────────────────────────────────
    try:
        from accounts.models import AccountArtifact
        qs = AccountArtifact.objects.filter(
            _icontains_q(["name", "url", "mime_type"], term)
        ).select_related("account")
        if _allowed_account_ids is not None:
            qs = qs.filter(account_id__in=_allowed_account_ids)
        qs = qs[:10]
        for obj in qs:
            results.append({
                "type": "artifact",
                "type_label": "Artifact",
                "id": obj.id,
                "title": obj.name,
                "detail": obj.url or "",
                "account": obj.account.company_name if obj.account else "",
                "meta": obj.artifact_type,
                "url": f"/accounts/{obj.account_id}" if obj.account_id else "/accounts",
                "accent": "#ec4899",
            })
    except Exception:
        logger.exception("search: artifacts section failed")

    # ── Django Accounts ────────────────────────────────────────────────────────
    try:
        from accounts.models import Account
        qs = Account.objects.filter(
            _icontains_q(["company_name", "website", "industry", "status", "airtable_id"], term)
        )
        if _allowed_account_ids is not None:
            qs = qs.filter(id__in=_allowed_account_ids)
        qs = qs[:10]
        for obj in qs:
            results.append({
                "type": "account",
                "type_label": "Account",
                "id": obj.id,
                "title": obj.company_name,
                "detail": obj.website or obj.industry or "",
                "account": obj.company_name,
                "meta": obj.status,
                "url": f"/accounts/{obj.id}",
                "accent": "#10b981",
            })
    except Exception:
        logger.exception("search: accounts section failed")

    # ── Tasks ──────────────────────────────────────────────────────────────────
    try:
        from scheduler.models import Task
        qs = Task.objects.filter(
            Q(assigned_to=user) | Q(created_by=user)
        ).filter(
            _icontains_q(["title", "description", "status", "priority", "tags"], term)
        )[:10]
        for obj in qs:
            results.append({
                "type": "task",
                "type_label": "Task",
                "id": obj.id,
                "title": obj.title,
                "detail": obj.description[:120] if obj.description else "",
                "account": "",
                "meta": f"{obj.status} · {obj.priority}",
                "url": "/action-items",
                "accent": "#6366f1",
            })
    except Exception:
        logger.exception("search: tasks section failed")

    # ── Skills ────────────────────────────────────────────────────────────────
    try:
        from skills.models import ClaudeSkill
        qs = ClaudeSkill.objects.filter(
            _icontains_q(["name", "description", "command"], term)
        )
        if not is_staff:
            qs = qs.filter(submitted_by=user)
        qs = qs[:5]
        for obj in qs:
            results.append({
                "type": "skill",
                "type_label": "Claude Skill",
                "id": obj.id,
                "title": obj.name,
                "detail": obj.description[:120] if obj.description else "",
                "account": "",
                "meta": obj.command or "",
                "url": "/skills",
                "accent": "#f97316",
            })
    except Exception:
        logger.exception("search: skills section failed")

    # ── Comments ──────────────────────────────────────────────────────────────
    try:
        from comments.models import Comment
        qs = Comment.objects.filter(
            author=user,
            parent__isnull=True,
        ).filter(
            _icontains_q(["content", "resource_label"], term)
        ).select_related("author")[:15]
        for obj in qs:
            results.append({
                "type": "comment",
                "type_label": "Comment",
                "id": obj.id,
                "title": obj.content[:80],
                "detail": obj.content[:200],
                "account": obj.resource_label or "",
                "meta": obj.resource_type,
                "url": f"/accounts/{obj.resource_id}" if obj.resource_type == "account" else f"/{obj.resource_type}s",
                "accent": "#64748b",
            })
    except Exception:
        logger.exception("search: comments section failed")

    # Sort: page_context type first, then by rough relevance score
    TYPE_ORDER = {
        "action_items": ["action_item", "task"],
        "calendar": ["calendar_event", "meeting"],
        "accounts": ["account", "airtable_account", "account_note", "artifact"],
        "reminders": ["reminder"],
        "skills": ["skill"],
    }
    priority_types = TYPE_ORDER.get(page_context, [])

    def sort_key(r: dict) -> tuple:
        in_context = 0 if r["type"] in priority_types else 1
        score = -_score(r["title"], term)
        return (in_context, score)

    results.sort(key=sort_key)

    return Response({"results": results[:80]})
