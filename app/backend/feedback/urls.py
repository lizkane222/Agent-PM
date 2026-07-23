from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FeedbackCommentViewSet, FeedbackViewSet

router = DefaultRouter()
router.register("feedback", FeedbackViewSet, basename="feedback")
router.register("comments", FeedbackCommentViewSet, basename="feedback-comment")

urlpatterns = [path("", include(router.urls))]
