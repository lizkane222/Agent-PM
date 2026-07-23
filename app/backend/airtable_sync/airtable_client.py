import truststore
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from pyairtable import Api

# On macOS with Zscaler (or any corporate SSL proxy), Python's bundled certifi CA store
# doesn't include the proxy's root cert. truststore injects the macOS Security framework
# so that the system keychain (which trusts Zscaler) is used instead.
truststore.inject_into_ssl()


def _required_setting(name: str) -> str:
    value = getattr(settings, name, "")
    if not value:
        raise ImproperlyConfigured(
            f"Required Airtable setting '{name}' is not configured. "
            f"Set it in your .env file."
        )
    return value


TABLE_ACCOUNTS = _required_setting("AIRTABLE_TABLE_ACCOUNTS")
TABLE_ACTION_ITEMS = _required_setting("AIRTABLE_TABLE_ACTION_ITEMS")
TABLE_MEETINGS = _required_setting("AIRTABLE_TABLE_MEETINGS")
TABLE_TEAM = getattr(settings, "AIRTABLE_TABLE_TEAM", "")

FIELD_ACCOUNT_EMAIL_DOMAIN = _required_setting("AIRTABLE_FIELD_EMAIL_DOMAIN")


def get_api() -> Api:
    return Api(settings.AIRTABLE_API_KEY)


def get_table(table_id: str):
    return get_api().table(settings.AIRTABLE_BASE_ID, table_id)
