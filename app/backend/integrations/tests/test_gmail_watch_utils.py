"""Tests for Gmail watch filtering and labeling utilities."""

from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from team.models import UserProfile
from integrations.gmail_watch_utils import (
    email_matches_keywords,
    get_user_block_keywords,
    get_user_gmail_label,
    get_user_watch_keywords,
)

User = get_user_model()


class GetUserWatchKeywordsTest(TestCase):
    """Tests for get_user_watch_keywords."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="alice", email="alice@example.com", password="pw"
        )
        self.profile = UserProfile.objects.create(user=self.user)

    @override_settings(GMAIL_DEFAULT_KEYWORDS=["meeting notes", "zoom", "gong"])
    def test_includes_default_keywords(self):
        keywords = get_user_watch_keywords(self.user)
        self.assertIn("meeting notes", keywords)
        self.assertIn("zoom", keywords)
        self.assertIn("gong", keywords)

    @override_settings(GMAIL_DEFAULT_KEYWORDS=["meeting notes"])
    def test_includes_user_title(self):
        self.profile.title = "Customer Success Manager"
        self.profile.save()
        keywords = get_user_watch_keywords(self.user)
        self.assertIn("customer success manager", keywords)  # lowercased

    @override_settings(GMAIL_DEFAULT_KEYWORDS=["meeting notes"])
    def test_includes_user_configured_keywords(self):
        self.profile.gmail_watch_config = {
            "keywords": ["personal", "budget"],
        }
        self.profile.save()
        keywords = get_user_watch_keywords(self.user)
        self.assertIn("personal", keywords)
        self.assertIn("budget", keywords)

    @override_settings(GMAIL_DEFAULT_KEYWORDS=["meeting notes"])
    def test_lowercases_all_keywords(self):
        self.profile.gmail_watch_config = {
            "keywords": ["My-PROJECT", "URGENT"],
        }
        self.profile.save()
        keywords = get_user_watch_keywords(self.user)
        self.assertIn("my-project", keywords)
        self.assertIn("urgent", keywords)
        self.assertNotIn("My-PROJECT", keywords)
        self.assertNotIn("URGENT", keywords)


class GetUserBlockKeywordsTest(TestCase):
    """Tests for get_user_block_keywords."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="bob", email="bob@example.com", password="pw"
        )
        UserProfile.objects.create(user=self.user)

    def test_returns_empty_by_default(self):
        keywords = get_user_block_keywords(self.user)
        self.assertEqual(keywords, [])

    def test_includes_user_configured_block_keywords(self):
        self.user.profile.gmail_watch_config = {
            "block_keywords": ["spam", "promo"],
        }
        self.user.profile.save()
        keywords = get_user_block_keywords(self.user)
        self.assertIn("spam", keywords)
        self.assertIn("promo", keywords)

    def test_lowercases_block_keywords(self):
        self.user.profile.gmail_watch_config = {
            "block_keywords": ["PERSONAL", "Draft"],
        }
        self.user.profile.save()
        keywords = get_user_block_keywords(self.user)
        self.assertIn("personal", keywords)
        self.assertIn("draft", keywords)


class GetUserGmailLabelTest(TestCase):
    """Tests for get_user_gmail_label."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="charlie", email="charlie@example.com", password="pw"
        )
        UserProfile.objects.create(user=self.user)

    def test_returns_none_by_default(self):
        label = get_user_gmail_label(self.user)
        self.assertIsNone(label)

    def test_returns_configured_label_name(self):
        self.user.profile.gmail_watch_config = {
            "label_name": "Agent PM - Threads",
        }
        self.user.profile.save()
        label = get_user_gmail_label(self.user)
        self.assertEqual(label, "Agent PM - Threads")

    def test_ignores_empty_label_name(self):
        self.user.profile.gmail_watch_config = {
            "label_name": "",
        }
        self.user.profile.save()
        label = get_user_gmail_label(self.user)
        self.assertIsNone(label)

    def test_strips_whitespace_from_label_name(self):
        self.user.profile.gmail_watch_config = {
            "label_name": "  Agent PM - Threads  ",
        }
        self.user.profile.save()
        label = get_user_gmail_label(self.user)
        self.assertEqual(label, "Agent PM - Threads")


class EmailMatchesKeywordsTest(TestCase):
    """Tests for email_matches_keywords."""

    def test_matches_exact_keyword(self):
        """Email with exact keyword match should pass."""
        result = email_matches_keywords(
            email_subject="Meeting notes for Q3 planning",
            email_body="",
            keywords=["meeting notes"],
            block_keywords=[],
        )
        self.assertTrue(result)

    def test_matches_keyword_in_body(self):
        """Keyword match in email body should pass."""
        result = email_matches_keywords(
            email_subject="Q3 Review",
            email_body="Please find the Gong recording attached.",
            keywords=["gong"],
            block_keywords=[],
        )
        self.assertTrue(result)

    def test_case_insensitive_match(self):
        """Keyword matching should be case-insensitive."""
        result = email_matches_keywords(
            email_subject="MEETING NOTES",
            email_body="",
            keywords=["meeting notes"],
            block_keywords=[],
        )
        self.assertTrue(result)

    def test_no_match_rejects_email(self):
        """Email with no keyword match should be rejected."""
        result = email_matches_keywords(
            email_subject="Lunch plans",
            email_body="Let's meet at noon.",
            keywords=["meeting notes", "zoom", "gong"],
            block_keywords=[],
        )
        self.assertFalse(result)

    def test_empty_keywords_accepts_all(self):
        """Empty keyword list should accept all (unless blocked)."""
        result = email_matches_keywords(
            email_subject="Random email",
            email_body="Some content",
            keywords=[],
            block_keywords=[],
        )
        self.assertTrue(result)

    def test_block_keyword_rejects(self):
        """Email matching block keyword should be rejected."""
        result = email_matches_keywords(
            email_subject="Meeting notes",
            email_body="Personal meeting",
            keywords=["meeting notes"],
            block_keywords=["personal"],
        )
        self.assertFalse(result)

    def test_block_takes_precedence(self):
        """Block keyword should take precedence over match."""
        result = email_matches_keywords(
            email_subject="Zoom meeting",
            email_body="Spam content",
            keywords=["zoom"],
            block_keywords=["spam"],
        )
        self.assertFalse(result)

    def test_fuzzy_matches_typos(self):
        """Should fuzzy-match keywords with typos (ratio >= 0.7)."""
        result = email_matches_keywords(
            email_subject="Meting notes from gong",  # typo in "meeting"
            email_body="",
            keywords=["meeting notes"],
            block_keywords=[],
        )
        # "meting" vs "meeting" is high enough ratio for fuzzy match
        # (SequenceMatcher ratio is ~0.85)
        self.assertTrue(result)

    def test_multiple_keywords_match(self):
        """Email can match any keyword in the list."""
        result = email_matches_keywords(
            email_subject="Zoom recording link",
            email_body="",
            keywords=["gong", "zoom", "meeting notes"],
            block_keywords=[],
        )
        self.assertTrue(result)

    def test_multiple_block_keywords(self):
        """Should check against all block keywords."""
        result = email_matches_keywords(
            email_subject="Meeting notes",
            email_body="This is a draft document.",
            keywords=["meeting notes"],
            block_keywords=["draft", "personal", "spam"],
        )
        self.assertFalse(result)

    def test_empty_subject_and_body(self):
        """Emails with empty subject/body should be rejected (no match)."""
        result = email_matches_keywords(
            email_subject="",
            email_body="",
            keywords=["meeting notes"],
            block_keywords=[],
        )
        self.assertFalse(result)

    def test_whitespace_only_considered(self):
        """Keywords should not match whitespace-only text."""
        result = email_matches_keywords(
            email_subject="   ",
            email_body="   ",
            keywords=["meeting"],
            block_keywords=[],
        )
        self.assertFalse(result)
