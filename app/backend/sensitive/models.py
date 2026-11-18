"""Sensitive-text marks: a shared, per-record "hide this when I screen share" list.

A mark hides display text in the app only. The stored record, the API and exports are
unchanged, so this is a screen-share aid, NOT access control.

Matching is by snippet text, not character offsets: records are edited, offsets drift.
``text`` blank means "the whole field / line"; ``line_key`` identifies a line inside a
field that has no ids of its own (a bullet), e.g. a hash of its text.
"""

import hashlib

from django.conf import settings
from django.db import models

#: Longest hidden snippet (characters) and most marks one record may carry.
MAX_TEXT_LENGTH = 2000
MAX_MARKS_PER_RECORD = 200


def fingerprint_for(field: str, text: str, line_key: str) -> str:
    """Stable identity of a mark within a record (keeps the unique index short)."""
    raw = "\x1f".join([field, text, line_key])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class SensitiveMark(models.Model):
    resource_type = models.CharField(max_length=30, db_index=True)
    # CharField: record ids are a mix of integers and Airtable ids.
    resource_id = models.CharField(max_length=64)
    field = models.CharField(max_length=80)
    text = models.TextField(blank=True, default="")
    line_key = models.CharField(max_length=128, blank=True, default="")
    fingerprint = models.CharField(max_length=64, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="sensitive_marks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["resource_type", "resource_id", "fingerprint"],
                name="sensitive_mark_unique",
            )
        ]
        indexes = [models.Index(fields=["resource_type", "resource_id"])]

    def save(self, *args, **kwargs):
        self.fingerprint = fingerprint_for(self.field, self.text, self.line_key)
        super().save(*args, **kwargs)
