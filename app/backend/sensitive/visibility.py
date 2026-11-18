"""Who may see (and therefore mark) a record.

Reuses ``comments.views._user_can_see_resource`` for every type comments already know,
then adds the types comments never covered. Unknown type, unknown id and "not yours" all
answer False so the views can return one identical 404.
"""

from django.db.models import Q

from comments.views import _user_can_see_resource as _comments_can_see
from core.mixins import is_admin

_DELEGATED = {
    "account", "airtable_account", "action_item", "meeting", "calendar_event",
    "reminder", "task", "account_note", "artifact", "claude_skill", "account_ticket",
}
_OPEN = {"applet", "public_item", "team_member"}  # shared directories, any signed-in user
RESOURCE_TYPES = _DELEGATED | _OPEN | {
    "action_item_step", "meeting_note", "customer_contact", "contact_note",
    "project", "goal", "comment", "artifact_note",
}


def _on_account(user, account_qs_filter: dict, model) -> bool:
    return (
        model.objects.filter(**account_qs_filter).filter(
            Q(account__team_members__user=user) | Q(account__admin_owner=user)
        ).exists()
    )


def can_see(user, resource_type: str, resource_id) -> bool:
    if resource_type not in RESOURCE_TYPES or resource_id in (None, ""):
        return False
    rid_s = str(resource_id)
    if resource_type in _OPEN:
        return rid_s.isdigit() and _exists_open(resource_type, int(rid_s))
    try:
        rid = int(rid_s)
    except ValueError:
        return False
    admin = is_admin(user)
    try:
        if resource_type in _DELEGATED:
            return _comments_can_see(user, resource_type, rid)
        if resource_type == "action_item_step":
            from airtable_sync.models import ActionItemStep
            s = ActionItemStep.objects.filter(pk=rid).first()
            return bool(s) and _comments_can_see(user, "action_item", s.action_item_id)
        if resource_type == "meeting_note":
            from scheduler.models import MeetingNote
            return admin and MeetingNote.objects.filter(pk=rid).exists() or MeetingNote.objects.filter(
                pk=rid).filter(Q(event__owner=user) | Q(author=user)).exists()
        if resource_type in ("customer_contact", "contact_note", "project", "goal"):
            from accounts.models import AccountProject, CustomerContact, CustomerContactNote
            if resource_type == "customer_contact":
                m, f = CustomerContact, {"pk": rid}
            elif resource_type == "contact_note":
                m, f = CustomerContactNote, {"pk": rid}
                return admin and m.objects.filter(pk=rid).exists() or m.objects.filter(pk=rid).filter(
                    Q(contact__account__team_members__user=user) | Q(contact__account__admin_owner=user)
                ).exists()
            else:
                m, f = AccountProject, {"pk": rid, "kind": resource_type}
            return admin and m.objects.filter(**f).exists() or _on_account(user, f, m)
        if resource_type == "artifact_note":
            from accounts.models import ArtifactNote
            n = ArtifactNote.objects.filter(pk=rid).first()
            return bool(n) and _comments_can_see(user, "artifact", n.artifact_id)
        if resource_type == "comment":
            from comments.models import Comment
            c = Comment.objects.filter(pk=rid).first()
            return bool(c) and _comments_can_see(user, c.resource_type, c.resource_id)
    except Exception:
        return False
    return False


def _exists_open(resource_type: str, rid: int) -> bool:
    if resource_type == "applet":
        from discover.models import Applet
        return Applet.objects.filter(pk=rid).exists()
    if resource_type == "public_item":
        from team.models import PublicItem
        return PublicItem.objects.filter(pk=rid).exists()
    from team.models import TeamMember
    return TeamMember.objects.filter(pk=rid).exists()


def label_for(resource_type: str, resource_id) -> str:
    """A short record label for the activity log. Never includes hidden text."""
    return f"{resource_type.replace('_', ' ')} #{resource_id}"
