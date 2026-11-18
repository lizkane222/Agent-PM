from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from skills.attachments import create_attachment
from skills.models import AgentSkill


class AttachmentUploadSafetyTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("att", password="x")
        self.skill = AgentSkill.objects.create(
            name="S", description="d", instructions="i", created_by=self.user
        )

    def test_script_capable_types_are_refused(self):
        for name in ("evil.svg", "x.js", "run.sh", "a.exe"):
            with self.assertRaises(ValueError):
                create_attachment(
                    self.skill, self.user,
                    upload=SimpleUploadedFile(name, b"<svg onload=alert(1)>"),
                )

    def test_html_is_sanitized_before_it_is_stored(self):
        att = create_attachment(
            self.skill, self.user,
            upload=SimpleUploadedFile("n.html", b"<p>ok</p><script>alert(1)</script>"),
        )
        att.file.open("rb")
        stored = att.file.read().decode()
        att.file.close()
        self.assertNotIn("<script", stored.lower())
