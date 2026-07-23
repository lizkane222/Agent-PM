"""
SegmentTrackMixin — drop this into any DRF ModelViewSet to get automatic
Segment tracking on create / update / destroy with no extra boilerplate.

Usage:
    class MyViewSet(SegmentTrackMixin, viewsets.ModelViewSet):
        segment_resource = "My Resource"   # human label, e.g. "Action Item"
        ...

The mixin reads `segment_resource` from the class.  If not set it falls
back to the model's verbose name.  Override `segment_properties(instance)`
to attach extra properties.
"""

from __future__ import annotations

from typing import Any

from . import segment


class SegmentTrackMixin:
    segment_resource: str = ""

    def _seg_user_id(self) -> str | None:
        request = getattr(self, "request", None)
        user = getattr(request, "user", None)
        if user and user.is_authenticated:
            return str(user.pk)
        return None

    def _resource_label(self) -> str:
        if self.segment_resource:
            return self.segment_resource
        try:
            return self.get_queryset().model._meta.verbose_name.title()
        except Exception:
            return "Resource"

    def segment_properties(self, instance: Any) -> dict[str, Any]:
        props: dict[str, Any] = {}
        for attr in ("id", "pk"):
            v = getattr(instance, attr, None)
            if v is not None:
                props["id"] = v
                break
        for attr in ("name", "title", "task", "company_name", "subject", "body"):
            v = getattr(instance, attr, None)
            if v:
                props["name"] = str(v)
                break
        for attr in ("status", "priority", "account_name"):
            v = getattr(instance, attr, None)
            if v:
                props[attr] = str(v)
        return props

    def perform_create(self, serializer):
        super().perform_create(serializer)  # type: ignore[misc]
        user_id = self._seg_user_id()
        if user_id:
            segment.track(user_id, f"{self._resource_label()} Created",
                          self.segment_properties(serializer.instance))

    def perform_update(self, serializer):
        super().perform_update(serializer)  # type: ignore[misc]
        user_id = self._seg_user_id()
        if user_id:
            segment.track(user_id, f"{self._resource_label()} Updated",
                          self.segment_properties(serializer.instance))

    def perform_destroy(self, instance):
        props = self.segment_properties(instance)
        super().perform_destroy(instance)  # type: ignore[misc]
        user_id = self._seg_user_id()
        if user_id:
            segment.track(user_id, f"{self._resource_label()} Deleted", props)
