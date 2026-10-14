"""
Keep the local `AirtableAccount` mirror in step with app-created accounts.

Action items FK to `AirtableAccount`, not to `accounts.Account`. Before this
module existed, the only writer of `AirtableAccount` rows was the pull sync
(`sync.sync_accounts`), so an account created in the app — which is pushed to
Airtable and gets an `airtable_id` immediately — had no mirror row until the
next successful pull. Every attempt to attach an action item to it resolved to
no account and was silently saved unlinked.
"""

import logging

from .models import AirtableAccount

logger = logging.getLogger(__name__)


def ensure_airtable_account_mirror(account):
    """Create or refresh the AirtableAccount row for a Django `Account`.

    Returns the mirror, or None when the account has no `airtable_id` (the
    Airtable push failed, or it is a per-user Admin workspace).
    """
    airtable_id = (getattr(account, "airtable_id", "") or "").strip()
    if not airtable_id:
        return None
    mirror, created = AirtableAccount.objects.get_or_create(
        airtable_id=airtable_id,
        defaults={"name": account.company_name},
    )
    if not created and mirror.name != account.company_name:
        mirror.name = account.company_name
        mirror.save(update_fields=["name"])
    if created:
        logger.info("Created AirtableAccount mirror %s for '%s'", airtable_id, account.company_name)
    return mirror


def resolve_airtable_account(pk=None, name=None):
    """Resolve the AirtableAccount an action item should link to.

    Tries the mirror PK, then the mirror name, then a Django `Account` with that
    name — creating its mirror on the spot. Returns None when nothing matches.
    """
    if pk not in (None, "", "null"):
        try:
            acct = AirtableAccount.objects.filter(pk=int(pk)).first()
        except (ValueError, TypeError):
            acct = None
        if acct is not None:
            return acct

    name = (name or "").strip()
    if not name:
        return None

    acct = AirtableAccount.objects.filter(name__iexact=name).first()
    if acct is not None:
        return acct

    from accounts.models import Account

    django_acct = (
        Account.objects.filter(company_name__iexact=name, is_admin_account=False)
        .exclude(airtable_id="")
        .first()
    )
    if django_acct is None:
        return None
    return ensure_airtable_account_mirror(django_acct)
