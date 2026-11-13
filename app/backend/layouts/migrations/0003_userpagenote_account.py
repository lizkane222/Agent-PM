import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


def link_existing_labels(apps, schema_editor):
    """Notes already filed under an account by *name* get the real link when it is unambiguous.

    The label is only trusted if exactly one account the note's owner is on has that exact name;
    anything else stays unlinked rather than guessing (a wrong link would show a private note under
    the wrong account)."""
    UserPageNote = apps.get_model("layouts", "UserPageNote")
    Account = apps.get_model("accounts", "Account")
    for note in UserPageNote.objects.filter(account__isnull=True).exclude(account_ref_label=""):
        matches = list(
            Account.objects.filter(company_name=note.account_ref_label)
            .filter(Q(team_members__user_id=note.owner_id) | Q(admin_owner_id=note.owner_id))
            .distinct()[:2]
        )
        if len(matches) == 1:
            note.account_id = matches[0].pk
            note.save(update_fields=["account"])


class Migration(migrations.Migration):

    dependencies = [
        ("layouts", "0002_workingsession_userpagenote"),
        ("accounts", "0027_accountproject_note_refs"),
    ]

    operations = [
        migrations.AddField(
            model_name="userpagenote",
            name="account",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="notepad_notes", to="accounts.account",
            ),
        ),
        migrations.RunPython(link_existing_labels, migrations.RunPython.noop),
    ]
