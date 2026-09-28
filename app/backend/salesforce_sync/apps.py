from django.apps import AppConfig


class SalesforceSyncConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "salesforce_sync"

    def ready(self):
        """
        Register the Cloud Coach MCP tools.

        Done here rather than by adding decorators to `agents/mcp_server.py` so this
        app owns its own tools — see the module docstring in `agent_tools.py`. The
        ordering is safe: `ready()` runs during `django.setup()`, while
        `agents/agent.py` (which builds `SYSTEM_PROMPT` from the registry at import
        time) is only imported later by a view, so the prompt and the skills catalog
        both see these tools.
        """
        from agents.mcp_server import mcp_server

        from . import agent_tools

        agent_tools.register(mcp_server)
