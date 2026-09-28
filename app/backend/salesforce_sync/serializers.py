from rest_framework import serializers
from .models import (
    SalesforceAccount,
    SalesforceProject,
    SalesforceTeamMember,
    SalesforceTask,
    SalesforceTimeEntry,
    SalesforceConfig,
    LogTimeDayAssignment,
)


class SalesforceConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesforceConfig
        fields = ["instance_url", "namespace", "sf_user_email", "last_synced"]


class SalesforceAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesforceAccount
        fields = "__all__"


class SalesforceTeamMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesforceTeamMember
        fields = "__all__"


class SalesforceTaskSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True, default="")
    project_name = serializers.CharField(source="project.name", read_only=True, default="")

    class Meta:
        model = SalesforceTask
        fields = "__all__"


class SalesforceProjectSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True, default="")
    members = SalesforceTeamMemberSerializer(many=True, read_only=True)
    tasks = SalesforceTaskSerializer(many=True, read_only=True)

    class Meta:
        model = SalesforceProject
        fields = "__all__"


class SalesforceTimeEntrySerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    task_subject = serializers.CharField(source="task.subject", read_only=True, default="")

    class Meta:
        model = SalesforceTimeEntry
        fields = "__all__"
        read_only_fields = ["user", "sf_id", "synced_to_sf", "sync_error"]


class LogTimeSerializer(serializers.Serializer):
    project_sf_id = serializers.CharField()
    task_sf_id = serializers.CharField(allow_blank=True, required=False, default="")
    date = serializers.DateField()
    duration_minutes = serializers.IntegerField(min_value=1)
    description = serializers.CharField(allow_blank=True, default="")


class LogWeekEntrySerializer(serializers.Serializer):
    """One client-supplied time-log line — see `log_week._plan_from_client_entries`."""
    date = serializers.DateField()
    project_sf_id = serializers.CharField()
    project_name = serializers.CharField(allow_blank=True, required=False, default="")
    minutes = serializers.IntegerField(min_value=0)
    description = serializers.CharField(allow_blank=True, required=False, default="")
    titles = serializers.ListField(
        child=serializers.CharField(allow_blank=True), required=False, default=list
    )


class LogWeekSerializer(serializers.Serializer):
    # Blank/absent means "the current week" — resolved by `cloudcoach.parse_week_start`,
    # which also snaps any mid-week date back to its Monday. Kept as a CharField rather
    # than a DateField so a malformed value reaches that helper and produces the
    # endpoint's own 400 message instead of DRF's generic one.
    week_start = serializers.CharField(allow_blank=True, required=False, default="")
    account_name = serializers.CharField(allow_blank=True, required=False, default="")
    entries = LogWeekEntrySerializer(many=True, required=False)
    dry_run = serializers.BooleanField(required=False, default=False)


class ChatterPostSerializer(serializers.Serializer):
    record_id = serializers.CharField()
    body = serializers.CharField()


class UpdateTaskStatusSerializer(serializers.Serializer):
    status = serializers.CharField()


class LogTimeDayAssignmentSerializer(serializers.ModelSerializer):
    project_sf_id = serializers.CharField(source="project.sf_id", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = LogTimeDayAssignment
        fields = ["id", "date", "project", "project_sf_id", "project_name", "position"]
        read_only_fields = ["id", "project_sf_id", "project_name"]
