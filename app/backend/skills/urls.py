"""URL configuration for the skills app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AgentSkillViewSet, ClaudeSkillViewSet, SkillInvocationViewSet

router = DefaultRouter()
router.register("skills",       ClaudeSkillViewSet,      basename="skill")
router.register("agent-skills", AgentSkillViewSet,       basename="agent-skill")
router.register("invocations",  SkillInvocationViewSet,  basename="skill-invocation")

urlpatterns = [
    path("", include(router.urls)),
]
