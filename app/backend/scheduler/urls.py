"""URL configuration for the scheduler app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ActionItemViewSet, CalendarEventViewSet, MeetingNoteViewSet, ReminderViewSet, TaskViewSet

router = DefaultRouter()
router.register("events", CalendarEventViewSet, basename="calendar-event")
router.register("action-items", ActionItemViewSet, basename="action-item")
router.register("tasks", TaskViewSet, basename="task")
router.register("reminders", ReminderViewSet, basename="reminder")
router.register("meeting-notes", MeetingNoteViewSet, basename="meeting-note")

urlpatterns = [
    path("", include(router.urls)),
]
