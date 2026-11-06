"""Normalise stored phone numbers to E.164 so SMS reminders reach Twilio.

A bare 10-digit number is assumed North American (+1) — the only shape found in the data.
Anything else that isn't already E.164 is left untouched (and reported in the log) rather
than guessed at; the Settings form now requires a country code going forward.
"""
import logging
import re

from django.db import migrations

logger = logging.getLogger(__name__)
E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def forwards(apps, schema_editor):
    UserProfile = apps.get_model("team", "UserProfile")
    for profile in UserProfile.objects.exclude(phone_number=""):
        digits = re.sub(r"[\s().-]", "", profile.phone_number)
        if E164.match(digits):
            new = digits
        elif re.fullmatch(r"\d{10}", digits):
            new = "+1" + digits
        elif re.fullmatch(r"1\d{10}", digits):
            new = "+" + digits
        else:
            logger.warning("Leaving unrecognised phone number on profile %s unchanged", profile.pk)
            continue
        if new != profile.phone_number:
            UserProfile.objects.filter(pk=profile.pk).update(phone_number=new)


class Migration(migrations.Migration):
    dependencies = [("team", "0007_teammemberdocument")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
