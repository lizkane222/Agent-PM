"""URL configuration for the skills app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .page_views import PagePinDetail, PagePinListCreate, SkillRunViewSet
from .views import AgentSkillViewSet, ClaudeSkillViewSet, SkillInvocationViewSet, VoiceLaunchView

router = DefaultRouter()
router.register("skills",       ClaudeSkillViewSet,      basename="skill")
router.register("agent-skills", AgentSkillViewSet,       basename="agent-skill")
router.register("invocations",  SkillInvocationViewSet,  basename="skill-invocation")
router.register("runs",         SkillRunViewSet,         basename="skill-run")

urlpatterns = [
    path("page-pins/", PagePinListCreate.as_view(), name="skill-page-pins"),
    path("page-pins/<int:pk>/", PagePinDetail.as_view(), name="skill-page-pin"),
    path("voice-launch/", VoiceLaunchView.as_view(), name="skill-voice-launch"),
    path("", include(router.urls)),
]
