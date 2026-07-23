from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import PageLayoutViewSet, UserPageNoteViewSet, WorkingSessionViewSet

# Use a single router for sub-resources so there is no duplicate api-root
# pattern that could shadow the working-sessions list URL.
sub_router = DefaultRouter()
sub_router.register("working-sessions", WorkingSessionViewSet, basename="working-sessions")
sub_router.register("page-notes", UserPageNoteViewSet, basename="page-notes")

# The main layout router uses prefix "" which generates a greedy
# ^(?P<pk>[^/.]+)/$ detail pattern.  By including sub_router urls under
# an explicit "working-sessions" prefix and "page-notes" prefix we guarantee
# those paths are resolved before Django ever reaches the main router.
main_router = DefaultRouter()
main_router.register("", PageLayoutViewSet, basename="layouts")

urlpatterns = [
    # Sub-resources listed first so they win over the greedy pk pattern.
    path("working-sessions/", include([
        path("", WorkingSessionViewSet.as_view({"get": "list", "post": "create"}), name="working-sessions-list"),
        path("<int:pk>/", WorkingSessionViewSet.as_view({"get": "retrieve", "patch": "partial_update", "put": "update", "delete": "destroy"}), name="working-sessions-detail"),
    ])),
    path("page-notes/", include([
        path("", UserPageNoteViewSet.as_view({"get": "list", "post": "create"}), name="page-notes-list"),
        path("<int:pk>/", UserPageNoteViewSet.as_view({"get": "retrieve", "patch": "partial_update", "put": "update", "delete": "destroy"}), name="page-notes-detail"),
    ])),
    # Main layout routes (greedy detail pattern comes after explicit ones above).
    path("", include(main_router.urls)),
]
