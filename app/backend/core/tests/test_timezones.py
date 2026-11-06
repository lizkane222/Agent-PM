"""
Resolving the free-text `UserProfile.timezone` into a real zone.

Settings offers a plain text box (placeholder "America/New_York") and the server never
validates it, so people type what they think of their zone as: "PST", "Eastern", "pacific".
Python's tz database knows none of those. Falling back to UTC silently was wrong for exactly
those people: a voice agent offered a "9 to noon UTC" meeting to someone in Los Angeles.
"""

from datetime import datetime, timezone

from django.test import SimpleTestCase

from core.timezones import resolve_zone, zone_name


class ResolveZoneTests(SimpleTestCase):
    def test_iana_names_pass_through_unchanged(self):
        for name in ("America/Los_Angeles", "Europe/Dublin", "Asia/Tokyo", "UTC"):
            with self.subTest(name=name):
                self.assertEqual(zone_name(name), name)

    def test_common_us_abbreviations_map_to_the_region_not_a_fixed_offset(self):
        # "PST" in October means Pacific time, which is currently daylight time (UTC-7).
        # A literal fixed UTC-8 would put every meeting an hour off for half the year.
        for typed in ("PST", "PDT", "PT", "pst", " Pacific ", "pacific", "Pacific Time", "US/Pacific"):
            with self.subTest(typed=typed):
                self.assertEqual(zone_name(typed), "America/Los_Angeles")
        for typed, expected in (("EST", "America/New_York"), ("EDT", "America/New_York"), ("ET", "America/New_York"),
                                ("Eastern", "America/New_York"), ("CST", "America/Chicago"), ("CT", "America/Chicago"),
                                ("Central", "America/Chicago"), ("MST", "America/Denver"), ("MT", "America/Denver"),
                                ("Mountain", "America/Denver")):
            with self.subTest(typed=typed):
                self.assertEqual(zone_name(typed), expected)

    def test_daylight_saving_is_honoured_for_an_abbreviation(self):
        z = resolve_zone("PST")
        summer = datetime(2026, 10, 19, 12, tzinfo=timezone.utc).astimezone(z)
        winter = datetime(2026, 12, 15, 12, tzinfo=timezone.utc).astimezone(z)
        self.assertEqual(summer.utcoffset().total_seconds() / 3600, -7)
        self.assertEqual(winter.utcoffset().total_seconds() / 3600, -8)

    def test_blank_or_missing_is_utc(self):
        for value in ("", "   ", None):
            with self.subTest(value=value):
                self.assertEqual(zone_name(value), "UTC")

    def test_nonsense_falls_back_to_utc_without_raising(self):
        for value in ("Not/AZone", "banana", "../../etc/passwd", "UTC+25", "x" * 200):
            with self.subTest(value=value):
                self.assertEqual(zone_name(value), "UTC")

    def test_ambiguous_abbreviations_are_not_guessed(self):
        # IST is India, Ireland or Israel; BST is British Summer Time or Bangladesh. The tz
        # database does not know them either, so they fall back to UTC rather than a guess.
        for value in ("IST", "BST"):
            with self.subTest(value=value):
                self.assertEqual(zone_name(value), "UTC")

    def test_unambiguous_names_the_tz_database_already_knows_are_left_alone(self):
        # CET and GMT are real fixed zones, not ambiguous, so they are not remapped.
        for value in ("CET", "GMT", "EET"):
            with self.subTest(value=value):
                self.assertEqual(zone_name(value), value)

    def test_a_us_abbreviation_wins_over_the_fixed_offset_the_tz_database_has_for_it(self):
        # "EST" and "MST" exist in the tz database as fixed offsets with no daylight saving.
        # Someone typing EST in July means Eastern time (UTC-4 then), so the region wins.
        self.assertEqual(zone_name("EST"), "America/New_York")
        self.assertEqual(zone_name("MST"), "America/Denver")
        july = datetime(2026, 7, 1, 12, tzinfo=timezone.utc).astimezone(resolve_zone("EST"))
        self.assertEqual(july.utcoffset().total_seconds() / 3600, -4)

    def test_resolve_zone_returns_a_usable_zoneinfo(self):
        self.assertEqual(str(resolve_zone("pacific")), "America/Los_Angeles")
