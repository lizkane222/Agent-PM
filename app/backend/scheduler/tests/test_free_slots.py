"""
Python port of the web app's findFreeSlots (frontend/src/lib/availability.ts).

The voice agent offers the same free time the "Find free time" button paints on the grid, so
the two must agree. Times are evaluated in the *caller's* timezone: the server runs in UTC, and
a 9-to-5 window in UTC is the middle of the night in Los Angeles.
"""

from datetime import datetime, timezone

from django.test import SimpleTestCase

from scheduler.free_slots import find_free_slots

UTC = timezone.utc
LA = "America/Los_Angeles"


def dt(day, hour, minute=0, *, month=10, year=2026):
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


def busy(start, end, all_day=False):
    return {"start": start.isoformat(), "end": end.isoformat(), "all_day": all_day}


# Mon 19 Oct 2026 .. Sat 24 Oct 2026, evaluated in UTC unless a test says otherwise.
RANGE = (dt(19, 0), dt(24, 0))
LONG_AGO = dt(1, 0)


def slots(busy_blocks, *, tz="UTC", rng=RANGE, **kw):
    kw.setdefault("now", LONG_AGO)
    return find_free_slots(busy_blocks, *rng, tz_name=tz, **kw)


def pairs(result):
    return [(s["start"].hour, s["start"].minute, s["end"].hour, s["end"].minute, s["start"].day) for s in result]


class FindFreeSlotsTests(SimpleTestCase):
    def test_an_empty_calendar_is_free_for_the_whole_working_day_on_each_weekday(self):
        result = slots([])
        self.assertEqual(len(result), 5)  # Mon-Fri
        self.assertEqual({(s["start"].hour, s["end"].hour) for s in result}, {(9, 17)})

    def test_weekends_are_skipped_by_default(self):
        result = slots([], rng=(dt(24, 0), dt(26, 0)))  # Sat, Sun
        self.assertEqual(result, [])

    def test_weekends_can_be_included(self):
        result = slots([], rng=(dt(24, 0), dt(26, 0)), include_weekends=True)
        self.assertEqual(len(result), 2)

    def test_a_busy_block_splits_the_day(self):
        result = slots([busy(dt(19, 12), dt(19, 13))], rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(pairs(result), [(9, 0, 12, 0, 19), (13, 0, 17, 0, 19)])

    def test_gaps_shorter_than_the_minimum_are_dropped(self):
        # 9:00-9:20 is only 20 minutes before the meeting.
        result = slots([busy(dt(19, 9, 20), dt(19, 17))], rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(result, [])

    def test_a_gap_of_exactly_the_minimum_is_kept(self):
        result = slots([busy(dt(19, 9, 30), dt(19, 17))], rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(pairs(result), [(9, 0, 9, 30, 19)])

    def test_the_minimum_is_configurable(self):
        result = slots([busy(dt(19, 9, 20), dt(19, 17))], rng=(dt(19, 0), dt(20, 0)), min_minutes=15)
        self.assertEqual(pairs(result), [(9, 0, 9, 20, 19)])

    def test_overlapping_and_adjacent_busy_blocks_merge(self):
        blocks = [busy(dt(19, 10), dt(19, 12)), busy(dt(19, 11), dt(19, 13)), busy(dt(19, 13), dt(19, 14))]
        result = slots(blocks, rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(pairs(result), [(9, 0, 10, 0, 19), (14, 0, 17, 0, 19)])

    def test_unsorted_busy_blocks_give_the_same_answer(self):
        a = [busy(dt(19, 13), dt(19, 14)), busy(dt(19, 10), dt(19, 11))]
        self.assertEqual(slots(a, rng=(dt(19, 0), dt(20, 0))), slots(list(reversed(a)), rng=(dt(19, 0), dt(20, 0))))

    def test_all_day_blocks_are_ignored(self):
        self.assertEqual(len(slots([busy(dt(19, 0), dt(20, 0), all_day=True)])), 5)

    def test_busy_outside_working_hours_changes_nothing(self):
        self.assertEqual(len(slots([busy(dt(19, 18), dt(19, 20))])), 5)

    def test_a_block_straddling_the_start_of_the_day_trims_it(self):
        result = slots([busy(dt(19, 8), dt(19, 10))], rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(pairs(result), [(10, 0, 17, 0, 19)])

    def test_nothing_is_offered_in_the_past(self):
        result = slots([], rng=(dt(19, 0), dt(20, 0)), now=dt(19, 13))
        self.assertEqual(pairs(result), [(13, 0, 17, 0, 19)])

    def test_a_day_that_is_over_has_no_slots(self):
        self.assertEqual(slots([], rng=(dt(19, 0), dt(20, 0)), now=dt(19, 18)), [])

    def test_malformed_and_inverted_blocks_are_ignored_not_fatal(self):
        bad = [{"start": "garbage", "end": "x"}, busy(dt(19, 12), dt(19, 11)), {"start": None, "end": None}]
        self.assertEqual(len(slots(bad)), 5)

    def test_a_timezone_aware_string_with_z_is_understood(self):
        block = {"start": "2026-10-19T12:00:00Z", "end": "2026-10-19T13:00:00Z", "all_day": False}
        result = slots([block], rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(pairs(result), [(9, 0, 12, 0, 19), (13, 0, 17, 0, 19)])


class FindFreeSlotsTimezoneTests(SimpleTestCase):
    def test_working_hours_follow_the_callers_timezone(self):
        # Monday in Los Angeles (UTC-7 in October): 9:00-17:00 local is 16:00-00:00 UTC.
        la_day = (datetime(2026, 10, 19, 7, tzinfo=UTC), datetime(2026, 10, 20, 7, tzinfo=UTC))
        result = slots([], tz=LA, rng=la_day)
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]["start"].hour, result[0]["end"].hour), (9, 17))
        self.assertEqual(str(result[0]["start"].tzinfo), "America/Los_Angeles")

    def test_a_busy_block_is_placed_by_its_real_instant(self):
        # 20:00Z is 13:00 in Los Angeles.
        la_day = (datetime(2026, 10, 19, 7, tzinfo=UTC), datetime(2026, 10, 20, 7, tzinfo=UTC))
        result = slots([busy(dt(19, 20), dt(19, 21))], tz=LA, rng=la_day)
        self.assertEqual([(s["start"].hour, s["end"].hour) for s in result], [(9, 13), (14, 17)])

    def test_unknown_timezone_falls_back_to_utc(self):
        result = slots([], tz="Not/AZone", rng=(dt(19, 0), dt(20, 0)))
        self.assertEqual(len(result), 1)
        self.assertEqual(str(result[0]["start"].tzinfo), "UTC")
