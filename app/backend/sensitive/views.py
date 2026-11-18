"""Sensitive-mark API. See ``models.py`` for what a mark is (and is not).

Permission rule: anyone who can see the record may read, add or remove its marks (shared,
last write wins). A record the caller cannot see -- or that does not exist, or whose type
is unknown -- answers 404 from POST/DELETE and is simply omitted from the batched list, so
nothing distinguishes "hidden from you" from "not there".

The hidden text is returned ONLY by the list route and by POST/DELETE of the mark itself;
it is never written to the activity log, notifications, error messages or server logs.
"""

from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.query_params import csv_params

from .models import MAX_MARKS_PER_RECORD, MAX_TEXT_LENGTH, SensitiveMark, fingerprint_for
from .visibility import RESOURCE_TYPES, can_see, label_for

#: Upper bound on ``?resource_ids=`` (same as the comments summary route).
SUMMARY_MAX_IDS = 500


def _serialize(m: SensitiveMark) -> dict:
    return {"id": m.id, "field": m.field, "text": m.text, "line_key": m.line_key}


def _log(user, kind: str, resource_type: str, resource_id) -> None:
    """Activity event with the record label only -- never the hidden text."""
    try:
        from realtime.models import AgentActivityEvent

        verb = "Hid text on" if kind == "sensitive.marked" else "Unhid text on"
        AgentActivityEvent.objects.create(
            user=user,
            event_type="account",
            title=f"{verb} {label_for(resource_type, resource_id)}",
            detail="",
            metadata={
                "kind": kind,
                "resource_type": resource_type,
                "resource_id": str(resource_id),
            },
        )
    except Exception:  # an audit failure must not undo the user's action
        pass


class MarkListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        rtype = request.query_params.get("resource_type", "")
        if rtype not in RESOURCE_TYPES:
            raise ValidationError("Unknown resource_type.")
        ids = [i[:64] for i in csv_params(request.query_params.get("resource_ids"))]
        if not ids:
            return Response({"results": {}})
        if len(ids) > SUMMARY_MAX_IDS:
            raise ValidationError(f"At most {SUMMARY_MAX_IDS} resource_ids per request.")
        rows = SensitiveMark.objects.filter(resource_type=rtype, resource_id__in=set(ids))
        present = {r.resource_id for r in rows}
        visible = {rid for rid in present if can_see(request.user, rtype, rid)}
        results: dict[str, list] = {}
        for m in rows:
            if m.resource_id in visible:
                results.setdefault(m.resource_id, []).append(_serialize(m))
        return Response({"results": results})

    def post(self, request):
        data = request.data
        rtype = str(data.get("resource_type") or "")
        rid = str(data.get("resource_id") or "")
        field = str(data.get("field") or "").strip()
        text = data.get("text") or ""
        line_key = str(data.get("line_key") or "")
        if not isinstance(text, str):
            raise ValidationError("text must be a string.")
        if not can_see(request.user, rtype, rid):
            raise NotFound()
        if not field or len(field) > 80:
            raise ValidationError("field is required (max 80 characters).")
        if len(text) > MAX_TEXT_LENGTH:
            raise ValidationError(f"text may be at most {MAX_TEXT_LENGTH} characters.")
        if len(line_key) > 128:
            raise ValidationError("line_key is too long.")
        if text != "" and not text.strip():
            raise ValidationError("text must not be only whitespace.")
        fp = fingerprint_for(field, text, line_key)
        existing = SensitiveMark.objects.filter(
            resource_type=rtype, resource_id=rid, fingerprint=fp
        ).first()
        if existing:
            return Response(_serialize(existing), status=200)
        if SensitiveMark.objects.filter(resource_type=rtype, resource_id=rid).count() >= MAX_MARKS_PER_RECORD:
            raise ValidationError(f"A record can carry at most {MAX_MARKS_PER_RECORD} hidden items.")
        mark = SensitiveMark.objects.create(
            resource_type=rtype, resource_id=rid, field=field, text=text,
            line_key=line_key, created_by=request.user,
        )
        _log(request.user, "sensitive.marked", rtype, rid)
        return Response(_serialize(mark), status=201)


class MarkDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk: int):
        mark = SensitiveMark.objects.filter(pk=pk).first()
        if mark is None or not can_see(request.user, mark.resource_type, mark.resource_id):
            raise NotFound()
        rtype, rid = mark.resource_type, mark.resource_id
        mark.delete()
        _log(request.user, "sensitive.unmarked", rtype, rid)
        return Response(status=204)
