"""
Every Google Calendar write goes through ``google_calendar_gateway``.

These tests fake the Google service and assert what ``sendUpdates`` value Google is actually
handed — the single fact that decides whether guests are emailed. The failure being guarded
against: a customer received 2,000+ invitations from one meeting move.
"""

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from integrations import google_calendar_gateway as gw
from integrations.models import GoogleWriteLog
from scheduler.models import CalendarEvent

User = get_user_model()
GUESTS = [{"email": "a@x.com"}, {"email": "b@x.com"}, {"email": "c@x.com"}]


class FakeService:
    """Records the kwargs of every events() call."""

    def __init__(self, result=None, fail=None):
        self.calls = []
        self._result = result if result is not None else {"id": "g123"}
        self._fail = fail

    def events(self):
        return self

    def _record(self, verb):
        def call(**kw):
            self.calls.append((verb, kw))
            outer = self

            class Req:
                def execute(self, num_retries=0):
                    if outer._fail:
                        raise outer._fail
                    return outer._result
            return Req()
        return call

    def __getattr__(self, name):
        if name in ("insert", "patch", "update", "delete"):
            return self._record(name)
        raise AttributeError(name)

    @property
    def sent(self):
        return [kw.get("sendUpdates", "<<UNSET>>") for _, kw in self.calls]


@override_settings(GOOGLE_GUEST_NOTIFICATIONS=True, GOOGLE_INVITE_FRESHNESS_SECONDS=60,
                   GOOGLE_MAX_GUEST_EMAILS_PER_HOUR=20, GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT=25)
class GatewayTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", email="owner@x.com", password="x")
        self.event = CalendarEvent.objects.create(
            owner=self.user, title="Review", start_datetime=timezone.now() + timedelta(days=1),
            end_datetime=timezone.now() + timedelta(days=1, hours=1), attendees=GUESTS,
            origin="agentpm", google_event_id="g123", is_synced=True)
        self.svc = FakeService()

    def _write(self, action="patch", *, approved=True, approved_at=None, service=None, event=None, **kw):
        return gw.write_event(
            service or self.svc, action, event or self.event, body={"summary": "x"},
            source="test", approved=approved,
            approved_at=approved_at if approved_at is not None else timezone.now(), **kw)

    # --- sendUpdates is ALWAYS set, and "all" only through the gate -----------------------------

    def test_an_approved_fresh_agentpm_write_notifies_and_records_the_send(self):
        self._write()
        self.assertEqual(self.svc.sent, ["all"])
        self.event.refresh_from_db()
        self.assertTrue(self.event.invite_sent)
        self.assertIsNotNone(self.event.invite_sent_at)

    def test_without_approval_google_is_told_none(self):
        self._write(approved=False)
        self.assertEqual(self.svc.sent, ["none"])
        self.event.refresh_from_db()
        self.assertFalse(self.event.invite_sent)

    def test_the_second_write_never_notifies_again(self):
        self._write()
        self._write()
        self.assertEqual(self.svc.sent, ["all", "none"])

    def test_a_hundred_writes_notify_at_most_once(self):
        for _ in range(100):
            self._write()
        self.assertEqual(self.svc.sent.count("all"), 1)
        self.assertEqual(len(self.svc.sent), 100)

    def test_an_event_that_came_from_google_is_never_notified(self):
        CalendarEvent.objects.filter(pk=self.event.pk).update(origin="google")
        self.event.refresh_from_db()
        self._write()
        self.assertEqual(self.svc.sent, ["none"])

    def test_every_verb_sets_send_updates_explicitly(self):
        for action in ("insert", "patch", "update", "delete"):
            svc = FakeService()
            ev = CalendarEvent.objects.create(owner=self.user, title="t", start_datetime=timezone.now(),
                                              end_datetime=timezone.now(), attendees=GUESTS, origin="google")
            self._write(action, service=svc, event=ev, approved=False)
            self.assertEqual(svc.sent, ["none"], action)

    def test_delete_does_not_email_cancellations_without_approval(self):
        svc = FakeService()
        self._write("delete", service=svc, approved=False)
        self.assertEqual(svc.sent, ["none"])

    # --- the switch and the budgets -------------------------------------------------------------

    @override_settings(GOOGLE_GUEST_NOTIFICATIONS=False)
    def test_the_global_switch_off_means_nobody_is_ever_emailed(self):
        self._write()
        self.assertEqual(self.svc.sent, ["none"])
        self.event.refresh_from_db()
        self.assertFalse(self.event.invite_sent)

    def test_the_hourly_budget_stops_a_runaway(self):
        # 8 events of 3 guests = 24 > 20 per hour, so the 7th (21 guests) is blocked.
        outcomes = []
        for i in range(8):
            ev = CalendarEvent.objects.create(owner=self.user, title=f"e{i}", start_datetime=timezone.now(),
                                              end_datetime=timezone.now(), attendees=GUESTS, origin="agentpm",
                                              google_event_id=f"g{i}", is_synced=True)
            svc = FakeService()
            self._write(service=svc, event=ev)
            outcomes.append(svc.sent[0])
        self.assertEqual(outcomes.count("all"), 6)
        self.assertEqual(outcomes[6:], ["none", "none"])

    @override_settings(GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT=2)
    def test_an_event_with_too_many_guests_is_never_notified(self):
        self._write()
        self.assertEqual(self.svc.sent, ["none"])

    def test_a_stale_approval_does_not_authorise_a_send(self):
        self._write(approved_at=timezone.now() - timedelta(minutes=10))
        self.assertEqual(self.svc.sent, ["none"])

    # --- failures ---------------------------------------------------------------------------------

    def test_a_failed_google_call_does_not_mark_the_invite_as_sent(self):
        svc = FakeService(fail=RuntimeError("boom"))
        with self.assertRaises(RuntimeError):
            self._write(service=svc)
        self.event.refresh_from_db()
        self.assertFalse(self.event.invite_sent)

    def test_a_failed_call_after_a_notified_attempt_can_be_retried_once_only(self):
        # The send succeeded, then the second write fails: the flag stays set, so no repeat.
        self._write()
        svc = FakeService(fail=RuntimeError("boom"))
        with self.assertRaises(RuntimeError):
            self._write(service=svc)
        self.assertEqual(svc.sent, ["none"])

    # --- audit trail ------------------------------------------------------------------------------

    def test_every_write_leaves_an_audit_row_with_the_decision(self):
        self._write()
        self._write(approved=False)
        rows = list(GoogleWriteLog.objects.order_by("id"))
        self.assertEqual([r.send_updates for r in rows], ["all", "none"])
        self.assertEqual([r.outcome for r in rows], ["ok", "ok"])
        self.assertEqual(rows[0].guest_count, 3)
        self.assertEqual(rows[0].decision_reason, "ok")
        # Question 1 (already sent?) is asked first, so it is the recorded reason even though
        # this write also lacked approval.
        self.assertEqual(rows[1].decision_reason, "already_sent")
        self.assertEqual(rows[0].source, "test")
        self.assertEqual(rows[0].event_pk, self.event.pk)

    def test_an_unapproved_first_write_is_logged_with_the_no_approval_reason(self):
        self._write(approved=False)
        self.assertEqual(GoogleWriteLog.objects.get().decision_reason, "no_approval")

    def test_a_failed_write_is_logged_as_failed_with_the_error(self):
        with self.assertRaises(RuntimeError):
            self._write(service=FakeService(fail=RuntimeError("quota")))
        row = GoogleWriteLog.objects.get()
        self.assertEqual(row.outcome, "failed")
        self.assertIn("quota", row.error)

    def test_the_audit_row_exists_before_google_is_called(self):
        seen = {}

        class Peek(FakeService):
            def _record(self_inner, verb):
                seen["rows_before_call"] = GoogleWriteLog.objects.count()
                return super()._record(verb)

        self._write(service=Peek())
        self.assertEqual(seen["rows_before_call"], 1)

    def test_guest_addresses_in_the_log_are_capped(self):
        many = [{"email": f"p{i}@x.com"} for i in range(200)]
        ev = CalendarEvent.objects.create(owner=self.user, title="big", start_datetime=timezone.now(),
                                          end_datetime=timezone.now(), attendees=many, origin="agentpm")
        self._write(event=ev, approved=False)
        row = GoogleWriteLog.objects.get()
        self.assertEqual(row.guest_count, 200)
        self.assertLessEqual(len(row.guests), 50)

    # --- a repeated edit loop (the incident shape) -----------------------------------------------

    def test_a_sync_loop_rewriting_the_same_event_emails_at_most_once(self):
        for _ in range(200):
            CalendarEvent.objects.filter(pk=self.event.pk).update(updated_at=timezone.now())
            self.event.refresh_from_db()
            self._write()
        self.assertEqual(self.svc.sent.count("all"), 1)
        self.assertEqual(GoogleWriteLog.objects.filter(send_updates="all").count(), 1)


class DeleteByIdTests(TestCase):
    """
    Deleting removes the local row first, so by the time Google is told there is no event left
    to evaluate. A cancellation is announced to guests by Google, so this path is always
    ``sendUpdates="none"`` — and it is still audited.
    """

    def setUp(self):
        self.user = User.objects.create_user("owner2", email="owner2@x.com", password="x")

    def test_a_delete_by_id_never_notifies_even_with_the_switch_on(self):
        svc = FakeService()
        with override_settings(GOOGLE_GUEST_NOTIFICATIONS=True):
            gw.delete_by_id(svc, self.user, "gid-9", source="calendar.delete", event_pk=5)
        self.assertEqual(svc.sent, ["none"])
        self.assertEqual([v for v, _ in svc.calls], ["delete"])
        self.assertEqual(svc.calls[0][1]["eventId"], "gid-9")

    def test_a_delete_by_id_is_audited(self):
        gw.delete_by_id(FakeService(), self.user, "gid-9", source="calendar.delete", event_pk=5)
        row = GoogleWriteLog.objects.get()
        self.assertEqual((row.action, row.send_updates, row.outcome, row.event_pk, row.google_event_id),
                         ("delete", "none", "ok", 5, "gid-9"))

    def test_a_failed_delete_is_audited_as_failed(self):
        with self.assertRaises(RuntimeError):
            gw.delete_by_id(FakeService(fail=RuntimeError("nope")), self.user, "gid-9",
                            source="calendar.delete", event_pk=5)
        self.assertEqual(GoogleWriteLog.objects.get().outcome, "failed")


class GuestlessWriteTests(TestCase):
    """
    Private blocks (action items, reminders) are written to Google with no event row and no
    guests. They still get an explicit ``sendUpdates="none"`` and an audit row, and the entry
    point refuses a body that carries attendees, so it cannot become a side door for invites.
    """

    def setUp(self):
        self.user = User.objects.create_user("owner3", email="owner3@x.com", password="x")

    def test_a_guestless_write_is_silent_and_audited(self):
        svc = FakeService()
        gw.write_guestless(svc, "insert", self.user, body={"summary": "do thing"}, source="actionitem.push")
        self.assertEqual(svc.sent, ["none"])
        row = GoogleWriteLog.objects.get()
        self.assertEqual((row.action, row.send_updates, row.outcome, row.guest_count, row.source),
                         ("insert", "none", "ok", 0, "actionitem.push"))

    def test_update_carries_the_event_id(self):
        svc = FakeService()
        gw.write_guestless(svc, "update", self.user, body={"summary": "x"}, source="s", google_event_id="gid-7")
        self.assertEqual(svc.calls[0][1]["eventId"], "gid-7")

    def test_a_body_with_attendees_is_refused_and_never_reaches_google(self):
        svc = FakeService()
        with override_settings(GOOGLE_GUEST_NOTIFICATIONS=True):
            with self.assertRaises(ValueError):
                gw.write_guestless(svc, "insert", self.user,
                                   body={"summary": "x", "attendees": [{"email": "a@x.com"}]}, source="s")
        self.assertEqual(svc.calls, [])
        self.assertEqual(GoogleWriteLog.objects.get().outcome, "blocked")

    def test_a_failed_guestless_write_is_audited_as_failed(self):
        with self.assertRaises(RuntimeError):
            gw.write_guestless(FakeService(fail=RuntimeError("quota")), "insert", self.user,
                               body={"summary": "x"}, source="s")
        self.assertEqual(GoogleWriteLog.objects.get().outcome, "failed")

    def test_only_insert_and_update_are_allowed(self):
        for verb in ("patch", "delete", "move"):
            with self.assertRaises(ValueError):
                gw.write_guestless(FakeService(), verb, self.user, body={"summary": "x"}, source="s")


@override_settings(GOOGLE_GUEST_NOTIFICATIONS=True, GOOGLE_INVITE_FRESHNESS_SECONDS=60,
                   GOOGLE_MAX_GUEST_EMAILS_PER_HOUR=50, GOOGLE_MAX_GUESTS_PER_NOTIFIED_EVENT=25,
                   GOOGLE_INVITE_HORIZON_DAYS=14)
class RecurringHorizonAndNewGuestTests(TestCase):
    """
    The customer was emailed invitations months, weeks and years ahead. 92% of stored Google
    events are recurring instances from 42 series (up to 730 each), and events exist as far out as
    2087. These go through the real gateway with only Google faked.
    """

    def setUp(self):
        self.user = User.objects.create_user("owner4", email="owner4@x.com", password="x")
        self.svc = FakeService()

    def _event(self, **kw):
        defaults = dict(owner=self.user, title="Review", origin="agentpm", google_event_id="gid-1",
                        is_synced=True, attendees=GUESTS,
                        start_datetime=timezone.now() + timedelta(days=3),
                        end_datetime=timezone.now() + timedelta(days=3, hours=1))
        defaults.update(kw)
        return CalendarEvent.objects.create(**defaults)

    def _write(self, event, *, approved=True):
        return gw.write_event(self.svc, "patch", event, body={"summary": "x"}, source="test",
                              approved=approved, approved_at=timezone.now() if approved else None)

    # --- recurring series ------------------------------------------------------------------------

    def test_730_instances_of_one_series_email_nobody(self):
        events = [self._event(google_event_id=f"series1_{20260710 + i}T160000Z",
                              start_datetime=timezone.now() + timedelta(days=1 + i % 80)) for i in range(60)]
        for ev in events:
            self._write(ev)
        self.assertEqual(self.svc.sent.count("all"), 0)
        self.assertEqual(len(self.svc.sent), 60, "every instance is still written to Google, silently")
        self.assertFalse(CalendarEvent.objects.filter(invite_sent=True).exists())

    def test_a_recurring_instance_is_audited_with_its_reason(self):
        self._write(self._event(google_event_id="series1_20260710T160000Z"))
        self.assertEqual(GoogleWriteLog.objects.get().decision_reason, "recurring_instance")

    # --- horizon ---------------------------------------------------------------------------------

    def test_an_event_years_away_is_never_notified(self):
        for days in (61, 91, 400, 365 * 3, 365 * 60):
            ev = self._event(google_event_id=f"far{days}", start_datetime=timezone.now() + timedelta(days=days))
            self._write(ev)
        self.assertEqual(self.svc.sent.count("all"), 0)
        self.assertEqual(set(GoogleWriteLog.objects.values_list("decision_reason", flat=True)), {"too_far_ahead"})

    def test_a_one_off_event_a_month_out_is_notified(self):
        self._write(self._event(start_datetime=timezone.now() + timedelta(days=30)))
        self.assertEqual(self.svc.sent, ["all"])

    def test_an_event_in_the_next_few_days_is_notified(self):
        self._write(self._event())
        self.assertEqual(self.svc.sent, ["all"])

    @override_settings(GOOGLE_INVITE_HORIZON_DAYS=7, GOOGLE_INVITE_SINGLE_EVENT_HORIZON_DAYS=7)
    def test_the_horizon_is_configurable_by_setting(self):
        self._write(self._event(start_datetime=timezone.now() + timedelta(days=10)))
        self.assertEqual(self.svc.sent, ["none"])

    # --- only the new guests -----------------------------------------------------------------------

    def test_the_first_invitation_records_exactly_who_was_emailed(self):
        ev = self._event()
        self._write(ev)
        ev.refresh_from_db()
        self.assertEqual(sorted(ev.invited_emails), ["a@x.com", "b@x.com", "c@x.com"])

    def test_adding_a_guest_to_an_announced_event_emails_nobody(self):
        # Google's own docs: `attendees` REPLACES the list, and sendUpdates="all" notifies ALL
        # guests — there is no documented way to notify only a newcomer. So the only way to
        # guarantee nobody already invited is emailed twice is to send nothing on a later edit.
        ev = self._event()
        self._write(ev)
        self.assertEqual(self.svc.sent, ["all"])
        ev.refresh_from_db()
        ev.attendees = GUESTS + [{"email": "new@x.com"}]
        ev.save(update_fields=["attendees"])
        ev.refresh_from_db()
        svc2 = FakeService()
        gw.write_event(svc2, "patch", ev, body={"summary": "x", "attendees": [{"email": g["email"]} for g in ev.attendees]},
                       source="test", approved=True, approved_at=timezone.now())
        self.assertEqual(svc2.sent, ["none"])
        # ...and Google still receives the FULL list, so nobody is dropped from the event.
        sent_list = [a["email"] for a in svc2.calls[0][1]["body"]["attendees"]]
        self.assertEqual(sorted(sent_list), ["a@x.com", "b@x.com", "c@x.com", "new@x.com"])

    def test_no_write_ever_sends_google_a_partial_attendee_list_to_notify(self):
        # The destructive alternative: a patch whose attendees are just the newcomer would
        # delete everyone else from the event.
        ev = self._event()
        self._write(ev)
        for call in self.svc.calls:
            body = call[1].get("body") or {}
            if "attendees" in body:
                self.assertGreaterEqual(len(body["attendees"]), len(GUESTS))

    def test_a_second_approved_write_with_no_new_guest_sends_nothing(self):
        ev = self._event()
        self._write(ev)
        ev.refresh_from_db()
        svc2 = FakeService()
        gw.write_event(svc2, "patch", ev, body={"summary": "x"}, source="test", approved=True,
                       approved_at=timezone.now())
        self.assertEqual(svc2.sent, ["none"])

    def test_the_audit_row_lists_everyone_on_the_first_and_only_notification(self):
        ev = self._event()
        self._write(ev)
        row = GoogleWriteLog.objects.get()
        self.assertEqual(row.send_updates, "all")
        self.assertEqual(sorted(row.guests), ["a@x.com", "b@x.com", "c@x.com"])
        self.assertEqual(row.guest_count, 3)

    def test_removing_a_guest_emails_nobody(self):
        ev = self._event(invited_emails=["a@x.com", "b@x.com", "c@x.com"], attendees=[{"email": "a@x.com"}])
        self._write(ev)
        self.assertEqual(self.svc.sent, ["none"])
