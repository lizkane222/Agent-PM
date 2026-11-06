"""Which account-page project a record (action item / meeting) is filed under.

`AccountProject.action_ids` / `meeting_ids` hold the Airtable record ids of what the user has
dragged onto a project or goal. A *goal* is an `AccountProject` row with `kind="goal"`; its
parent project is the project whose `goal_ids` lists it. Used so a calendar block inherits the
project of the item it schedules.
"""
from django.db.models import Q

from core.mixins import _staff_sees_all

from .models import AccountProject


def visible_projects(user):
    qs = AccountProject.objects.all()
    if _staff_sees_all(user):
        return qs
    return qs.filter(Q(account__team_members__user=user) | Q(account__admin_owner=user)).distinct()


def project_for_record(user, record_id):
    """The project `record_id` belongs to, or None.

    A record filed directly under a project resolves to it; one filed under a goal resolves to
    that goal's parent project. A goal with no parent project resolves to None. Only projects the
    user can already see are considered, so a calendar block can never be tagged with someone
    else's project.
    """
    if not record_id or not isinstance(record_id, str):
        return None
    candidates = list(visible_projects(user))
    holder = next(
        (p for p in candidates if record_id in (p.action_ids or []) or record_id in (p.meeting_ids or [])),
        None,
    )
    if holder is None:
        return None
    if holder.kind != "goal":
        return holder
    gid = str(holder.pk)
    return next(
        (p for p in candidates if p.kind == "project" and gid in [str(x) for x in (p.goal_ids or [])]),
        None,
    )
