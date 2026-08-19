"""Seed the "get-meeting-notes" Agent Capability.

Ships the capability as data rather than asking every user to author it, so it shows
up on the Skills page ready to pin to a personal profile or a role page. Created
approved + public so non-staff can see and pin it (see AgentSkillViewSet.get_queryset).

Idempotent: keyed on `name`, and the reverse migration removes only this row.
"""

from django.db import migrations

SKILL_NAME = "get-meeting-notes"

DESCRIPTION = (
    "Fetch AI meeting summaries from Gong or Zoom recap emails and attach them to the "
    "matching meetings. Use when the user asks to get, pull, refresh, or back-fill "
    "meeting notes or call recaps, or says a meeting is missing its summary."
)

INSTRUCTIONS = """\
Fill in missing AI meeting summaries from the user's recap emails.

## Steps

1. Work out the scope from the request:
   - A specific account mentioned by name → pass it as `account_name`.
   - No account mentioned → leave `account_name` empty to cover every meeting the
     user can see.
   - A time frame mentioned ("last week", "this quarter") → convert it to whole days
     and pass it as `days`. Default to 30 when nothing is stated; the maximum is 180.

2. Call `get_meeting_notes_from_email` with those arguments. It matches recap emails
   to meetings by name and date, prefers Gong over Zoom when both exist, stores both,
   and never overwrites a summary that is already there.

3. Report back:
   - How many meetings got a summary, and which provider each came from.
   - Name the meetings that were updated, with their dates.
   - If `updated_count` is 0, say so plainly and give the likely reason from
     `scanned_emails` / `scanned_meetings`: no recap emails in the window, no meetings
     in the window, or every meeting already had notes.
   - If `summaries_truncated` is true, say that the per-run ceiling was reached and
     that running it again will pick up the rest.

## Notes

- If the tool reports that Gmail is not connected, tell the user to connect Gmail on
  the Settings page — do not retry.
- Do not invent commitments or action items that the tool's output does not contain.
  The summaries themselves are generated from the email text; your job here is to
  report what changed, not to re-summarise the meetings.
"""


def create_skill(apps, schema_editor):
    AgentSkill = apps.get_model("skills", "AgentSkill")
    AgentSkill.objects.update_or_create(
        name=SKILL_NAME,
        defaults={
            "description": DESCRIPTION,
            "instructions": INSTRUCTIONS,
            "allowed_tools": ["get_meeting_notes_from_email"],
            "scripts": [],
            "references": [],
            "status": "approved",
            "visibility": "public",
            "review_verdict": "PASS",
            "review_findings": {"note": "Shipped capability — reviewed at authoring time."},
            "pinned_to_roles": [],
        },
    )


def remove_skill(apps, schema_editor):
    AgentSkill = apps.get_model("skills", "AgentSkill")
    AgentSkill.objects.filter(name=SKILL_NAME).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0007_add_token_fields_to_skillinvocation"),
    ]

    operations = [
        migrations.RunPython(create_skill, remove_skill),
    ]
