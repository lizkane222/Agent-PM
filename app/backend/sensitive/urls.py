from django.urls import path

from .views import MarkDetailView, MarkListCreateView

urlpatterns = [
    path("marks/", MarkListCreateView.as_view()),
    path("marks/<int:pk>/", MarkDetailView.as_view()),
]
