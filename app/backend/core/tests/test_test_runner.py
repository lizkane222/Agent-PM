"""The test runner gives every test a fresh cache (see core/test_runner.py)."""

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase


class FreshCachePerTestTests(SimpleTestCase):
    """unittest runs these in name order: `test_a` leaves a value behind, `test_b` must not see it."""

    def test_a_leaves_state_behind(self):
        cache.set("leaked-between-tests", "yes")
        self.assertEqual(cache.get("leaked-between-tests"), "yes")

    def test_b_does_not_see_it(self):
        self.assertIsNone(cache.get("leaked-between-tests"))


@override_settings(REST_FRAMEWORK={
    "DEFAULT_THROTTLE_CLASSES": [], "DEFAULT_THROTTLE_RATES": {},
})
class ThrottleCounterDoesNotLeakTests(APITestCase):
    """The failure this prevents: one user id, hundreds of requests a minute across unrelated tests."""

    def test_a_exhausts_a_throttle_key(self):
        cache.set("throttle_user_1", [0.0] * 500)

    def test_b_starts_clean(self):
        self.assertIsNone(cache.get("throttle_user_1"))
