"""
Guest notifications through the real calendar endpoints.

The rule (product owner): an invitation email goes out only at the moment an event is created
or updated *in AgentPM* and the user approves the send — once. Never for events that came
from Google. Never as a side effect of a sync, a move, or an API default.

The incident: a customer received 2,000+ invitations after one meeting was moved.
"""

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from integrations.models import GoogleWriteLog
from scheduler.models import CalendarEvent

User = get_user_model()
GUESTS = [{"email": f"g{i}@x.com"} for i in range(10)]
URL = "/api/v1/scheduler/events/"


class FakeGoogle:
    def __init__(self):
        self.calls = []

    def events(self):
        return self

    def __getattr__(self, verb):
        def call(**kw):
            self.calls.append((verb, kw))

            class R:
                def execute(self_inner, num_retries=0):
                    return {"id": "gid-1", "hangoutLink": ""}
            return R()
        return call

    @property
    def sent(self):
        return [kw.get("sendUpdates", "<<UNSET>>") for _, kw in self.calls]


@override_settings(GOOGLE_GUEST_NOTIFICATIONS=True, GOOGLE_INVITE_FRESHNESS_SECONDS=60,
                   GOOGLE_MAX_GUEST_EMAILS_PER_HOUR=50, GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT=25)
class CalendarEndpointNotificationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("owner", email="owner@x.com", password="x")
        self.client.force_authenticate(user=self.user)
        self.google = FakeGoogle()
        patcher = mock.patch("integrations.google_api.credentials_for", return_value=object())
        patcher.start(); self.addCleanup(patcher.stop)
        persist = mock.patch("integrations.google_api.persist_refreshed")
        persist.start(); self.addCleanup(persist.stop)
        build = mock.patch("googleapiclient.discovery.build", return_value=self.google)
        build.start(); self.addCleanup(build.stop)
        cred = mock.patch("integrations.models.OAuthCredential.objects")
        # _push_to_google looks the credential up directly; give it one.
        from integrations.models import OAuthCredential
        OAuthCredential.objects.create(user=self.user, provider="google", access_token="a",
                                       refresh_token="r", scopes="x", is_active=True)

    def _payload(self, **kw):
        start = timezone.now() + timedelta(days=2)
        return {"title": "Review", "start_datetime": start.isoformat(),
                "end_datetime": (start + timedelta(hours=1)).isoformat(), "attendees": GUESTS,
                "calendar_id": "primary", **kw}

    # --- create ------------------------------------------------------------------------------------

    def test_create_with_guests_and_NO_send_invites_flag_emails_nobody(self):
        # The old default was "absent means yes": an API caller adding guests emailed them.
        r = self.client.post(URL, self._payload(), format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertNotIn("all", self.google.sent)
        self.assertFalse(CalendarEvent.objects.get(pk=r.data["id"]).invite_sent)

    def test_create_with_explicit_approval_emails_once_and_records_it(self):
        r = self.client.post(URL, self._payload(send_invites=True), format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.google.sent, ["all"])
        ev = CalendarEvent.objects.get(pk=r.data["id"])
        self.assertTrue(ev.invite_sent)
        self.assertIsNotNone(ev.invite_sent_at)
        self.assertEqual(ev.origin, "agentpm")

    def test_create_with_send_invites_false_emails_nobody(self):
        self.client.post(URL, self._payload(send_invites=False), format="json")
        self.assertNotIn("all", self.google.sent)

    def test_an_event_created_in_agentpm_is_marked_as_agentpm_origin(self):
        r = self.client.post(URL, self._payload(), format="json")
        self.assertEqual(CalendarEvent.objects.get(pk=r.data["id"]).origin, "agentpm")

    @override_settings(GOOGLE_GUEST_NOTIFICATIONS=False)
    def test_the_global_switch_off_blocks_even_an_approved_create(self):
        self.client.post(URL, self._payload(send_invites=True), format="json")
        self.assertNotIn("all", self.google.sent)

    # --- update / move -------------------------------------------------------------------------------

    def _make_synced(self, **kw):
        defaults = dict(owner=self.user, title="Weekly", google_event_id="gid-1", is_synced=True, origin="agentpm",
                        start_datetime=timezone.now() + timedelta(days=3),
                        end_datetime=timezone.now() + timedelta(days=3, hours=1), attendees=GUESTS)
        defaults.update(kw)
        return CalendarEvent.objects.create(**defaults)

    def test_moving_a_meeting_never_emails_the_guests(self):
        # The incident. Moving is an edit; the old code sent sendUpdates="all" on every edit.
        ev = self._make_synced()
        new_start = (timezone.now() + timedelta(days=4)).isoformat()
        r = self.client.patch(f"{URL}{ev.pk}/", {"start_datetime": new_start}, format="json")
        self.assertIn(r.status_code, (200, 202), r.data)
        self.assertNotIn("all", self.google.sent)

    def test_moving_a_meeting_a_hundred_times_emails_nobody(self):
        ev = self._make_synced()
        for i in range(100):
            new_start = (timezone.now() + timedelta(days=4, minutes=i)).isoformat()
            self.client.patch(f"{URL}{ev.pk}/", {"start_datetime": new_start}, format="json")
        self.assertEqual(self.google.sent.count("all"), 0)
        self.assertGreater(len(self.google.sent), 0, "edits should still reach Google, just silently")

    def test_an_event_that_came_from_google_is_never_emailed_when_edited(self):
        ev = self._make_synced(origin="google")
        self.client.patch(f"{URL}{ev.pk}/", {"title": "Renamed"}, format="json")
        self.assertNotIn("all", self.google.sent)

    def test_edits_still_reach_google_silently(self):
        ev = self._make_synced()
        self.client.patch(f"{URL}{ev.pk}/", {"title": "Renamed"}, format="json")
        self.assertEqual(self.google.sent, ["none"])

    # --- delete --------------------------------------------------------------------------------------

    def test_deleting_an_event_does_not_email_cancellations(self):
        ev = self._make_synced()
        self.client.delete(f"{URL}{ev.pk}/")
        self.assertEqual([v for v, _ in self.google.calls], ["delete"])
        self.assertEqual(self.google.sent, ["none"])

    # --- audit -----------------------------------------------------------------------------------------

    def test_every_google_write_from_the_endpoints_is_audited(self):
        r = self.client.post(URL, self._payload(send_invites=True), format="json")
        ev = CalendarEvent.objects.get(pk=r.data["id"])
        self.client.patch(f"{URL}{ev.pk}/", {"title": "Renamed"}, format="json")
        rows = list(GoogleWriteLog.objects.order_by("id"))
        self.assertEqual([x.send_updates for x in rows], ["all", "none"])
        self.assertEqual(rows[0].guest_count, 10)
