import logging

from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    SalesforceAccount,
    SalesforceProject,
    SalesforceTask,
    SalesforceTimeEntry,
    SalesforceConfig,
    LogTimeDayAssignment,
)
from .serializers import (
    SalesforceAccountSerializer,
    SalesforceProjectSerializer,
    SalesforceTaskSerializer,
    SalesforceTimeEntrySerializer,
    SalesforceConfigSerializer,
    LogTimeSerializer,
    ChatterPostSerializer,
    UpdateTaskStatusSerializer,
    LogTimeDayAssignmentSerializer,
)

logger = logging.getLogger(__name__)


def _user_sf_id(request):
    """Return the Salesforce user ID for the requesting user, or None."""
    try:
        return request.user.sf_config.sf_user_id or None
    except SalesforceConfig.DoesNotExist:
        return None


class SalesforceAccountViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SalesforceAccountSerializer

    def get_queryset(self):
        sf_user_id = _user_sf_id(self.request)
        if not sf_user_id:
            return SalesforceAccount.objects.none()
        return SalesforceAccount.objects.filter(owner_sf_id=sf_user_id)


class SalesforceProjectViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SalesforceProjectSerializer

    def get_queryset(self):
        sf_user_id = _user_sf_id(self.request)
        qs = SalesforceProject.objects.prefetch_related("members", "tasks")
        if sf_user_id:
            qs = qs.filter(owner_sf_id=sf_user_id)
        account = self.request.query_params.get("account")
        if account:
            qs = qs.filter(account__sf_id=account)
        account_name = self.request.query_params.get("account_name")
        if account_name:
            qs = qs.filter(account__name__iexact=account_name)
        return qs


class SalesforceTaskViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SalesforceTaskSerializer

    def get_queryset(self):
        sf_user_id = _user_sf_id(self.request)
        if not sf_user_id:
            return SalesforceTask.objects.none()
        qs = SalesforceTask.objects.filter(assigned_to_sf_id=sf_user_id)
        project = self.request.query_params.get("project")
        account = self.request.query_params.get("account")
        if project:
            qs = qs.filter(project__sf_id=project)
        if account:
            qs = qs.filter(account__sf_id=account)
        return qs

    @action(detail=True, methods=["patch"], url_path="status")
    def update_status(self, request, pk=None):
        task = self.get_object()
        ser = UpdateTaskStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        new_status = ser.validated_data["status"]

        # Write to Salesforce immediately
        try:
            from .write_back import update_task_status
            update_task_status(request.user, task.sf_id, new_status)
        except Exception:
            logger.exception("SF task status update failed")
            return Response({"error": "An unexpected error occurred."}, status=status.HTTP_502_BAD_GATEWAY)

        task.status = new_status
        task.save(update_fields=["status"])
        return Response(SalesforceTaskSerializer(task).data)


class SalesforceTimeEntryViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SalesforceTimeEntrySerializer

    def get_queryset(self):
        return SalesforceTimeEntry.objects.filter(user=self.request.user)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def log_time(request):
    ser = LogTimeSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data

    from .write_back import log_time as _log_time
    entry = _log_time(
        user=request.user,
        project_sf_id=d["project_sf_id"],
        task_sf_id=d.get("task_sf_id") or None,
        entry_date=d["date"],
        duration_minutes=d["duration_minutes"],
        description=d.get("description", ""),
    )
    return Response(SalesforceTimeEntrySerializer(entry).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def post_chatter(request):
    ser = ChatterPostSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data

    try:
        from .write_back import post_chatter as _post_chatter
        result = _post_chatter(
            user=request.user,
            record_id=d["record_id"],
            body=d["body"],
        )
        return Response(result, status=status.HTTP_201_CREATED)
    except Exception:
        logger.exception("Chatter post failed")
        return Response({"error": "An unexpected error occurred."}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def trigger_sync(request):
    from .sync import sync_all
    try:
        result = sync_all(request.user)
        return Response(result)
    except PermissionError:
        logger.exception("SF manual sync permission error")
        return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
    except Exception:
        logger.exception("SF manual sync failed")
        return Response({"error": "An unexpected error occurred."}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def connection_status(request):
    try:
        config = SalesforceConfig.objects.get(user=request.user)
        return Response({
            "connected": True,
            **SalesforceConfigSerializer(config).data,
        })
    except SalesforceConfig.DoesNotExist:
        return Response({"connected": False})


@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsAuthenticated])
def log_time_day_assignments(request):
    """
    GET  ?week_start=YYYY-MM-DD  — list assignments for the week
    POST  { date, project_id }   — add project to a day (idempotent)
    DELETE { date, project_id }  — remove project from a day
    """
    if request.method == "GET":
        week_start = request.query_params.get("week_start")
        qs = LogTimeDayAssignment.objects.filter(user=request.user).select_related("project")
        if week_start:
            from datetime import date, timedelta
            try:
                start = date.fromisoformat(week_start)
                end = start + timedelta(days=7)
                qs = qs.filter(date__gte=start, date__lt=end)
            except ValueError:
                pass
        return Response(LogTimeDayAssignmentSerializer(qs, many=True).data)

    if request.method == "POST":
        project_id = request.data.get("project_id")
        entry_date = request.data.get("date")
        if not project_id or not entry_date:
            return Response({"detail": "project_id and date required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            project = SalesforceProject.objects.get(pk=project_id)
        except SalesforceProject.DoesNotExist:
            return Response({"detail": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        count = LogTimeDayAssignment.objects.filter(user=request.user, date=entry_date).count()
        obj, _ = LogTimeDayAssignment.objects.get_or_create(
            user=request.user, date=entry_date, project=project,
            defaults={"position": count},
        )
        return Response(LogTimeDayAssignmentSerializer(obj).data, status=status.HTTP_201_CREATED)

    if request.method == "DELETE":
        project_id = request.data.get("project_id")
        entry_date = request.data.get("date")
        LogTimeDayAssignment.objects.filter(
            user=request.user, date=entry_date, project_id=project_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
