from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("accounts", views.AirtableAccountViewSet, basename="airtable-accounts")
router.register("action-items", views.AirtableActionItemViewSet, basename="airtable-action-items")
router.register("meetings", views.AirtableMeetingViewSet, basename="airtable-meetings")

urlpatterns = [
    path("action-items/field-options/", views.action_item_field_options, name="airtable-action-item-field-options"),
    path("", include(router.urls)),
    path("match/", views.match_event, name="airtable-match-event"),
    path("categorize/", views.categorize_event, name="airtable-categorize-event"),
    path("event-link/", views.get_event_link, name="airtable-event-link"),
    path("event-links/batch/", views.batch_event_links, name="airtable-event-links-batch"),
    path("action-items/<str:airtable_id>/status/", views.update_action_item_status, name="airtable-action-item-status"),
    path("action-items/<str:airtable_id>/fields/", views.update_action_item_fields, name="airtable-action-item-fields"),
    path("meetings/by-event/<int:event_id>/gong-notes/", views.update_meeting_gong_notes, name="airtable-meeting-gong-notes"),
    path("meetings/<int:meeting_id>/gong-notes/", views.update_meeting_gong_notes_by_pk, name="airtable-meeting-gong-notes-by-pk"),
    path("time-logs/", views.log_time, name="airtable-time-log"),
    path("sync/", views.trigger_sync, name="airtable-sync"),
]
