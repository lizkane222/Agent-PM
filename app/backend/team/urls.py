"""URL configuration for the team app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .profile_views import (
    NotificationViewSet,
    PublicItemViewSet,
    leave_note,
    member_public_profile,
)
from .views import (
    TagViewSet,
    TeamMemberDocumentViewSet,
    TeamMemberViewSet,
    TeamMembershipViewSet,
    TeamViewSet,
    UserProfileViewSet,
)

router = DefaultRouter()
router.register("profiles", UserProfileViewSet, basename="user-profile")
router.register("teams", TeamViewSet, basename="team")
router.register("memberships", TeamMembershipViewSet, basename="team-membership")
router.register("tags", TagViewSet, basename="tag")
router.register("members", TeamMemberViewSet, basename="team-member")
router.register("notifications", NotificationViewSet, basename="notification")
router.register("public-items", PublicItemViewSet, basename="public-item")
router.register("member-documents", TeamMemberDocumentViewSet, basename="team-member-document")

urlpatterns = [
    path("members/<int:pk>/profile/", member_public_profile),
    path("members/<int:pk>/leave-note/", leave_note),
    path("", include(router.urls)),
]
