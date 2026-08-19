"""Utilities for Gmail watch filtering and labeling."""

import difflib
import logging
import re
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)


def get_user_watch_keywords(user) -> list[str]:
    """
    Return the complete keyword list for a user: defaults + account names + role title + user config.
    Keywords are lowercased for case-insensitive matching.
    """
    from accounts.models import Account

    keywords = list(settings.GMAIL_DEFAULT_KEYWORDS)

    # Add user's role title
    if user.profile and user.profile.title:
        keywords.append(user.profile.title)

    # Add all account names the user can access (fuzzy matching)
    for account in Account.objects.filter(
        team_members__user=user
    ).values_list("company_name", flat=True).distinct():
        if account:
            keywords.append(account)

    # Add user-configured keywords
    config = getattr(user.profile, "gmail_watch_config", {}) or {}
    if isinstance(config, dict):
        user_keywords = config.get("keywords", [])
        if isinstance(user_keywords, list):
            keywords.extend(user_keywords)

    # Lowercase all keywords for case-insensitive matching
    return [kw.lower() if isinstance(kw, str) else kw for kw in keywords]


def get_user_block_keywords(user) -> list[str]:
    """Return user-configured block keywords, lowercased."""
    config = getattr(user.profile, "gmail_watch_config", {}) or {}
    if not isinstance(config, dict):
        return []
    block = config.get("block_keywords", [])
    if not isinstance(block, list):
        return []
    return [kw.lower() if isinstance(kw, str) else kw for kw in block]


def get_user_gmail_label(user) -> Optional[str]:
    """Return the user's configured Gmail label name for watch, e.g. 'Agent PM - Threads'."""
    config = getattr(user.profile, "gmail_watch_config", {}) or {}
    if not isinstance(config, dict):
        return None
    label = config.get("label_name", "").strip()
    return label if label else None


def email_matches_keywords(email_subject: str, email_body: str, keywords: list[str], block_keywords: list[str]) -> bool:
    """
    Check if email matches the watch keywords and is not blocked.

    Uses fuzzy matching (SequenceMatcher) to catch misspellings and word order variance.
    An email must:
      1. Match at least one keyword (fuzzy ratio >= 0.7)
      2. Not match any block keyword

    Returns True if the email should be synced, False otherwise.
    """
    if not keywords:
        # No keywords = sync everything (unless blocked)
        pass
    else:
        matched = False
        combined_text = (email_subject + " " + email_body).lower()
        for keyword in keywords:
            if not keyword:
                continue
            # Exact substring match (fastest path)
            if keyword in combined_text:
                matched = True
                break
            # Fuzzy match for typos/variance
            if _fuzzy_match(combined_text, keyword, threshold=0.7):
                matched = True
                break
        if not matched:
            return False

    # Check block keywords
    if block_keywords:
        combined_text = (email_subject + " " + email_body).lower()
        for keyword in block_keywords:
            if not keyword:
                continue
            if keyword in combined_text:
                return False
            if _fuzzy_match(combined_text, keyword, threshold=0.7):
                return False

    return True


def _fuzzy_match(text: str, pattern: str, threshold: float = 0.7) -> bool:
    """
    Check if pattern fuzzy-matches text (for catching typos/variance).
    Splits both pattern and text into words and checks if sequences of words match.
    """
    # Extract words from both
    text_words = re.findall(r"\w+", text.lower())
    pattern_words = re.findall(r"\w+", pattern.lower())

    if not pattern_words:
        return False

    # If pattern is a single word, check each text word
    if len(pattern_words) == 1:
        pattern_word = pattern_words[0]
        for text_word in text_words:
            ratio = difflib.SequenceMatcher(None, text_word, pattern_word).ratio()
            if ratio >= threshold:
                return True
        return False

    # If pattern is multiple words, check if a sequence of text words matches
    # e.g., pattern="meeting notes", text_words=["meting", "notes"] should fuzzy-match
    pattern_str = " ".join(pattern_words)
    for i in range(len(text_words) - len(pattern_words) + 1):
        text_seq = " ".join(text_words[i:i + len(pattern_words)])
        ratio = difflib.SequenceMatcher(None, text_seq, pattern_str).ratio()
        if ratio >= threshold:
            return True

    return False


def get_user_labels_from_gmail(gmail_service, user_email: str = "me") -> dict[str, str]:
    """
    Fetch all labels from a user's Gmail and return as {label_name: label_id}.
    Caches briefly so multiple calls in one task don't re-fetch.
    """
    try:
        results = gmail_service.users().labels().list(userId=user_email).execute()
        labels = results.get("labels", [])
        return {label["name"]: label["id"] for label in labels}
    except Exception as e:
        logger.warning("Failed to fetch Gmail labels for %s: %s", user_email, e)
        return {}


def get_or_create_gmail_label(gmail_service, label_name: str, user_email: str = "me") -> Optional[str]:
    """
    Get or create a Gmail label by name. Returns the label ID.
    If the label exists, returns its ID. If not, creates it and returns the new ID.
    Returns None on error.
    """
    if not label_name:
        return None

    try:
        # Check if label exists
        labels = get_user_labels_from_gmail(gmail_service, user_email)
        if label_name in labels:
            return labels[label_name]

        # Create the label (with default settings)
        label_object = {
            "name": label_name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        }
        created = gmail_service.users().labels().create(
            userId=user_email,
            body=label_object,
        ).execute()
        logger.info("Created Gmail label '%s' (id=%s)", label_name, created.get("id"))
        return created.get("id")
    except Exception as e:
        logger.warning("Failed to get/create Gmail label '%s': %s", label_name, e)
        return None


def apply_gmail_label_to_messages(gmail_service, message_ids: list[str], label_id: str, user_email: str = "me") -> int:
    """
    Apply a label to multiple messages. Returns the count of successfully labeled messages.
    Errors per-message are logged but don't halt the batch.
    """
    if not message_ids or not label_id:
        return 0

    successful = 0
    for msg_id in message_ids:
        try:
            gmail_service.users().messages().modify(
                userId=user_email,
                id=msg_id,
                body={"addLabelIds": [label_id]},
            ).execute()
            successful += 1
        except Exception as e:
            logger.warning("Failed to label message %s with %s: %s", msg_id, label_id, e)

    return successful
