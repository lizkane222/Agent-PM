"""Account.slack_channels: validation, scoping and field-history logging."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import Account
from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/accounts/accounts/"


def _entry(**kw):
    base = {"workspace": "Acme Corp", "channel": "acme-support", "url": "https://acme.slack.com/archives/C1", "type": "customer_facing"}
    base.update(kw)
    return base


class SlackChannelsTest(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("slack_u", "slack_u@example.com", "x")
        self.other = User.objects.create_user("slack_o", "slack_o@example.com", "x")
        self.account = Account.objects.create(company_name="Slack Co")
        self.account.team_members.add(TeamMember.objects.create(user=self.user, full_name="S U", email="slack_u@example.com"))
        self.client.force_authenticate(user=self.user)

    def _patch(self, channels):
        return self.client.patch(f"{URL}{self.account.id}/", {"slack_channels": channels}, format="json")

    def test_unauthenticated_is_401(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(f"{URL}{self.account.id}/").status_code, 401)

    def test_member_can_set_and_read_back(self):
        resp = self._patch([_entry(), _entry(channel="#internal", type="account_team")])
        self.assertEqual(resp.status_code, 200, resp.data)
        got = self.client.get(f"{URL}{self.account.id}/").data["slack_channels"]
        self.assertEqual([c["channel"] for c in got], ["acme-support", "internal"])  # leading # dropped
        self.assertEqual(got[1]["type"], "account_team")

    def test_default_is_empty_list(self):
        self.assertEqual(self.client.get(f"{URL}{self.account.id}/").data["slack_channels"], [])

    def test_non_member_cannot_edit(self):
        self.client.force_authenticate(user=self.other)
        self.assertIn(self._patch([_entry()]).status_code, (403, 404))
        self.account.refresh_from_db()
        self.assertEqual(self.account.slack_channels, [])

    def test_rejects_non_http_urls(self):
        for bad in ("javascript:alert(1)", "ftp://x.com/a", "slack.com/x", ""):
            self.assertEqual(self._patch([_entry(url=bad)]).status_code, 400, bad)

    def test_rejects_bad_type_and_missing_names(self):
        self.assertEqual(self._patch([_entry(type="public")]).status_code, 400)
        self.assertEqual(self._patch([_entry(workspace="")]).status_code, 400)
        self.assertEqual(self._patch([_entry(channel="  # ")]).status_code, 400)

    def test_rejects_non_list_and_non_objects(self):
        self.assertEqual(self._patch("nope").status_code, 400)
        self.assertEqual(self._patch(["x"]).status_code, 400)

    def test_bounds(self):
        self.assertEqual(self._patch([_entry() for _ in range(31)]).status_code, 400)
        self.assertEqual(self._patch([_entry(workspace="w" * 101)]).status_code, 400)
        self.assertEqual(self._patch([_entry(channel="c" * 121)]).status_code, 400)
        self.assertEqual(self._patch([_entry(url="https://x.com/" + "a" * 500)]).status_code, 400)

    def test_unknown_keys_are_discarded(self):
        self.assertEqual(self._patch([_entry(evil="<script>")]).status_code, 200)
        self.account.refresh_from_db()
        self.assertNotIn("evil", self.account.slack_channels[0])

    def test_change_is_written_to_activity_log(self):
        from realtime.models import AgentActivityEvent

        self._patch([_entry()])
        [event] = AgentActivityEvent.objects.filter(event_type="account.field_changed", metadata__field="slack_channels")
        self.assertEqual(event.metadata["action"], "set")
        self.assertIn("acme-support", event.metadata["to"])
        self.assertIn("Acme Corp", event.metadata["to"])
        self._patch([])
        cleared = AgentActivityEvent.objects.filter(event_type="account.field_changed", metadata__field="slack_channels").order_by("pk").last()
        self.assertEqual(cleared.metadata["action"], "cleared")

    def test_unchanged_list_is_not_logged_again(self):
        from realtime.models import AgentActivityEvent

        self._patch([_entry()])
        self._patch([_entry()])
        self.assertEqual(AgentActivityEvent.objects.filter(metadata__field="slack_channels").count(), 1)
