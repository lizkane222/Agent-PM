from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AppletViewSet

router = DefaultRouter()
router.register("applets", AppletViewSet, basename="applet")

urlpatterns = [
    path("", include(router.urls)),
]
