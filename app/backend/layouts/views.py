from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response

from .models import LayoutInteraction, PageLayout, UserPageNote, WorkingSession
from .serializers import PageLayoutSerializer, UserPageNoteSerializer, WorkingSessionSerializer


class PageLayoutViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = PageLayoutSerializer

    def get_queryset(self):
        user = self.request.user
        # Show public layouts + the user's own private ones
        return PageLayout.objects.filter(
            Q(is_public=True) | Q(creator=user)
        ).prefetch_related("interactions", "forks")

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        # Non-safe methods (PATCH/PUT/DELETE) require the caller to be the
        # layout's creator or a staff user. Public layouts are readable by
        # everyone but must not be mutable by non-owners.
        if request.method not in SAFE_METHODS:
            user = request.user
            if not user.is_staff and obj.creator_id != getattr(user, "pk", None):
                raise PermissionDenied("You do not have permission to modify this layout.")

    def perform_create(self, serializer):
        serializer.save(creator=self.request.user)

    @action(detail=True, methods=["post"])
    def fork(self, request, pk=None):
        original = self.get_object()
        name = request.data.get("name") or f"{original.name} (fork)"
        forked = PageLayout.objects.create(
            name=name,
            creator=request.user,
            forked_from=original,
            nodes=original.nodes,
            is_public=True,
        )
        serializer = self.get_serializer(forked)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def heart(self, request, pk=None):
        layout = self.get_object()
        interaction, _ = LayoutInteraction.objects.get_or_create(
            layout=layout, user=request.user
        )
        interaction.hearted = not interaction.hearted
        interaction.save(update_fields=["hearted", "updated_at"])
        return Response({"hearted": interaction.hearted, "heart_count": layout.heart_count})

    @action(detail=True, methods=["post"])
    def pin(self, request, pk=None):
        layout = self.get_object()
        interaction, _ = LayoutInteraction.objects.get_or_create(
            layout=layout, user=request.user
        )
        interaction.pinned = not interaction.pinned
        interaction.save(update_fields=["pinned", "updated_at"])
        return Response({"pinned": interaction.pinned})

    @action(detail=False, methods=["get"])
    def pinned(self, request):
        """Return all layouts the current user has pinned."""
        ids = LayoutInteraction.objects.filter(
            user=request.user, pinned=True
        ).values_list("layout_id", flat=True)
        qs = PageLayout.objects.filter(id__in=ids).prefetch_related("interactions", "forks")
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


class WorkingSessionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = WorkingSessionSerializer

    def get_queryset(self):
        return WorkingSession.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        from airtable_sync.write_back import push_working_session_create
        instance = serializer.save(owner=self.request.user)
        at_id = push_working_session_create(instance)
        if at_id:
            instance.airtable_id = at_id
            instance.save(update_fields=["airtable_id"])

    def perform_update(self, serializer):
        from airtable_sync.write_back import push_working_session_update
        instance = serializer.save()
        push_working_session_update(instance)

    def perform_destroy(self, instance):
        from airtable_sync.write_back import push_working_session_delete
        at_id = instance.airtable_id
        instance.delete()
        if at_id:
            push_working_session_delete(at_id)


class UserPageNoteViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = UserPageNoteSerializer

    def get_queryset(self):
        return UserPageNote.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
