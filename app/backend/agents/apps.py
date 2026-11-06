from django.apps import AppConfig


class AgentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "agents"

    def ready(self):
        """
        Register the people-and-calendars MCP tools (find_person, get_colleague_availability,
        invite_to_meeting). They live in their own module rather than in `mcp_server.py` so the
        fuzzy name resolution and the availability rules stay together; the registry, system
        prompt and skills catalog are all derived from `mcp_server`, so registering here
        reaches every consumer.
        """
        from . import people_tools, profile_tools, record_tools
        from .mcp_server import mcp_server

        people_tools.register(mcp_server)
        # Public-profile actions: email_person (a link, sends nothing) and leave_note_for.
        profile_tools.register(mcp_server)
        # Create/read/update tools for every other user-facing record, each routed through
        # the app's own REST view (agents.rest_bridge). No delete tools — by design.
        record_tools.register(mcp_server)
