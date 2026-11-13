"""Skills pinned to app pages, and the skill-run Console API."""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import admin_wants_all, is_admin
from core.pagination import ClientPageSizePagination

from .models import AgentSkill, SkillPagePin, SkillRun
from .serializers import AgentSkillSerializer, SkillRunDetailSerializer, SkillRunSerializer

VALID_PAGES = {key for key, _ in SkillPagePin.PAGES}


def runnable_skills(user):
    """Skills this user may pin and run: approved, and theirs or public (what `load_skill` allows)."""
    from agents.mcp_server import _skill_scope

    return _skill_scope(user)


def _pin_view(pin: SkillPagePin, user, request) -> dict:
    everyone = pin.user_id is None
    return {
        "id": pin.pk,
        "page": pin.page,
        "scope": "everyone" if everyone else "mine",
        "can_remove": is_admin(user) if everyone else True,
        "skill": AgentSkillSerializer(pin.skill, context={"request": request}).data,
    }


class PagePinListCreate(APIView):
    """GET ?page= → pins shown on that page for me. POST → pin a skill (admins may pin for everyone)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        page = request.query_params.get("page", "")
        if page not in VALID_PAGES:
            return Response({"detail": "Unknown page."}, status=status.HTTP_400_BAD_REQUEST)
        allowed = set(runnable_skills(request.user).values_list("pk", flat=True))
        pins = (SkillPagePin.objects.filter(page=page).filter(Q(user=request.user) | Q(user__isnull=True))
                .select_related("skill").prefetch_related("skill__attachments"))
        # An everyone-pin wins over a personal pin of the same skill, so it never shows twice.
        everyone_skills = {p.skill_id for p in pins if p.user_id is None}
        shown = [p for p in pins if p.skill_id in allowed and (p.user_id is None or p.skill_id not in everyone_skills)]
        return Response({"results": [_pin_view(p, request.user, request) for p in shown]})

    def post(self, request):
        page = request.data.get("page")
        if page not in VALID_PAGES:
            return Response({"detail": "Unknown page."}, status=status.HTTP_400_BAD_REQUEST)
        everyone = request.data.get("everyone", False)
        if not isinstance(everyone, bool):
            return Response({"detail": "everyone must be true or false."}, status=status.HTTP_400_BAD_REQUEST)
        if everyone and not is_admin(request.user):
            raise PermissionDenied("Only admins can pin a skill for everyone.")
        skill = runnable_skills(request.user).filter(pk=request.data.get("skill_id")).first() \
            if str(request.data.get("skill_id", "")).isdigit() else None
        if skill is None:
            return Response({"detail": "That skill isn't available to pin."}, status=status.HTTP_404_NOT_FOUND)

        owner = None if everyone else request.user
        existing_everyone = SkillPagePin.objects.filter(skill=skill, page=page, user__isnull=True).first()
        if existing_everyone is not None:
            pin, created = existing_everyone, False        # already on this page for everyone
        else:
            pin, created = SkillPagePin.objects.get_or_create(
                user=owner, skill=skill, page=page, defaults={"created_by": request.user})
        return Response(_pin_view(pin, request.user, request),
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class PagePinDetail(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        pin = SkillPagePin.objects.filter(pk=pk).filter(Q(user=request.user) | Q(user__isnull=True)).first()
        if pin is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if pin.user_id is None and not is_admin(request.user):
            raise PermissionDenied("Only admins can remove a skill that's pinned for everyone.")
        pin.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SkillRunViewSet(viewsets.ReadOnlyModelViewSet):
    """The Console: a user's skill runs, newest first. Admins may add `?scope=all`."""

    permission_classes = [IsAuthenticated]
    pagination_class = ClientPageSizePagination

    def get_queryset(self):
        qs = SkillRun.objects.select_related("user")
        if not admin_wants_all(self.request):
            qs = qs.filter(user=self.request.user)
        if self.action == "retrieve":
            qs = qs.prefetch_related("events")
        skill = self.request.query_params.get("skill")
        if skill and skill.isdigit():
            qs = qs.filter(skill_id=int(skill))
        return qs

    def get_serializer_class(self):
        return SkillRunDetailSerializer if self.action == "retrieve" else SkillRunSerializer

    @action(detail=True, methods=["get"], url_path="data")
    def data(self, request, pk=None):
        """
        One page of the data staged for a run (see run_assembly.PROMPT_INLINE_LIMIT).

        Owner only, with no admin widening: this is the content of the caller's own lookups and
        attachments. `?part=N` (1-based, default 1). The answer says how many parts there are.
        """
        try:
            run = SkillRun.objects.get(pk=pk, user=request.user)
        except (SkillRun.DoesNotExist, ValueError, DjangoValidationError):
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        parts = run.data_parts or []
        raw = request.query_params.get("part", "1")
        if not str(raw).isdigit():
            return Response({"detail": "part must be a whole number starting at 1."}, status=status.HTTP_400_BAD_REQUEST)
        number = int(raw)
        if not parts:
            return Response({"detail": "This run has no staged data."}, status=status.HTTP_404_NOT_FOUND)
        if not 1 <= number <= len(parts):
            return Response({"detail": f"part must be between 1 and {len(parts)}."}, status=status.HTTP_400_BAD_REQUEST)
        part = parts[number - 1]
        return Response({
            "run_id": str(run.pk), "part": number, "parts": len(parts), "label": part.get("label", ""),
            "text": part.get("text", ""), "characters": len(part.get("text", "")), "has_more": number < len(parts),
        })
