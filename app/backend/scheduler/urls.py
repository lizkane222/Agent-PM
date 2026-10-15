"""URL configuration for the scheduler app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .availability import availability
from .test_notifications import send_test_notifications
from .views import ActionItemViewSet, CalendarEventViewSet, MeetingNoteViewSet, ReminderViewSet, TaskViewSet

router = DefaultRouter()
router.register("events", CalendarEventViewSet, basename="calendar-event")
router.register("action-items", ActionItemViewSet, basename="action-item")
router.register("tasks", TaskViewSet, basename="task")
router.register("reminders", ReminderViewSet, basename="reminder")
router.register("meeting-notes", MeetingNoteViewSet, basename="meeting-note")

urlpatterns = [
    # Before the router so "availability" is never read as a viewset route.
    path("availability/", availability, name="calendar-availability"),
    path("notifications/test/", send_test_notifications, name="test-notifications"),
    path("", include(router.urls)),
]
