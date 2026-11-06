"""Fuzzy account-name resolution for spoken names (agents/fuzzy.py)."""

from django.test import SimpleTestCase

from agents.fuzzy import resolve_name

ACCOUNTS = [
    "ABC", "ADMIN", "Agent PM - FEATURES", "Archistrator", "Autodesk", "Berxi",
    "Big Commerce", "Corsair", "Festival Foods", "GoodInside", "JPMC", "Move Inc",
    "Segment Data Deletion", "Siemens", "The Daily Wire", "UC Berkeley",
    "Vladimir Jones", "WPEngine",
]


class ResolveNameTests(SimpleTestCase):
    def test_exact_match_ignores_case(self):
        r = resolve_name("archistrator", ACCOUNTS)
        self.assertEqual((r.match, r.exact), ("Archistrator", True))

    def test_transcription_errors_resolve_to_the_real_name(self):
        # The reported failure: "Archistrator" heard as "Orchestrator" / "aOrchestrator".
        for heard in ("Orchestrator", "aOrchestrator", "Archistrater", "Seamens", "Berxy", "Auto desk"):
            with self.subTest(heard=heard):
                self.assertIsNotNone(resolve_name(heard, ACCOUNTS).match)
        self.assertEqual(resolve_name("Orchestrator", ACCOUNTS).match, "Archistrator")
        self.assertEqual(resolve_name("Seamens", ACCOUNTS).match, "Siemens")

    def test_partial_names_resolve(self):
        self.assertEqual(resolve_name("Agent PM", ACCOUNTS).match, "Agent PM - FEATURES")
        self.assertEqual(resolve_name("Daily Wire", ACCOUNTS).match, "The Daily Wire")
        self.assertEqual(resolve_name("BigCommerce", ACCOUNTS).match, "Big Commerce")

    def test_unrelated_names_match_nothing(self):
        for heard in ("Acme", "xyz", "Nonexistent Holdings"):
            with self.subTest(heard=heard):
                r = resolve_name(heard, ACCOUNTS)
                self.assertIsNone(r.match)

    def test_an_alias_with_no_textual_resemblance_is_not_guessed(self):
        self.assertIsNone(resolve_name("JP Morgan", ACCOUNTS).match)

    def test_two_equally_close_names_are_offered_not_picked(self):
        r = resolve_name("Acme Corp", ["Acme Corp East", "Acme Corp West"])
        self.assertIsNone(r.match)
        self.assertTrue(r.ambiguous)
        self.assertEqual(set(r.candidates), {"Acme Corp East", "Acme Corp West"})

    def test_candidates_are_capped(self):
        r = resolve_name("Acme", [f"Acme Group {i}" for i in range(10)])
        self.assertLessEqual(len(r.candidates), 3)

    def test_blank_input_and_empty_pool(self):
        for q, pool in (("", ACCOUNTS), (None, ACCOUNTS), ("Archistrator", []), ("  ", ACCOUNTS)):
            with self.subTest(q=q, pool=pool):
                r = resolve_name(q, pool)
                self.assertEqual((r.match, r.candidates), (None, []))

    def test_company_suffixes_do_not_break_matching(self):
        self.assertEqual(resolve_name("Move", ACCOUNTS).match, "Move Inc")
        self.assertEqual(resolve_name("Siemens Inc.", ACCOUNTS).match, "Siemens")

    def test_exact_beats_a_closer_looking_fuzzy_neighbour(self):
        r = resolve_name("Berxi", ["Berxi", "Berxie"])
        self.assertEqual((r.match, r.exact), ("Berxi", True))
