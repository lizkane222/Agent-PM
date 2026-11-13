"""
A test runner that gives every test a fresh cache.

DRF's throttle counters (and the agent tool rate limiter) live in the process-wide cache, keyed
by user id. In tests the first user created always gets the same id, so *every test shares one
counter*: past ~200 requests in a minute the per-user throttle starts answering 429 to whichever
test happens to be running, and the failures land in unrelated apps. Thirty-three test files were
working around this by calling `cache.clear()` themselves; adding enough new tests tipped the whole
suite over regardless (skills + sync_review alone gave 16 x `429 != 200`).

Clearing before each test removes the shared state instead of dodging it. Tests that assert
throttling still work: they make their requests inside the test, after the clear.

Uses the result object's `startTest` (a public unittest hook, called before setUp) rather than a
private Django method.
"""

import unittest

from django.core.cache import cache
from django.test.runner import DiscoverRunner


class FreshCacheRunner(DiscoverRunner):
    def get_resultclass(self):
        base = super().get_resultclass() or unittest.TextTestResult

        class FreshCacheResult(base):
            def startTest(self, test):
                cache.clear()
                super().startTest(test)

        return FreshCacheResult
