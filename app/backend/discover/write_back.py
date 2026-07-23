import logging
from django.conf import settings

logger = logging.getLogger(__name__)

TABLE_APPLETS = getattr(settings, "AIRTABLE_TABLE_APPLETS", "")


def _applet_fields(applet) -> dict:
    return {
        "Name":        applet.name,
        "Description": applet.description,
        "URL":         applet.url,
        "Type":        applet.type,
        "Category":    applet.category,
        "Author":      applet.author,
        "Tags":        ", ".join(applet.tags) if applet.tags else "",
    }


def push_applet_create(applet) -> str | None:
    if not TABLE_APPLETS:
        return None
    try:
        from airtable_sync.airtable_client import get_table
        table = get_table(TABLE_APPLETS)
        record = table.create(_applet_fields(applet))
        logger.info("Created Airtable applet record %s for '%s'", record["id"], applet.name)
        return record["id"]
    except Exception:
        logger.exception("Failed to create Airtable applet for '%s'", applet.name)
        return None


def push_applet_update(applet) -> bool:
    if not TABLE_APPLETS or not applet.airtable_id:
        return False
    try:
        from airtable_sync.airtable_client import get_table
        table = get_table(TABLE_APPLETS)
        table.update(applet.airtable_id, _applet_fields(applet))
        logger.info("Updated Airtable applet record %s", applet.airtable_id)
        return True
    except Exception:
        logger.exception("Failed to update Airtable applet %s", applet.airtable_id)
        return False


def push_applet_delete(airtable_id: str) -> bool:
    if not TABLE_APPLETS or not airtable_id:
        return False
    try:
        from airtable_sync.airtable_client import get_table
        table = get_table(TABLE_APPLETS)
        table.delete(airtable_id)
        logger.info("Deleted Airtable applet record %s", airtable_id)
        return True
    except Exception:
        logger.exception("Failed to delete Airtable applet %s", airtable_id)
        return False
