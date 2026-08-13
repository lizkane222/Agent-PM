from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import SyncDeleteRequestViewSet, SyncReviewItemViewSet

router = DefaultRouter()
router.register("items", SyncReviewItemViewSet, basename="sync-review-item")
router.register("delete-requests", SyncDeleteRequestViewSet, basename="sync-delete-request")

urlpatterns = [path("", include(router.urls))]
