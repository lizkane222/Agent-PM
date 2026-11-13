"""
Who a reminder may notify besides its creator.

A reminder is always the creator's. By default only the creator is notified. A creator may
also notify teammates, subject to every rule below. They live here, once, so the serializer,
the lookup endpoint and delivery cannot disagree about them.

1. Only for a reminder linked to an **account**, and only people on that account's team who
   have an app login. The creator must be on the account themself.
2. Never someone who has switched off `UserProfile.allow_reminders_from_others`. They are
   still *listed* (so the creator can see why), marked unavailable with a reason.
3. **Explicit approval.** Adding anyone to a reminder needs `confirm_notify_others: true` in
   the request. The Settings/calendar UI sets it only after the user answers "are you sure you
   want to notify these users?". It is a server-side rule on purpose: the agent tools never
   offer a recipients argument (their schema rejects unknown keys), and an API caller that
   omits the flag is refused, so no surface can notify another person without a yes.
4. Preference is re-checked at delivery time (`deliverable_recipients`): someone who opts out
   after being added stops receiving it.

Nothing here sends anything; delivery is in `scheduler/tasks.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.contrib.auth.models import User
from django.db.models import Q

OPTED_OUT_REASON = "has turned off being notified by other users in their Settings."


NO_LOGIN_REASON = "hasn't signed in to AgentPM yet, so there is no way to notify them in the app."


@dataclass(frozen=True)
class Candidate:
    #: None for a team member who has never signed in: they are on the account but have no
    #: login, no notification preferences and no way to be reached in the app, so they are
    #: listed (the user can see they exist) but cannot be chosen.
    user_id: int | None
    name: str
    available: bool
    reason: str = ""
    #: What puts them on the list: a linked account, "Your colleagues" or "Your manager".
    via: tuple = ()
    member_id: int | None = None

    @property
    def key(self):
        return ("u", self.user_id) if self.user_id is not None else ("m", self.member_id)

    def as_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "member_id": self.member_id,
            "name": self.name,
            "available": self.available,
            "reason": self.reason,
            "accounts": list(self.via),
        }


def allows_others(user: User) -> bool:
    """True unless the person has opted out. A user with no profile row has not opted out."""
    profile = getattr(user, "profile", None)
    return True if profile is None else bool(profile.allow_reminders_from_others)


def display_name(user: User) -> str:
    """The name people know them by: profile display name, then team-member name, then login."""
    profile = getattr(user, "profile", None)
    member = getattr(user, "team_member", None)
    return (
        (getattr(profile, "display_name", "") or "")
        or (getattr(member, "full_name", "") or "")
        or user.get_full_name()
        or user.username
    )


def get_account(account_id):
    from accounts.models import Account

    try:
        return Account.objects.filter(pk=int(account_id)).first()
    except (TypeError, ValueError):
        return None


def candidates(account, requester: User) -> list[Candidate]:
    """Everyone on the account's team except the requester, with whether they can be notified.

    People with an AgentPM login are available unless they opted out. People without one — most
    of a team, typically, since the team comes from Airtable — are listed as unavailable with
    the reason, rather than silently dropped: leaving them out made a full account look empty.
    """
    out: list[Candidate] = []
    seen: set = set()
    members = account.team_members.select_related("user", "user__profile").exclude(status="inactive")
    for member in members:
        user = member.user
        name = member.full_name or (display_name(user) if user else member.email)
        if user is not None and user.pk == requester.pk:
            continue
        if user is not None and not user.is_active:
            continue
        key = ("u", user.pk) if user is not None else ("m", member.pk)
        if key in seen:
            continue
        seen.add(key)
        if user is None:
            out.append(Candidate(None, name, False, f"{name} {NO_LOGIN_REASON}", (account.company_name,), member.pk))
            continue
        ok = allows_others(user)
        out.append(Candidate(
            user.pk, name, ok, "" if ok else f"{name} {OPTED_OUT_REASON}", (account.company_name,), member.pk,
        ))
    out.sort(key=lambda c: c.name.lower())
    return out


def candidates_for(accounts, requester: User) -> list[Candidate]:
    """People on any of these accounts, once each, noting every account that puts them here."""
    merged: dict = {}
    _merge(merged, [c for account in accounts for c in candidates(account, requester)])
    return sorted(merged.values(), key=lambda c: c.name.lower())


MANAGER_LABEL = "Your manager"
COLLEAGUES_LABEL = "Your colleagues"


def _candidate(user: User, name: str, via: str) -> Candidate:
    ok = allows_others(user)
    member = getattr(user, "team_member", None)
    return Candidate(user.pk, name, ok, "" if ok else f"{name} {OPTED_OUT_REASON}", (via,), getattr(member, "pk", None))


def manager_candidate(requester: User) -> Candidate | None:
    """The requester's manager, whether or not they share an account. Not tied to any link.

    A manager is often on none of the accounts a person works, which is exactly why they are
    offered separately: it must work for a reminder with no links at all. One who has never
    signed in is listed but cannot be chosen, like anyone else without a login.
    """
    member = getattr(requester, "team_member", None)
    manager = getattr(member, "manager", None) if member else None
    if manager is None or manager.status == "inactive":
        return None
    user = manager.user
    if user is None:
        return Candidate(None, manager.full_name, False, f"{manager.full_name} {NO_LOGIN_REASON}", (MANAGER_LABEL,), manager.pk)
    if not user.is_active or user.pk == requester.pk:
        return None
    return _candidate(user, manager.full_name or display_name(user), MANAGER_LABEL)


def colleague_candidates(requester: User) -> list[Candidate]:
    """People the requester already works with: anyone on an account with them, or on a Team
    with them. The same circle the agent may text or call (`_allowed_phone_numbers`), so
    reminders do not invent a wider one.

    Only offered for a reminder about something in the Admin workspace — which cannot be shared,
    so has no account team to draw on. Per-user Admin accounts themselves are not "shared".
    """
    from accounts.models import Account

    mine = Account.objects.filter(Q(team_members__user=requester) | Q(admin_owner=requester)).filter(is_admin_account=False)
    users = (
        User.objects.filter(is_active=True)
        .filter(
            Q(team_member__member_accounts__in=mine)
            | Q(memberships__team__memberships__user=requester)
        )
        .exclude(pk=requester.pk)
        .select_related("profile", "team_member")
        .distinct()
    )
    out = []
    for user in users:
        member = getattr(user, "team_member", None)
        out.append(_candidate(user, (member.full_name if member else "") or display_name(user), COLLEAGUES_LABEL))
    return sorted(out, key=lambda c: c.name.lower())


def _merge(into: dict, cands) -> None:
    for cand in cands:
        have = into.get(cand.key)
        into[cand.key] = cand if have is None else Candidate(
            have.user_id, have.name, have.available, have.reason,
            have.via + tuple(v for v in cand.via if v not in have.via), have.member_id,
        )


def pool(requester: User, links: list[dict]):
    """Everyone this reminder could notify, and where each source comes from.

    * the team of every account the links lead to that the requester is on;
    * the requester's manager — always, whether or not they share an account;
    * the requester's colleagues — only when a link is into the private Admin workspace.

    Returns `(candidates, sources)`; `sources` names what contributed, in order, for the picker.
    """
    from . import reminder_links

    accounts = reminder_links.reachable_accounts(links, requester)
    merged: dict = {}
    sources: list[str] = []
    _merge(merged, candidates_for(accounts, requester))
    sources += [a.company_name for a in accounts if not a.is_admin_account]
    if reminder_links.has_private_admin_link(links):
        _merge(merged, colleague_candidates(requester))
        sources.append(COLLEAGUES_LABEL)
    manager = manager_candidate(requester)
    if manager is not None:
        _merge(merged, [manager])
        sources.append(MANAGER_LABEL)
    return sorted(merged.values(), key=lambda c: c.name.lower()), sources


def channels_for(user: User) -> dict:
    """How this person wants reminders delivered: their own Settings → Reminder notification
    defaults. Never the creator's choice for them.

    If their defaults are all off the reminder would reach them by nothing at all, so they get
    it in-app: someone was asked "are you sure you want to notify them?" and said yes, and a
    silent no-op is worse than the lowest-key channel.
    """
    profile = getattr(user, "profile", None)
    if profile is None:
        return {"notify_in_app": True, "notify_slack": False, "notify_push": False, "notify_sms": False}
    flags = {
        "notify_in_app": profile.notify_default_in_app,
        "notify_slack": profile.notify_default_slack,
        "notify_push": profile.notify_default_push,
        "notify_sms": profile.notify_default_sms,
    }
    return flags if any(flags.values()) else {**flags, "notify_in_app": True}


def channels_from_request(user: User, data) -> dict:
    """Notification channels for a new reminder: what the caller asked for, else the user's own
    Settings → Reminder notification defaults.

    Every way of creating a reminder (the Reminders page, the calendar sidebar, a note, a
    meeting, an action item, the agent) goes through this when it doesn't spell the channels out,
    so none of them quietly falls back to in-app only while the user has Laptop or Phone on.
    A channel the caller names — true *or* false — is respected as given.
    """
    flags = channels_for(user)
    for name in flags:
        if name in data:
            flags[name] = bool(data[name])
    return flags


def deliverable_recipients(reminder) -> list[User]:
    """The recipients to notify right now: opted-in, active, and not the creator."""
    return [
        u for u in reminder.recipients.select_related("profile").all()
        if u.pk != reminder.created_by_id and u.is_active and allows_others(u)
    ]
