"""Give every live reminder a single calendar marker at its due time.

Before this, a reminder reached the calendar only by being dragged onto the grid, as a
15-minute block with a start and end the reminder form could not change — and a reminder
dragged twice had two. Now each pending/sent/snoozed reminder has exactly one marker with
start == end == due_at (see scheduler/reminder_calendar.py), and a dismissed one has none.

Local rows only: nothing here writes to Google. Idempotent; reversing is a no-op (the old
block times were arbitrary and are not worth restoring).
"""

from django.db import migrations

VISIBLE = ("pending", "sent", "snoozed")


def forwards(apps, schema_editor):
    Reminder = apps.get_model("scheduler", "Reminder")
    CalendarEvent = apps.get_model("scheduler", "CalendarEvent")
    Account = apps.get_model("accounts", "Account")

    for reminder in Reminder.objects.all():
        owned = CalendarEvent.objects.filter(
            reminder=reminder, calendar_id="reminders", owner_id=reminder.created_by_id
        ).order_by("pk")
        if reminder.status not in VISIBLE:
            owned.delete()
            continue
        account = None
        if reminder.resource_type == "account" and reminder.resource_id:
            account = Account.objects.filter(pk=reminder.resource_id).first()
        fields = {
            "title": reminder.title,
            "start_datetime": reminder.due_at,
            "end_datetime": reminder.due_at,
            "account": account,
            "all_day": False,
            "status": "confirmed",
        }
        keep = owned.first()
        if keep is None:
            CalendarEvent.objects.create(
                owner_id=reminder.created_by_id, calendar_id="reminders", reminder=reminder, **fields
            )
            continue
        owned.exclude(pk=keep.pk).delete()
        for name, value in fields.items():
            setattr(keep, name, value)
        keep.save()


class Migration(migrations.Migration):
    dependencies = [
        ("scheduler", "0013_reminder_recipients_and_opt_out"),
        ("accounts", "0001_initial"),
    ]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
