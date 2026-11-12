"""Push one TeamMember to the Airtable "Team Members" table, best effort.

Used when something changes a person's addresses outside the `push_team_members` command.
A failure is logged and swallowed: the local change is valid whether or not Airtable is reachable.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def push_member(member) -> bool:
    table_id = getattr(settings, "AIRTABLE_TABLE_TEAM_MEMBERS", "")
    if not table_id or not getattr(settings, "AIRTABLE_API_KEY", ""):
        return False
    try:
        from .airtable_client import get_api
        from .management.commands.push_team_members import _member_fields

        table = get_api().table(settings.AIRTABLE_BASE_ID, table_id)
        found = table.all(formula=f"{{Django ID}}={int(member.pk)}", fields=["Django ID"])
        fields = _member_fields(member)
        if found:
            table.update(found[0]["id"], fields)
        else:
            table.create(fields)
        return True
    except Exception:
        logger.warning("Could not push team member %s to Airtable", member.pk, exc_info=True)
        return False
