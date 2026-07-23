import logging
from django.conf import settings
from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from .models import Applet
from .serializers import AppletSerializer
from .write_back import push_applet_create, push_applet_update, push_applet_delete

logger = logging.getLogger(__name__)

class AppletViewSet(viewsets.ModelViewSet):
    serializer_class = AppletSerializer
    permission_classes = [IsAuthenticated]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        # Non-safe methods require the caller to be the applet submitter or staff.
        if request.method not in SAFE_METHODS:
            user = request.user
            if not user.is_staff and obj.submitted_by_id != getattr(user, "pk", None):
                raise PermissionDenied("You do not have permission to modify this applet.")

    def get_queryset(self):
        qs = Applet.objects.all()
        category = self.request.query_params.get("category")
        item_type = self.request.query_params.get("type")
        author = self.request.query_params.get("author")
        search = self.request.query_params.get("search")
        if category:
            qs = qs.filter(category=category)
        if item_type:
            qs = qs.filter(type=item_type)
        if author:
            qs = qs.filter(author=author)
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(description__icontains=search) |
                Q(author__icontains=search) |
                Q(tags__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        applet = serializer.save(submitted_by=self.request.user)
        airtable_id = push_applet_create(applet)
        if airtable_id:
            applet.airtable_id = airtable_id
            applet.save(update_fields=["airtable_id"])

    def perform_update(self, serializer):
        applet = serializer.save()
        push_applet_update(applet)

    def perform_destroy(self, instance):
        airtable_id = instance.airtable_id
        instance.delete()
        push_applet_delete(airtable_id)
