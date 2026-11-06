"""
The one rule for when Google may email calendar guests.

A customer received over 2,000 invitations from a single meeting move. Google emails guests
whenever a write is sent with ``sendUpdates="all"`` (and some writes leave it unset), so the
decision is taken out of the call sites and made here, once, by a pure function.

The user's rule, verbatim:
  * has this invite already been sent?  yes -> never send again.
  * no -> was the event created or updated *in AgentPM* at this moment?  yes -> may send.
  * an event that came from Google never sends.
  * and only when the user approved the send.

Everything else is ``"none"``. There is no path that returns ``"all"`` without passing all of it.
"""

from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from integrations.invite_gate import (
    REASON_ALREADY_SENT, REASON_DISABLED, REASON_FROM_GOOGLE, REASON_NO_APPROVAL,
    REASON_NO_GUESTS, REASON_NOT_FRESH, REASON_OK, REASON_RATE_LIMITED, REASON_RECURRING_INSTANCE,
    REASON_STALE_APPROVAL, REASON_TOO_FAR_AHEAD, decide, new_guest_emails,
)

NOW = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)


class _Event:
    """Only the fields the gate reads."""

    def __init__(self, **kw):
        self.invite_sent = kw.get("invite_sent", False)
        self.invite_sent_at = kw.get("invite_sent_at")
        self.created_at = kw.get("created_at", NOW)
        self.updated_at = kw.get("updated_at", NOW)
        self.origin = kw.get("origin", "agentpm")
        self.attendees = kw.get("attendees", [{"email": "a@x.com"}, {"email": "b@x.com"}])
        self.owner = kw.get("owner")
        self.google_event_id = kw.get("google_event_id", "abc123")
        self.start_datetime = kw.get("start_datetime", NOW + timedelta(days=3))
        self.invited_emails = kw.get("invited_emails", [])
        self.recurrence = kw.get("recurrence")
        self.recurring_event_id = kw.get("recurring_event_id")


def ask(event=None, *, approved=True, enabled=True, now=NOW, window=60, approved_at=None, sent_recently=0):
    return decide(
        event or _Event(), approved=approved, approved_at=approved_at if approved_at is not None else now,
        now=now, enabled=enabled, freshness_seconds=window, sent_recently=sent_recently,
    )


class DecideTests(SimpleTestCase):
    def test_a_fresh_agentpm_event_the_user_approved_may_be_emailed(self):
        d = ask()
        self.assertEqual((d.send, d.send_updates, d.reason), (True, "all", REASON_OK))

    def test_the_default_outcome_is_none_for_every_refusal(self):
        for kw, reason in [
            (dict(event=_Event(invite_sent=True)), REASON_ALREADY_SENT),
            (dict(event=_Event(origin="google")), REASON_FROM_GOOGLE),
            (dict(approved=False), REASON_NO_APPROVAL),
            (dict(enabled=False), REASON_DISABLED),
            (dict(event=_Event(attendees=[])), REASON_NO_GUESTS),
        ]:
            with self.subTest(reason=reason):
                d = ask(**kw)
                self.assertEqual((d.send, d.send_updates, d.reason), (False, "none", reason))

    # --- the user's three questions, in the order they asked them -----------------------

    def test_q1_an_invite_already_sent_is_never_sent_again(self):
        self.assertEqual(ask(_Event(invite_sent=True, invite_sent_at=NOW)).reason, REASON_ALREADY_SENT)

    def test_q1_wins_even_when_everything_else_says_yes(self):
        d = ask(_Event(invite_sent=True), approved=True, enabled=True)
        self.assertFalse(d.send)

    def test_q2_a_stale_event_is_not_emailed(self):
        # The event was last touched long ago, so this write is not "the moment" of an edit.
        old = NOW - timedelta(hours=3)
        self.assertEqual(ask(_Event(created_at=old, updated_at=old)).reason, REASON_NOT_FRESH)

    def test_q2_the_freshness_window_is_bounded(self):
        inside = NOW - timedelta(seconds=59)
        outside = NOW - timedelta(seconds=61)
        self.assertTrue(ask(_Event(created_at=inside, updated_at=inside)).send)
        self.assertEqual(ask(_Event(created_at=outside, updated_at=outside)).reason, REASON_NOT_FRESH)

    def test_q2_an_update_counts_by_updated_at_not_created_at(self):
        # Created a month ago, edited just now: that edit is the moment.
        month = NOW - timedelta(days=30)
        self.assertTrue(ask(_Event(created_at=month, updated_at=NOW)).send)

    def test_q2_a_timestamp_in_the_future_is_not_fresh(self):
        # A clock-skewed or tampered row must not be trusted as "now".
        future = NOW + timedelta(minutes=10)
        self.assertEqual(ask(_Event(created_at=future, updated_at=future)).reason, REASON_NOT_FRESH)

    def test_q2_a_missing_timestamp_fails_closed(self):
        self.assertEqual(ask(_Event(created_at=None, updated_at=None)).reason, REASON_NOT_FRESH)

    def test_google_origin_never_sends_even_if_fresh_and_approved(self):
        self.assertEqual(ask(_Event(origin="google")).reason, REASON_FROM_GOOGLE)

    # --- approval ----------------------------------------------------------------------------

    def test_no_approval_never_sends(self):
        self.assertEqual(ask(approved=False).reason, REASON_NO_APPROVAL)

    def test_an_approval_that_is_too_old_is_not_reusable(self):
        # "Yes" given 10 minutes ago, for a different action, must not authorise this one.
        self.assertEqual(ask(approved_at=NOW - timedelta(minutes=10)).reason, REASON_STALE_APPROVAL)

    def test_an_approval_with_no_timestamp_fails_closed(self):
        d = decide(_Event(), approved=True, approved_at=None, now=NOW, enabled=True,
                   freshness_seconds=60, sent_recently=0)
        self.assertEqual(d.reason, REASON_STALE_APPROVAL)

    # --- governance beyond the three questions -----------------------------------------------

    def test_the_global_switch_off_blocks_everything(self):
        self.assertEqual(ask(enabled=False).reason, REASON_DISABLED)

    def test_an_event_with_no_guests_has_nothing_to_send(self):
        self.assertEqual(ask(_Event(attendees=[])).reason, REASON_NO_GUESTS)
        self.assertEqual(ask(_Event(attendees=[{"email": ""}, {}])).reason, REASON_NO_GUESTS)

    def test_the_owner_alone_is_not_a_guest(self):
        class Owner: email = "me@x.com"
        self.assertEqual(ask(_Event(attendees=[{"email": "ME@x.com"}], owner=Owner())).reason, REASON_NO_GUESTS)

    def test_the_rate_limit_blocks_once_the_hourly_budget_is_spent(self):
        self.assertEqual(ask(sent_recently=20).reason, REASON_RATE_LIMITED)
        self.assertTrue(ask(sent_recently=0).send)

    def test_a_decision_is_always_one_of_none_or_all(self):
        for kw in [dict(), dict(approved=False), dict(enabled=False), dict(event=_Event(origin="google"))]:
            self.assertIn(ask(**kw).send_updates, ("none", "all"))

    def test_decisions_carry_the_reason_for_the_audit_log(self):
        self.assertTrue(ask().reason)
        self.assertTrue(ask(approved=False).reason)


class RecurringAndHorizonTests(SimpleTestCase):
    """
    The customer was emailed invitations "for months, weeks and years in advance". 92% of the
    stored Google events are recurring *instances* (ids like ``<series>_20260710T160000Z``) from
    only 42 series, some expanding to 730 instances. The series is ONE invitation — Google asks
    each guest "this event or all events" itself — so an instance must never email on its own,
    and nothing far in the future is ever announced automatically.
    """

    def test_a_recurring_instance_never_sends(self):
        d = ask(_Event(google_event_id="1nnedd2q3q3bds3ai5ch0416ft_20260710T160000Z"))
        self.assertEqual((d.send, d.send_updates, d.reason), (False, "none", REASON_RECURRING_INSTANCE))

    def test_all_day_instance_ids_are_recognised_too(self):
        self.assertEqual(ask(_Event(google_event_id="abc_20260710")).reason, REASON_RECURRING_INSTANCE)

    def test_a_single_event_id_is_not_mistaken_for_an_instance(self):
        self.assertTrue(ask(_Event(google_event_id="a1b2c3d4e5f6")).send)

    def test_an_event_not_yet_in_google_has_no_id_and_may_send(self):
        self.assertTrue(ask(_Event(google_event_id="")).send)

    def test_an_event_inside_the_horizon_may_send(self):
        self.assertTrue(ask(_Event(start_datetime=NOW + timedelta(days=13))).send)

    def test_the_default_windows_are_two_weeks_and_sixty_days_for_a_one_off(self):
        # Owner's decision 2026-11-04.
        from integrations.invite_gate import DEFAULT_HORIZON_DAYS, DEFAULT_SINGLE_EVENT_HORIZON_DAYS
        self.assertEqual((DEFAULT_HORIZON_DAYS, DEFAULT_SINGLE_EVENT_HORIZON_DAYS), (14, 60))

    def test_a_one_off_event_may_send_up_to_sixty_days_ahead(self):
        self.assertTrue(ask(_Event(start_datetime=NOW + timedelta(days=59))).send)
        self.assertEqual(ask(_Event(start_datetime=NOW + timedelta(days=60, hours=1))).reason, REASON_TOO_FAR_AHEAD)

    def test_a_recurring_event_never_gets_the_long_window(self):
        for extra in ({"recurrence": ["RRULE:FREQ=WEEKLY"]}, {"recurring_event_id": "series1"}):
            with self.subTest(extra=extra):
                self.assertTrue(ask(_Event(start_datetime=NOW + timedelta(days=13), **extra)).send)
                self.assertEqual(
                    ask(_Event(start_datetime=NOW + timedelta(days=30), **extra)).reason, REASON_TOO_FAR_AHEAD)

    def test_an_event_beyond_the_horizon_never_sends(self):
        for days in (61, 91, 365, 366 * 5, 365 * 61):  # the data holds events as late as 2087
            with self.subTest(days=days):
                d = ask(_Event(start_datetime=NOW + timedelta(days=days)))
                self.assertEqual((d.send, d.reason), (False, REASON_TOO_FAR_AHEAD))

    def test_the_horizon_is_configurable(self):
        d = decide(_Event(start_datetime=NOW + timedelta(days=10)), approved=True, approved_at=NOW, now=NOW,
                   enabled=True, freshness_seconds=60, sent_recently=0, horizon_days=7,
                   single_event_horizon_days=7)
        self.assertEqual(d.reason, REASON_TOO_FAR_AHEAD)

    def test_a_past_event_is_never_announced(self):
        self.assertEqual(ask(_Event(start_datetime=NOW - timedelta(days=2))).reason, REASON_TOO_FAR_AHEAD)
        self.assertEqual(ask(_Event(start_datetime=NOW - timedelta(hours=1))).reason, REASON_TOO_FAR_AHEAD)

    def test_a_meeting_starting_right_now_is_still_announced(self):
        # "Create a call now and invite them": the start is a few seconds behind by the time the
        # write happens. Refusing that would be a wrong refusal, so a small grace is allowed...
        self.assertTrue(ask(_Event(start_datetime=NOW)).send)
        self.assertTrue(ask(_Event(start_datetime=NOW - timedelta(minutes=4))).send)

    def test_the_grace_for_a_just_started_meeting_is_narrow(self):
        # ...but not a back door: five minutes and a second behind is refused.
        self.assertEqual(ask(_Event(start_datetime=NOW - timedelta(minutes=5, seconds=1))).reason,
                         REASON_TOO_FAR_AHEAD)

    def test_a_missing_start_fails_closed(self):
        self.assertFalse(ask(_Event(start_datetime=None)).send)


class NewGuestsOnlyTests(SimpleTestCase):
    """
    "If the update is only that there's a new email added then we only send an invite for the
    new email added, not to everyone on the invite." Google emails the newcomers when they are
    the only ones added in a patch, but re-sends to everyone if the whole list is re-sent with
    ``sendUpdates="all"`` — so what is notified is decided here, per address.
    """

    def test_the_new_guests_are_only_those_not_already_invited(self):
        e = _Event(attendees=[{"email": "a@x.com"}, {"email": "b@x.com"}, {"email": "new@x.com"}],
                   invited_emails=["a@x.com", "b@x.com"])
        self.assertEqual(new_guest_emails(e), ["new@x.com"])

    def test_nobody_new_means_nobody_to_notify(self):
        e = _Event(attendees=[{"email": "a@x.com"}], invited_emails=["a@x.com"])
        self.assertEqual(new_guest_emails(e), [])

    def test_comparison_ignores_case_and_whitespace(self):
        e = _Event(attendees=[{"email": " A@X.com "}, {"email": "New@x.com"}], invited_emails=["a@x.com"])
        self.assertEqual(new_guest_emails(e), ["new@x.com"])

    def test_a_first_invitation_notifies_everyone(self):
        e = _Event(attendees=[{"email": "a@x.com"}, {"email": "b@x.com"}], invited_emails=[])
        self.assertEqual(new_guest_emails(e), ["a@x.com", "b@x.com"])

    def test_the_owner_is_never_a_new_guest(self):
        class Owner: email = "me@x.com"
        e = _Event(attendees=[{"email": "me@x.com"}, {"email": "n@x.com"}], owner=Owner())
        self.assertEqual(new_guest_emails(e), ["n@x.com"])

    def test_removing_a_guest_notifies_nobody(self):
        e = _Event(attendees=[{"email": "a@x.com"}], invited_emails=["a@x.com", "b@x.com"])
        self.assertEqual(new_guest_emails(e), [])

    def test_a_decision_with_only_old_guests_has_nothing_to_send(self):
        # Everyone on it was already emailed, so the honest reason is "already sent".
        e = _Event(invite_sent=False, attendees=[{"email": "a@x.com"}], invited_emails=["a@x.com"])
        self.assertEqual(ask(e).reason, REASON_ALREADY_SENT)

    def test_once_anyone_was_emailed_a_newcomer_is_not_notified_because_google_would_re_email_everyone(self):
        # Google documents sendUpdates="all" as notifying ALL guests and offers no way to notify
        # only a newcomer, so notifying for one new address would email everyone already invited.
        e = _Event(attendees=[{"email": "a@x.com"}, {"email": "new@x.com"}], invited_emails=["a@x.com"])
        d = ask(e)
        self.assertEqual((d.send, d.send_updates, d.reason), (False, "none", REASON_ALREADY_SENT))

    def test_a_first_invitation_reports_everyone_who_will_be_emailed(self):
        e = _Event(attendees=[{"email": "a@x.com"}, {"email": "b@x.com"}])
        d = ask(e)
        self.assertTrue(d.send)
        self.assertEqual(d.recipients, ["a@x.com", "b@x.com"])
