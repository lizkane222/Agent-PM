"""GET /accounts/accounts/<id>/timeline/?scope=mine|team"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Account
from airtable_sync.meeting_stubs import get_or_create_meeting_for_event
from airtable_sync.models import AirtableAccount, CalendarEventAccountLink
from scheduler.models import CalendarEvent
from team.models import TeamMember

User = get_user_model()


def _user(name):
    u = User.objects.create_user(username=name, email=f"{name}@example.com", password="x")
    tm, _ = TeamMember.objects.get_or_create(user=u, defaults={"full_name": name, "email": u.email})
    return u, tm


class AccountTimelineTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.a, tma = _user("usera")
        self.b, tmb = _user("userb")
        self.outsider, _ = _user("outsider")
        self.at = AirtableAccount.objects.create(airtable_id="recACME", name="Acme")
        self.acct = Account.objects.create(company_name="Acme", airtable_id="recACME")
        self.acct.team_members.add(tma, tmb)
        self.start = timezone.now() + timedelta(days=1)
        self.url = f"/api/v1/accounts/accounts/{self.acct.pk}/timeline/"

    def _event(self, owner, gid="g1", title="Sync", **kw):
        return CalendarEvent.objects.create(
            owner=owner, google_event_id=gid, title=title,
            start_datetime=self.start, end_datetime=self.start + timedelta(hours=1), **kw,
        )

    def _link(self, gid="g1", account=True):
        CalendarEventAccountLink.objects.get_or_create(
            calendar_event_uid=gid, defaults={"account": self.at if account else None}
        )

    def test_unauthenticated_is_401(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_non_member_is_404(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_bad_scope_is_400(self):
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.get(self.url, {"scope": "all"}).status_code, 400)

    def test_mine_excludes_teammates_events_team_includes_them(self):
        self._link("g1")
        self._link("g2")
        self._event(self.a, "g1", "Mine")
        self._event(self.b, "g2", "Theirs")
        self.client.force_authenticate(self.a)
        mine = self.client.get(self.url, {"scope": "mine"}).json()
        self.assertEqual([e["title"] for e in mine["events"]], ["Mine"])
        team = self.client.get(self.url, {"scope": "team"}).json()
        self.assertEqual(sorted(e["title"] for e in team["events"]), ["Mine", "Theirs"])

    def test_team_dedupes_same_google_event_across_attendees(self):
        self._link("g1")
        self._event(self.a, "g1")
        self._event(self.b, "g1")
        self.client.force_authenticate(self.a)
        events = self.client.get(self.url, {"scope": "team"}).json()["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["owner"], self.a.pk)  # requester's own copy wins

    def test_dedupes_by_title_and_start_without_google_id(self):
        a = self._event(self.a, "", "Standup", account=self.acct)
        self._event(self.b, "", "standup ", account=self.acct)
        self.client.force_authenticate(self.a)
        events = self.client.get(self.url, {"scope": "team"}).json()["events"]
        self.assertEqual([e["id"] for e in events], [a.pk])

    def test_teammates_private_fields_are_hidden_own_are_kept(self):
        self._link("g1")
        self._link("g2")
        self._event(self.a, "g1", "Mine", description="my d", meet_link="https://meet/a", location="Room")
        self._event(self.b, "g2", "Theirs", description="secret", meet_link="https://meet/b", location="Home")
        self.client.force_authenticate(self.a)
        by = {e["title"]: e for e in self.client.get(self.url, {"scope": "team"}).json()["events"]}
        self.assertEqual(by["Mine"]["description"], "my d")
        self.assertEqual(by["Theirs"]["description"], "")
        self.assertEqual(by["Theirs"]["meet_link"], "")
        self.assertEqual(by["Theirs"]["location"], "")

    def test_userb_sees_notes_imported_by_usera_with_importer_shape(self):
        """The importer files the stub under the event's resolved account, which is often
        none. The meeting must still reach the timeline, for userB too."""
        self._link("g1")  # account match cache only; no CalendarEvent.account FK (real data)
        ev_a = self._event(self.a, "g1")
        self._event(self.b, "g1")
        meeting = get_or_create_meeting_for_event(ev_a)
        # 104 of the 109 meetings with notes in the dev DB are filed under no account or a
        # different one (Airtable-synced `rec*` rows, or stubs whose account never resolved).
        meeting.account = None
        meeting.save(update_fields=["account"])
        meeting.gong_notes = "Recap:\n- decided things"
        meeting.save()

        self.client.force_authenticate(self.b)
        for scope in ("mine", "team"):
            data = self.client.get(self.url, {"scope": scope}).json()
            self.assertEqual(len(data["events"]), 1, scope)
            ev = data["events"][0]
            self.assertEqual(ev["owner"], self.b.pk)  # userB's own row ...
            self.assertEqual(ev["agentpm_airtable_id"], meeting.airtable_id)  # ... borrows the link
            self.assertIn(meeting.airtable_id, [m["airtable_id"] for m in data["meetings"]])
            self.assertIn("decided things", next(m for m in data["meetings"] if m["airtable_id"] == meeting.airtable_id)["gong_notes"])

    def test_events_of_non_members_are_not_returned(self):
        self._link("g9")
        self._event(self.outsider, "g9", "Outsider")
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.get(self.url, {"scope": "team"}).json()["events"], [])
