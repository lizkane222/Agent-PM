from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AppletPinViewSet, AppletViewSet

router = DefaultRouter()
router.register("applets", AppletViewSet, basename="applet")
router.register("pins", AppletPinViewSet, basename="applet-pin")

urlpatterns = [
    path("", include(router.urls)),
]
