"""API views for the team app."""

from django.db import models
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response


def _staff_sees_all(user) -> bool:
    """True when the user has staff-level data visibility (is_staff AND staff_view_override enabled)."""
    if not user.is_staff:
        return False
    profile = getattr(user, "profile", None)
    if profile is None:
        return True
    return profile.staff_view_override

from .models import Tag, Team, TeamMember, TeamMembership, UserProfile
from .serializers import (
    TagSerializer,
    TeamMemberSerializer,
    TeamMembershipSerializer,
    TeamSerializer,
    UserProfileSerializer,
)


def _has_airtable_collaborator_id(profile) -> bool:
    return bool(profile and profile.airtable_collaborator_id)


def _sync_airtable_collaborator(user, profile) -> None:
    try:
        from airtable_sync.team_sync import ensure_airtable_collaborator_id
        ensure_airtable_collaborator_id(user, profile)
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Airtable collaborator ID lookup failed for %s", user.email
        )


def _ensure_team_member(user, profile) -> None:
    """Upsert a TeamMember row for the logged-in user from their profile data."""
    display_name = (
        profile.display_name
        or getattr(user, "get_full_name", lambda: "")()
        or user.email.split("@")[0]
    )
    email = profile.google_account_email or user.email
    member, created = TeamMember.objects.get_or_create(
        email=email,
        defaults={
            "full_name": display_name,
            "title": profile.title or "",
            "slack_handle": profile.slack_user_id or "",
            "user": user,
            "status": "active",
        },
    )
    needs_save = False
    if not member.user_id:
        member.user = user
        needs_save = True
    if member.full_name != display_name:
        member.full_name = display_name
        needs_save = True
    if profile.title and member.title != profile.title:
        member.title = profile.title
        needs_save = True
    if profile.slack_user_id and member.slack_handle != profile.slack_user_id:
        member.slack_handle = profile.slack_user_id
        needs_save = True
    if needs_save:
        member.save()


class UserProfileViewSet(viewsets.ModelViewSet):
    """Profiles are scoped to the requesting user's own record via /me/."""

    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Regular users only see their own profile; staff can see all (unless override disabled).
        if _staff_sees_all(self.request.user):
            return UserProfile.objects.select_related("user").all()
        return UserProfile.objects.filter(user=self.request.user).select_related("user")

    @action(detail=False, methods=["get", "patch"], url_path="me")
    def me(self, request):
        profile, created = UserProfile.objects.get_or_create(user=request.user)
        if request.method == "PATCH":
            serializer = UserProfileSerializer(profile, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            profile = serializer.save()
            _ensure_team_member(request.user, profile)
            _sync_airtable_collaborator(request.user, profile)
            try:
                from analytics_tracking import segment as seg
                seg.identify(request.user.pk, {
                    "username": request.user.username,
                    "email": request.user.email,
                    "display_name": profile.display_name,
                    "title": profile.title,
                    "role": profile.role,
                    "timezone": profile.timezone,
                })
                seg.track(request.user.pk, "Profile Updated", {
                    "fields_changed": list(request.data.keys()),
                })
            except Exception:
                pass
            return Response(UserProfileSerializer(profile).data)

        # Ensure a TeamMember row exists for this user.
        _ensure_team_member(request.user, profile)

        # Resolve and cache Airtable collaborator ID on first login or if missing.
        if created or not _has_airtable_collaborator_id(profile):
            _sync_airtable_collaborator(request.user, profile)

        return Response(UserProfileSerializer(profile).data)

    @action(detail=False, methods=["post", "delete"], url_path="me/push-subscription")
    def push_subscription(self, request):
        """Save or remove the browser Web Push subscription for the current user."""
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        if request.method == "DELETE":
            profile.push_subscription = None
            profile.save(update_fields=["push_subscription"])
            return Response({"push_subscription_active": False})
        # POST — expect {"endpoint": "...", "keys": {"p256dh": "...", "auth": "..."}}
        sub = request.data
        if not (sub.get("endpoint") and sub.get("keys", {}).get("p256dh") and sub.get("keys", {}).get("auth")):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Subscription must include endpoint and keys.p256dh and keys.auth.")
        profile.push_subscription = sub
        profile.save(update_fields=["push_subscription"])
        return Response({"push_subscription_active": True})


class TeamViewSet(viewsets.ReadOnlyModelViewSet):
    """Teams the current user belongs to. Scoped by TeamMembership."""

    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if _staff_sees_all(self.request.user):
            return Team.objects.prefetch_related("memberships__user__profile").all()
        return Team.objects.filter(
            memberships__user=self.request.user
        ).prefetch_related("memberships__user__profile").distinct()


class TeamMembershipViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Memberships visible to the current user: only members of shared teams.
    Used by the React app to build teammate pickers and @mention lists.
    """

    serializer_class = TeamMembershipSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user_team_ids = self.request.user.memberships.values_list("team_id", flat=True)
        return TeamMembership.objects.filter(
            team_id__in=user_team_ids
        ).select_related("user__profile", "team")


class TagViewSet(viewsets.ModelViewSet):
    """CRUD for tags. Reads are open to authenticated users; writes are staff-only."""

    serializer_class = TagSerializer
    permission_classes = [IsAuthenticated]
    queryset = Tag.objects.all()
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "description"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Restrict every mutating verb to staff. Tags are shared across all users
        # so a non-staff rename or delete would silently affect other users' data.
        if request.method not in SAFE_METHODS and not request.user.is_staff:
            raise PermissionDenied("Only staff users may modify tags.")


class TeamMemberViewSet(viewsets.ModelViewSet):
    """Team members scoped to teams the current user belongs to."""

    serializer_class = TeamMemberSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["full_name", "email", "title", "department", "slack_handle"]
    ordering_fields = ["full_name", "joined_at", "department", "status"]
    ordering = ["full_name"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # TeamMember records represent shared org data (department, manager,
        # linked Django user). Only staff may create/update/delete them.
        if request.method not in SAFE_METHODS and not request.user.is_staff:
            raise PermissionDenied("Only staff users may modify team members.")

    def get_queryset(self):
        # Staff can see all (unless override disabled); regular users see:
        #   - their own TeamMember record
        #   - members of any shared teams
        #   - unlinked members (no Django user)
        if _staff_sees_all(self.request.user):
            qs = TeamMember.objects.all()
        else:
            user_team_ids = self.request.user.memberships.values_list("team_id", flat=True)
            qs = TeamMember.objects.filter(
                models.Q(user=self.request.user)
                | models.Q(user__memberships__team_id__in=user_team_ids)
                | models.Q(user__isnull=True)
            ).distinct()
        qs = qs.prefetch_related("tags").select_related("manager", "user")
        status_filter = self.request.query_params.get("status")
        department = self.request.query_params.get("department")
        tag = self.request.query_params.get("tag")
        if status_filter:
            qs = qs.filter(status=status_filter)
        if department:
            qs = qs.filter(department__icontains=department)
        if tag:
            qs = qs.filter(tags__name__icontains=tag)
        return qs
