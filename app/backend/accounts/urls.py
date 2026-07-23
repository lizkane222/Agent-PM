"""URL configuration for the accounts app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AccountArtifactViewSet, AccountNoteViewSet, AccountProjectViewSet, AccountQuickLinkViewSet, AccountViewSet, AdminAccountView, CustomerContactNoteViewSet, CustomerContactViewSet

router = DefaultRouter()
router.register("accounts", AccountViewSet, basename="account")
router.register("notes", AccountNoteViewSet, basename="account-note")
router.register("artifacts", AccountArtifactViewSet, basename="account-artifact")
router.register("quick-links", AccountQuickLinkViewSet, basename="account-quick-link")
router.register("contacts", CustomerContactViewSet, basename="customer-contact")
router.register("contact-notes", CustomerContactNoteViewSet, basename="customer-contact-note")
router.register("projects", AccountProjectViewSet, basename="account-project")

urlpatterns = [
    path("", include(router.urls)),
    path("admin-account/", AdminAccountView.as_view(), name="admin-account"),
]
