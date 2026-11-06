"""Per-account Activity Log: seven categories gathered from the rest of the app.

The caller has already been shown the account (the view goes through
`AccountViewSet.get_object()`), so account-shared records are readable by them. Anything
that belongs to one person (notifications, reminders, feedback, agent token usage, calendar
events) is filtered to the caller unconditionally, staff included.
"""
from django.db.models import Q, Sum

CATEGORIES = ["activity", "events", "comments", "notifications", "reminders", "feedback", "tokens"]
PER_CATEGORY_LIMIT = 100


def _ts(dt):
    return dt.isoformat() if dt else None


def _row(category, rid, when, title, body="", link="", actor="", status=""):
    return {
        "id": f"{category}-{rid}", "category": category, "ts": _ts(when), "title": title,
        "body": body, "link": link, "actor": actor, "status": status,
    }


def _activity(account, user):
    from comments.serializers import _user_display_name
    from realtime.models import AgentActivityEvent

    qs = (
        AgentActivityEvent.objects
        .filter(metadata__resource__type="account", metadata__resource__id=account.pk)
        .select_related("user", "user__profile").order_by("-created_at")[:PER_CATEGORY_LIMIT]
    )
    return [_row("activity", e.pk, e.created_at, e.title, e.detail or "", f"/accounts/{account.pk}",
                 _user_display_name(e.user) if e.user_id else "") for e in qs]


def _events(account, user):
    from scheduler.models import CalendarEvent

    qs = CalendarEvent.objects.filter(owner=user, account=account).order_by("-start_datetime")[:PER_CATEGORY_LIMIT]
    return [_row("events", e.pk, e.start_datetime, e.title, status=e.status, link="/calendar") for e in qs]


def _comments(account, user):
    from airtable_sync.models import AirtableActionItem
    from comments.models import Comment
    from comments.serializers import _user_display_name
    from accounts.models import AccountArtifact, AccountNote
    from scheduler.models import CalendarEvent

    note_ids = list(AccountNote.objects.filter(account=account).values_list("pk", flat=True))
    art_ids = list(AccountArtifact.objects.filter(account=account).values_list("pk", flat=True))
    ev_ids = list(CalendarEvent.objects.filter(owner=user, account=account).values_list("pk", flat=True))
    ai_ids = []
    if account.airtable_id:
        ai_ids = list(AirtableActionItem.objects.filter(account__airtable_id=account.airtable_id)
                      .values_list("pk", flat=True))
    q = (
        Q(resource_type="account", resource_id=account.pk)
        | Q(resource_type="account_note", resource_id__in=note_ids)
        | Q(resource_type="artifact", resource_id__in=art_ids)
        | Q(resource_type="calendar_event", resource_id__in=ev_ids)
        | Q(resource_type="action_item", resource_id__in=ai_ids)
    )
    qs = (Comment.objects.filter(q).select_related("author", "author__profile")
          .order_by("-created_at")[:PER_CATEGORY_LIMIT])
    return [_row("comments", c.pk, c.created_at,
                 f"Comment on {c.resource_label or c.get_resource_type_display()}",
                 c.content[:300], f"/accounts/{account.pk}",
                 _user_display_name(c.author) if c.author_id else "") for c in qs]


def _notifications(account, user):
    from team.models import Notification

    qs = Notification.objects.filter(user=user, account=account).order_by("-created_at")[:PER_CATEGORY_LIMIT]
    return [_row("notifications", n.pk, n.created_at, n.title, n.body[:300], n.link,
                 status=f"{n.channel}:{n.status}") for n in qs]


def _reminders(account, user):
    from scheduler.models import CalendarEvent, Reminder

    ev_ids = list(CalendarEvent.objects.filter(owner=user, account=account).values_list("pk", flat=True))
    q = Q(resource_type="account", resource_id=account.pk) | Q(resource_type="calendar_event", resource_id__in=ev_ids)
    qs = Reminder.objects.filter(created_by=user).filter(q).order_by("-due_at")[:PER_CATEGORY_LIMIT]
    return [_row("reminders", r.pk, r.due_at, r.title, r.body[:300], "/reminders", status=r.status) for r in qs]


def _feedback(account, user):
    from feedback.models import Feedback

    pat = rf"/accounts/{account.pk}(?![0-9])"
    qs = Feedback.objects.filter(author=user, page_url__regex=pat).order_by("-created_at")[:PER_CATEGORY_LIMIT]
    return [_row("feedback", f.pk, f.created_at, f.description[:120], f.description[:300], "/feedback",
                 status=f.status) for f in qs]


def _tokens(account, user):
    """Agent chats of the caller that name this account (no account FK exists on sessions)."""
    from agents.models import AgentSession

    name = (account.company_name or "").strip()
    if len(name) < 3:
        return []
    sessions = (
        AgentSession.objects.filter(user=user)
        .filter(Q(title__icontains=name) | Q(messages__role="user", messages__content__icontains=name))
        .distinct().order_by("-started_at")[:PER_CATEGORY_LIMIT]
    )
    rows = []
    for s in sessions:
        agg = s.messages.aggregate(i=Sum("input_tokens"), o=Sum("output_tokens"))
        i, o = agg["i"] or 0, agg["o"] or 0
        rows.append(_row("tokens", s.pk, s.started_at, s.title or f"Agent session {s.pk}",
                         f"{i:,} input / {o:,} output tokens", "/agent", status=str(i + o)))
    return rows


_BUILDERS = {
    "activity": _activity, "events": _events, "comments": _comments, "notifications": _notifications,
    "reminders": _reminders, "feedback": _feedback, "tokens": _tokens,
}


def build_account_activity(account, user, category=None):
    """{counts, results}. `counts` always covers every category; `results` honours `category`."""
    per = {c: _BUILDERS[c](account, user) for c in CATEGORIES}
    chosen = [category] if category in per else CATEGORIES
    rows = sorted((r for c in chosen for r in per[c]), key=lambda r: r["ts"] or "", reverse=True)
    return {"counts": {c: len(per[c]) for c in CATEGORIES}, "results": rows}
