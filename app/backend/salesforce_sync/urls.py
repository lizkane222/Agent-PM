from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("accounts", views.SalesforceAccountViewSet, basename="sf-accounts")
router.register("projects", views.SalesforceProjectViewSet, basename="sf-projects")
router.register("tasks", views.SalesforceTaskViewSet, basename="sf-tasks")
router.register("time-entries", views.SalesforceTimeEntryViewSet, basename="sf-time-entries")

urlpatterns = [
    path("", include(router.urls)),
    path("log-time/", views.log_time, name="sf-log-time"),
    path("log-time-assignments/", views.log_time_day_assignments, name="sf-log-time-assignments"),
    path("chatter/", views.post_chatter, name="sf-chatter"),
    path("sync/", views.trigger_sync, name="sf-sync"),
    path("status/", views.connection_status, name="sf-status"),
]
