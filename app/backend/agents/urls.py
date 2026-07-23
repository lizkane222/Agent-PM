"""URL configuration for the agents app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AgentSessionViewSet, UserListView

router = DefaultRouter()
router.register("sessions", AgentSessionViewSet, basename="agent-session")

urlpatterns = [
    path("", include(router.urls)),
    path("users/", UserListView.as_view(), name="agent-users-list"),
]
