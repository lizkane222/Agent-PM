"""Tests for core.query_params: comma-separated query-param parsing."""

from django.test import SimpleTestCase

from core.query_params import csv_int_params, csv_params


class CsvParamsTest(SimpleTestCase):
    def test_none_returns_empty(self):
        self.assertEqual(csv_params(None), [])

    def test_empty_string_returns_empty(self):
        self.assertEqual(csv_params(""), [])

    def test_single_value_returns_one_element(self):
        """The backwards-compatibility case: existing single-value callers."""
        self.assertEqual(csv_params("recABC"), ["recABC"])

    def test_splits_on_commas(self):
        self.assertEqual(csv_params("a,b,c"), ["a", "b", "c"])

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(csv_params(" a , b "), ["a", "b"])

    def test_drops_empty_tokens(self):
        self.assertEqual(csv_params("a,,b,"), ["a", "b"])

    def test_all_empty_tokens_returns_empty(self):
        self.assertEqual(csv_params(",,,"), [])


class CsvIntParamsTest(SimpleTestCase):
    def test_none_returns_empty(self):
        self.assertEqual(csv_int_params(None), [])

    def test_single_value_returns_one_element(self):
        self.assertEqual(csv_int_params("5"), [5])

    def test_parses_a_batch(self):
        self.assertEqual(csv_int_params("1,2,3"), [1, 2, 3])

    def test_ignores_non_numeric_tokens(self):
        """A malformed token degrades to a narrower filter rather than a 500."""
        self.assertEqual(csv_int_params("1,abc,3"), [1, 3])

    def test_all_non_numeric_returns_empty(self):
        self.assertEqual(csv_int_params("abc,def"), [])

    def test_tolerates_whitespace_and_empty_tokens(self):
        self.assertEqual(csv_int_params(" 1 ,,2,"), [1, 2])

    def test_negative_numbers_are_rejected(self):
        """isdigit() excludes signs — PKs are never negative, so this is intended."""
        self.assertEqual(csv_int_params("-1,2"), [2])
