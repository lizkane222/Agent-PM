"""URL configuration for the team app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

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
router.register("member-documents", TeamMemberDocumentViewSet, basename="team-member-document")

urlpatterns = [
    path("", include(router.urls)),
]
