"""
Attach an app account to logged time entries that were saved without one.

Entries logged before `SalesforceTimeEntry.account` existed carry only a date, minutes and a
description, and (without a synced Cloud Coach project) no account — so the profile page's Time
Allocation panel put all of them under "No account". This reads each one back to an account using
`time_entry_accounts.infer_account` (matching calendar event, matching action item, or exactly one
of the user's accounts named in the description).

    manage.py backfill_time_entry_accounts            # dry run: prints what it would do
    manage.py backfill_time_entry_accounts --commit   # writes
    manage.py backfill_time_entry_accounts --alias "schnucks=Festival Foods & Schnucks"

Safe to re-run: only entries with no account and no account-bearing project are considered, and a
row it cannot place confidently is left alone and reported. Undo for one entry is
`account = NULL`; nothing else is modified.
"""

from django.core.management.base import BaseCommand, CommandError

from salesforce_sync.models import SalesforceTimeEntry
from salesforce_sync.time_entry_accounts import entry_title, infer_account


class Command(BaseCommand):
    help = "Attach an account to logged time entries that have none (dry run unless --commit)."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Write the changes. Default is a dry run.")
        parser.add_argument("--username", help="Only this user's entries.")
        parser.add_argument(
            "--alias", action="append", default=[], metavar="PHRASE=ACCOUNT",
            help='Treat PHRASE in a description as ACCOUNT, e.g. --alias "schnucks=Festival Foods & Schnucks". '
                 "ACCOUNT must be one of the user's accounts. Repeatable.",
        )

    def handle(self, *args, **opts):
        commit = opts["commit"]
        qs = (
            SalesforceTimeEntry.objects
            .filter(account__isnull=True, user__isnull=False)
            .exclude(project__account__isnull=False)
            .select_related("user")
            .order_by("date", "id")
        )
        if opts.get("username"):
            qs = qs.filter(user__username=opts["username"])

        aliases = {}
        for raw in opts["alias"]:
            phrase, sep, target = raw.partition("=")
            if not sep or not phrase.strip() or not target.strip():
                raise CommandError(f"--alias must look like PHRASE=ACCOUNT, got {raw!r}")
            aliases[phrase.strip().lower()] = target.strip()

        placed = unplaced = 0
        for entry in qs:
            account = infer_account(entry.user, entry.date, entry.description, aliases)
            label = f"#{entry.id} {entry.date} {entry.duration_minutes:>4}m  {entry_title(entry.description)[:55]!r}"
            if account is None:
                unplaced += 1
                self.stdout.write(f"  left   {label}")
                continue
            placed += 1
            self.stdout.write(f"  {'set ' if commit else 'would'}   {label}  ->  {account.company_name}")
            if commit:
                SalesforceTimeEntry.objects.filter(pk=entry.pk).update(account=account)

        verb = "Attributed" if commit else "Would attribute"
        self.stdout.write(self.style.SUCCESS(f"{verb} {placed}; left {unplaced} without an account."))
        if not commit and placed:
            self.stdout.write("Dry run — re-run with --commit to write.")
