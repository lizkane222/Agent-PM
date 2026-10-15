import logging

from django.db.models import Q
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
    LogWeekSerializer,
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
        from core.mixins import admin_wants_all
        if admin_wants_all(self.request):
            return SalesforceAccount.objects.all().order_by("name")
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
            # Owning the record is not how this org expresses "my project" — the ten
            # role lookups on the project are (mirrored into SalesforceTeamMember by
            # `sync.sync_project_roles`). Widened to the union so nothing that used to
            # be visible stops being visible.
            qs = qs.filter(
                Q(owner_sf_id=sf_user_id) | Q(members__sf_user_id=sf_user_id)
            ).distinct()
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def lookup_project(request):
    """
    GET ?name=<partial project name>

    Search Cloud Coach for projects by name and report whether the caller holds a role on
    each. Deliberately not scoped to the caller's own projects — "does a project called X
    exist" and "am I on X" both need to see projects you are not on. SOQL runs under the
    caller's own OAuth token, so the org's sharing rules still apply.
    """
    from .client import get_client
    from .cloudcoach import CloudCoachError, find_projects_by_name

    name = (request.query_params.get("name") or "").strip()
    if not name:
        return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        sf = get_client(request.user)
    except PermissionError:
        return Response(
            {"detail": "Salesforce is not connected for this user."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception:
        logger.exception("Salesforce client setup failed for project lookup")
        return Response(
            {"detail": "Could not reach Salesforce."}, status=status.HTTP_502_BAD_GATEWAY
        )

    try:
        result = find_projects_by_name(sf, name, sf_user_id=_user_sf_id(request) or "")
    except CloudCoachError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception:
        logger.exception("Cloud Coach project lookup failed")
        return Response(
            {"detail": "An unexpected error occurred."}, status=status.HTTP_502_BAD_GATEWAY
        )

    return Response({"query": name, **result, "count": len(result["projects"])})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def log_week(request):
    """
    POST {week_start?, account_name?, entries?, dry_run?}

    Resolve the week's calendar activity into Cloud Coach time entries and write them
    in one Composite API call. `dry_run: true` returns the same report without
    writing, which is what the warning modal previews and what the agent reads back
    before asking for confirmation.

    `entries` lets the Log Time panel send exactly what it computed — it holds
    per-event hour overrides and row removals in localStorage that the server cannot
    see, so recomputing would discard them. The skip report is built from the
    calendar either way.
    """
    from .cloudcoach import CloudCoachError, parse_week_start
    from .log_week import plan_week, write_week

    ser = LogWeekSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data

    try:
        week_start = parse_week_start(d.get("week_start") or "")
    except ValueError:
        return Response(
            {"detail": "week_start must be an ISO date (YYYY-MM-DD)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    plan = plan_week(
        request.user,
        week_start,
        account_name=d.get("account_name") or None,
        entries=d.get("entries") or None,
    )

    if d.get("dry_run"):
        return Response({**plan.as_dict(), "dry_run": True, "logged": 0})

    try:
        result = write_week(request.user, plan)
    except PermissionError:
        return Response(
            {"detail": "Salesforce is not connected for this user."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except CloudCoachError as exc:
        # `CloudCoachError` messages are authored by us and carry no org data or
        # exception text, so they are safe to return — unlike the bare 502 the other
        # actions in this module use, they tell the user what to fix.
        logger.warning("log_week refused: %s", exc)
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    except Exception:
        logger.exception("log_week failed")
        return Response(
            {"detail": "An unexpected error occurred."},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response({**result, "dry_run": False})


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
