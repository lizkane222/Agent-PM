"""API views for the team app."""

from zoneinfo import available_timezones

from django.db import models
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response


from core.mixins import _staff_sees_all, admin_wants_all, is_admin
from core.pagination import ClientPageSizePagination
from .models import Tag, Team, TeamMember, TeamMemberDocument, TeamMembership, UserProfile
from .serializers import (
    TagSerializer,
    TeamMemberDocumentSerializer,
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
        # Regular users only see their own profile; Admins can see all (unless override disabled).
        if _staff_sees_all(self.request.user):
            return UserProfile.objects.select_related("user").all()
        return UserProfile.objects.filter(user=self.request.user).select_related("user")

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        # The generic detail routes are read-only for someone else's profile: edits to your own
        # go through /me/, and an Admin changes another user's tier via /access-level/.
        if request.method not in SAFE_METHODS and obj.user_id != request.user.pk:
            raise PermissionDenied("You can only edit your own profile.")

    @action(detail=False, methods=["get"], url_path="directory")
    def directory(self, request):
        """GET /team/profiles/directory/?search= — Admin-only user search with access levels.

        Lists every login (creating the profile lazily, as /me/ does), so a user who has
        never opened Settings can still be found and promoted.
        """
        if not is_admin(request.user):
            raise PermissionDenied("Only Admins can manage user access.")
        from django.contrib.auth import get_user_model

        User = get_user_model()
        q = (request.query_params.get("search") or "").strip()
        users = User.objects.filter(is_active=True).select_related("profile").order_by("first_name", "username")
        if q:
            users = users.filter(
                models.Q(username__icontains=q) | models.Q(email__icontains=q)
                | models.Q(first_name__icontains=q) | models.Q(last_name__icontains=q)
                | models.Q(profile__display_name__icontains=q)
            )
        out = []
        for u in users[:50]:
            profile = getattr(u, "profile", None) or UserProfile.objects.get_or_create(user=u)[0]
            out.append({
                "profile_id": profile.pk,
                "user_id": u.pk,
                "username": u.username,
                "email": u.email,
                "display_name": profile.display_name or u.get_full_name() or u.username,
                "access_level": profile.access_level,
                "is_self": u.pk == request.user.pk,
            })
        return Response({"results": out})

    @action(detail=True, methods=["patch"], url_path="access-level")
    def access_level(self, request, pk=None):
        """PATCH /team/profiles/<id>/access-level/ {access_level} — Admin only."""
        if not is_admin(request.user):
            raise PermissionDenied("Only Admins can change access levels.")
        profile = get_object_or_404(UserProfile.objects.select_related("user"), pk=pk)
        level = request.data.get("access_level")
        if level not in dict(UserProfile.ACCESS_LEVEL_CHOICES):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"access_level": "Must be basic, pm or admin."})
        if profile.user_id == request.user.pk and level != UserProfile.ACCESS_ADMIN:
            # Otherwise the last Admin can lock everyone out of access management.
            remaining = UserProfile.objects.filter(access_level=UserProfile.ACCESS_ADMIN).exclude(pk=profile.pk)
            if not remaining.exists():
                raise PermissionDenied("You are the only Admin — promote someone else first.")
        before = profile.access_level
        if before != level:
            profile.access_level = level
            profile.save(update_fields=["access_level", "updated_at"])
            from realtime.sync import publish_activity_event
            publish_activity_event(
                request.user, "user.access_level",
                f"**Access changed** for {profile.user.username}",
                detail=f"{before} → {level}",
                metadata={"profile_id": profile.pk, "user_id": profile.user_id, "from": before, "to": level},
            )
        return Response({"profile_id": profile.pk, "access_level": profile.access_level})

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

    @action(detail=False, methods=["get", "put"], url_path="gmail-keywords", permission_classes=[IsAuthenticated])
    def gmail_keywords(self, request):
        """
        Get/set global Gmail default keywords (staff only).

        GET /api/v1/team/profiles/gmail-keywords/
        Returns: { keywords: [str] }

        PUT /api/v1/team/profiles/gmail-keywords/
        Body: { keywords: [str] }
        Returns: { keywords: [str] }
        """
        if not request.user.is_staff:
            raise PermissionDenied("Staff only.")

        from django.conf import settings

        if request.method == "GET":
            keywords = getattr(settings, "GMAIL_DEFAULT_KEYWORDS", [])
            return Response({"keywords": keywords})

        # PUT — update settings (in-memory only for this session; would need env var persistence for prod)
        keywords = request.data.get("keywords", [])
        if not isinstance(keywords, list):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("keywords must be a list")
        if not all(isinstance(k, str) for k in keywords):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("All keywords must be strings")
        if len(keywords) > 100:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Too many keywords (max 100)")

        # In production, this would write to a database setting or env var
        # For now, update the settings object in-memory (won't persist across restarts)
        settings.GMAIL_DEFAULT_KEYWORDS = keywords
        import logging
        logging.getLogger(__name__).info(
            "Gmail default keywords updated by %s: %s", request.user.email, keywords
        )
        return Response({"keywords": keywords})


class TeamViewSet(viewsets.ReadOnlyModelViewSet):
    """Teams the current user belongs to. Scoped by TeamMembership."""

    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if _staff_sees_all(self.request.user) or admin_wants_all(self.request):
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
        if admin_wants_all(self.request):
            return TeamMembership.objects.select_related("user__profile", "team").all()
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


# What a member may change on their own TeamMember record (everything else is Admin-only).
SELF_EDITABLE_FIELDS = {"full_name", "slack_handle", "avatar_url", "additional_emails"}


class TeamMemberViewSet(viewsets.ModelViewSet):
    """Team members scoped to teams the current user belongs to."""

    serializer_class = TeamMemberSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ClientPageSizePagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["full_name", "email", "title", "department", "slack_handle"]
    ordering_fields = ["full_name", "joined_at", "department", "status"]
    ordering = ["full_name"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # TeamMember records represent shared org data (department, manager,
        # linked Django user). Only staff may create/update/delete them.
        # The `documents` action is exempt — it enforces its own self-or-staff
        # check, since a member may add docs to their own profile.
        if getattr(self, "action", None) in ("documents", "assign_timezone", "add_email"):
            return
        if request.method in SAFE_METHODS or is_admin(request.user):
            return
        # A member may edit their own card, but only the personal fields: the title,
        # department, manager and login link decide how the org sees them.
        if request.method in ("PUT", "PATCH") and self._is_own_record(request):
            blocked = set(request.data.keys()) - SELF_EDITABLE_FIELDS
            if not blocked:
                return
            raise PermissionDenied("Only an Admin may change: " + ", ".join(sorted(blocked)) + ".")
        raise PermissionDenied("Only Admins may modify team members.")

    def _is_own_record(self, request) -> bool:
        pk = self.kwargs.get("pk")
        return bool(pk) and TeamMember.objects.filter(pk=pk, user=request.user).exists()

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
        qs = qs.prefetch_related("tags").select_related("manager", "user", "user__profile", "assigned_timezone_by")
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

    @action(detail=True, methods=["post"], url_path="add-email")
    def add_email(self, request, pk=None):
        """
        Record another address for a team member (e.g. the Segment address a colleague was invited
        under), so a calendar guest using it is recognised as them. Body: {"email": "..."}.

        PM and above, or the member themselves: an address decides who a guest "is", so a Basic user
        cannot attach one to someone else. Unscoped lookup like `assign_timezone` (the chip is already
        on the account). An address another member already uses is refused, never moved.
        """
        from core.mixins import is_pm_or_above
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.core.validators import validate_email
        from team.emails import all_emails

        member = get_object_or_404(TeamMember.objects.select_related("user", "manager"), pk=pk)
        if not (is_pm_or_above(request.user) or member.user_id == request.user.id):
            raise PermissionDenied("Only a PM or Admin can add an email address to someone else.")
        raw = request.data.get("email")
        email = raw.strip().lower() if isinstance(raw, str) else ""
        try:
            validate_email(email)
        except DjangoValidationError:
            return Response({"email": ["Enter a valid email address."]}, status=400)
        if email in {e.lower() for e in all_emails(member)}:
            return Response(self.get_serializer(member).data)
        clash = TeamMember.objects.exclude(pk=member.pk).filter(
            models.Q(email__iexact=email) | models.Q(additional_emails__icontains=f'"{email}"')
        )
        if clash.exists():
            return Response({"email": ["Another team member already uses this address."]}, status=409)
        if len(member.additional_emails or []) >= 10:
            return Response({"email": ["At most 10 additional addresses."]}, status=400)
        member.additional_emails = [*(member.additional_emails or []), email]
        member.save(update_fields=["additional_emails", "updated_at"])
        from airtable_sync.team_push import push_member
        push_member(member)
        return Response(self.get_serializer(member).data)

    @action(detail=True, methods=["post"], url_path="assign-timezone")
    def assign_timezone(self, request, pk=None):
        """
        Record a time zone for a colleague who has not set their own.

        Precedence: the person's own profile zone always wins, so nothing can be assigned while
        it is set. An assignment can only be changed or cleared (blank `timezone`) by whoever made
        it, or an Admin. Looked up unscoped like `documents`: the chip is already on the account.
        """
        member = get_object_or_404(
            TeamMember.objects.select_related("user", "user__profile", "assigned_timezone_by"), pk=pk
        )
        if member.user_id == request.user.id:
            raise PermissionDenied("Set your own time zone in Settings.")
        zone = str(request.data.get("timezone", "") or "").strip()
        if zone and zone not in available_timezones():
            return Response({"timezone": ["Unknown time zone."]}, status=400)
        _, source = member.timezone_with_source()
        if source == "self":
            return Response(
                {"detail": "This person has set their own time zone; it cannot be assigned."},
                status=409,
            )
        if source == "assigned":
            if not (member.assigned_timezone_by_id == request.user.id or is_admin(request.user)):
                return Response({"detail": "A time zone is already set for this person."}, status=409)
        elif not zone:
            return Response({"timezone": ["Choose a time zone."]}, status=400)
        before = member.assigned_timezone
        member.assigned_timezone = zone
        member.assigned_timezone_by = request.user if zone else None
        member.assigned_timezone_at = timezone.now() if zone else None
        member.save(update_fields=["assigned_timezone", "assigned_timezone_by", "assigned_timezone_at", "updated_at"])
        if before != zone:
            from realtime.sync import publish_activity_event

            try:
                publish_activity_event(
                    request.user,
                    "team_member.timezone_assigned",
                    f"**Time zone** for {member.full_name} " + (f'set to "{zone}"' if zone else f'cleared (was "{before}")'),
                    detail=member.full_name,
                    metadata={"resource": {"type": "team_member", "id": str(member.pk)}, "from": before, "to": zone},
                )
            except Exception:  # noqa: BLE001 - the log must never fail the save
                pass
        return Response(self.get_serializer(member).data)

    @action(detail=True, methods=["get", "post"], url_path="documents")
    def documents(self, request, pk=None):
        """
        Linked docs on a member's profile (e.g. an out-of-office coverage doc).

        Visible to any authenticated user regardless of the normal TeamMember
        visibility scoping — the point is that anyone can look it up later — so
        this looks the member up unscoped rather than via get_object().
        """
        member = get_object_or_404(TeamMember, pk=pk)
        if request.method == "POST":
            if not (request.user.is_staff or member.user_id == request.user.id):
                raise PermissionDenied("You can only add documents to your own profile.")
            serializer = TeamMemberDocumentSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(team_member=member, added_by=request.user)
            return Response(serializer.data, status=201)
        docs = member.documents.select_related("added_by__profile").all()
        return Response(TeamMemberDocumentSerializer(docs, many=True).data)


class TeamMemberDocumentViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Edit/remove a linked doc — only the owning member or staff may reach one."""

    serializer_class = TeamMemberDocumentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = TeamMemberDocument.objects.select_related("team_member", "added_by__profile")
        if _staff_sees_all(self.request.user):
            return qs
        return qs.filter(team_member__user=self.request.user)
