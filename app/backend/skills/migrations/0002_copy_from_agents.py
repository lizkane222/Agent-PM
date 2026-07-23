# Data migration: copy existing ClaudeSkill records from agents app to skills app.

from django.db import migrations


def copy_skills_forward(apps, schema_editor):
    OldSkill = apps.get_model("agents", "ClaudeSkill")
    NewSkill = apps.get_model("skills", "ClaudeSkill")
    for old in OldSkill.objects.all():
        NewSkill.objects.get_or_create(
            name=old.name,
            defaults={
                "description":       old.description,
                "code":              old.code,
                "input_schema":      old.input_schema,
                "status":            old.status,
                "review_feedback":   old.review_feedback,
                "review_suggestions": old.review_suggestions,
                "invocation_count":  old.invocation_count,
                "submitted_by":      old.submitted_by,
            },
        )


def copy_skills_backward(apps, schema_editor):
    # Reverse: remove any skills.ClaudeSkill whose names exist in agents.ClaudeSkill
    OldSkill = apps.get_model("agents", "ClaudeSkill")
    NewSkill = apps.get_model("skills", "ClaudeSkill")
    names = list(OldSkill.objects.values_list("name", flat=True))
    NewSkill.objects.filter(name__in=names).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0001_initial"),
        ("agents", "0002_add_claude_skill"),
    ]

    operations = [
        migrations.RunPython(copy_skills_forward, copy_skills_backward),
    ]
