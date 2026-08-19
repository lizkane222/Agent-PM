"""Merge stale shared "Admin" accounts into each user's personal Admin account.

"Admin" is a reserved per-user workspace name (`is_admin_account=True`,
`admin_owner=<user>`). A row carrying that name *without* `is_admin_account=True`
is a leftover mirror of the shared Airtable "ADMIN" account, created by a one-time
import script that no longer exists. It surfaced as a second "Admin" entry for
staff users, whose account list is scoped by `is_admin_account=False`.

This migration reassigns such a row's children and then deletes it. Idempotent:
a database with no orphan rows is untouched, so it is a no-op on fresh installs.
"""

from django.db import migrations

# Kept literal rather than imported from accounts.models — migrations must not
# depend on current application code.
ADMIN_ACCOUNT_NAME = "Admin"


def _admin_account_for(Account, user_id, cache):
    """Return (creating if needed) the personal Admin account for `user_id`."""
    if user_id is None:
        return None
    if user_id in cache:
        return cache[user_id]
    account = Account.objects.filter(admin_owner_id=user_id).first()
    if account is None:
        account = Account.objects.create(
            company_name=ADMIN_ACCOUNT_NAME,
            is_admin_account=True,
            admin_owner_id=user_id,
            status="active",
            created_by_id=user_id,
        )
    cache[user_id] = account
    return account


def merge_orphan_admin_accounts(apps, schema_editor):
    Account = apps.get_model("accounts", "Account")

    orphans = list(
        Account.objects.filter(
            company_name__iexact=ADMIN_ACCOUNT_NAME, is_admin_account=False
        )
    )
    if not orphans:
        return

    try:
        ActionItem = apps.get_model("scheduler", "ActionItem")
    except LookupError:  # pragma: no cover - scheduler is always installed
        ActionItem = None

    admin_cache = {}

    for orphan in orphans:
        # Action items are per-assignee, so they route to the assignee's own Admin
        # workspace. An unassigned item has no owner and therefore no account —
        # the same rule AirtableActionItemViewSet applies to Admin item visibility.
        if ActionItem is not None:
            for item in ActionItem.objects.filter(account=orphan):
                item.account = _admin_account_for(
                    Account, item.assigned_to_id, admin_cache
                )
                item.save(update_fields=["account"])

        # Everything else has no per-user dimension; it belongs to whoever the
        # orphan row was created by.
        fallback = _admin_account_for(Account, orphan.created_by_id, admin_cache)

        blocked = []
        for rel in orphan._meta.related_objects:
            model = rel.related_model
            if ActionItem is not None and model is ActionItem:
                continue
            if rel.many_to_many:
                blocked.append(f"{model._meta.label} (m2m {rel.field.name})")
                continue
            field_name = rel.field.name
            qs = model.objects.filter(**{field_name: orphan})
            if not qs.exists():
                continue
            if fallback is not None:
                qs.update(**{field_name: fallback})
            elif rel.field.null:
                qs.update(**{field_name: None})
            else:
                blocked.append(f"{model._meta.label} ({qs.count()} rows)")

        members = list(orphan.team_members.all())
        if members and fallback is not None:
            fallback.team_members.add(*members)
        orphan.team_members.clear()

        if blocked:
            # Deleting now would cascade real data away. Leave the row in place —
            # it is already hidden from the account list by AccountViewSet.
            print(
                f"  accounts.0017: keeping Account #{orphan.pk} "
                f"'{orphan.company_name}' — unmergeable children: {', '.join(blocked)}"
            )
            continue

        orphan.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0016_add_project_kind"),
        # Both apps own FKs to accounts.Account; depending on them puts those
        # models in the migration state so related_objects can see them.
        ("scheduler", "0004_add_account_fk"),
        ("sync_review", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            merge_orphan_admin_accounts,
            migrations.RunPython.noop,
        ),
    ]
