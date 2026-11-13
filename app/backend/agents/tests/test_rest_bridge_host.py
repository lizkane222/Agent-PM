"""
The REST bridge runs the app's real views in-process. Django's test runner silently allows the host
"testserver", which `APIRequestFactory` uses by default - so a view that asks its request for the host
(to build an absolute file URL) passed every test and raised DisallowedHost on a running server.
These tests run with only real hosts allowed, as production does.
"""

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from accounts.models import Account, AccountArtifact
from agents import rest_bridge
from team.models import TeamMember

User = get_user_model()

REAL_HOSTS = override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1"])


class _Base(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("bridge", password="x")
        member = TeamMember.objects.create(user=self.user, full_name="B", email="b@example.com")
        self.account = Account.objects.create(company_name="Acme Corp")
        self.account.team_members.add(member)
        # A real uploaded file: its serializer field builds an absolute URL from the request's host.
        self.artifact = AccountArtifact.objects.create(
            account=self.account, artifact_type="file", name="deck.pdf", uploaded_by=self.user,
            file=SimpleUploadedFile("deck.pdf", b"%PDF-1.4 test", content_type="application/pdf"),
        )


class BridgeHostTests(_Base):
    @REAL_HOSTS
    def test_a_view_that_builds_an_absolute_file_url_works_when_testserver_is_not_allowed(self):
        status, data = rest_bridge.call(self.user, "GET", f"accounts/accounts/{self.account.pk}/artifacts/")
        self.assertEqual(status, 200)
        rows = rest_bridge.results(data)
        self.assertEqual([r["name"] for r in rows], ["deck.pdf"])
        self.assertTrue(rows[0]["file_url"].startswith("http://localhost:8000/"), rows[0]["file_url"])

    @override_settings(ALLOWED_HOSTS=["agentpm.example.com", ".example.org"])
    def test_a_real_domain_is_used_over_https(self):
        _, data = rest_bridge.call(self.user, "GET", f"accounts/accounts/{self.account.pk}/artifacts/")
        self.assertTrue(rest_bridge.results(data)[0]["file_url"].startswith("https://agentpm.example.com/"))

    @override_settings(ALLOWED_HOSTS=["*"])
    def test_a_wildcard_only_list_falls_back_to_localhost(self):
        _, data = rest_bridge.call(self.user, "GET", f"accounts/accounts/{self.account.pk}/artifacts/")
        self.assertIn("localhost", rest_bridge.results(data)[0]["file_url"])

    @REAL_HOSTS
    def test_writes_get_the_same_host(self):
        status, _ = rest_bridge.call(self.user, "POST", f"accounts/accounts/{self.account.pk}/notes/",
                                     data={"content": "hello"})
        self.assertIn(status, (200, 201))

    @REAL_HOSTS
    def test_the_host_never_leaks_into_a_user_visible_message_as_testserver(self):
        _, data = rest_bridge.call(self.user, "GET", f"accounts/accounts/{self.account.pk}/artifacts/")
        self.assertNotIn("testserver", str(data))
