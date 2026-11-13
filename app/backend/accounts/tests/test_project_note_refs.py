from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account, AccountNote, AccountProject

User = get_user_model()
URL = "/api/v1/accounts/projects/"


class ProjectNoteRefsTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("nr_owner", "nr_owner@example.com", "x")
        self.acct = Account.objects.create(company_name="NR Acme", admin_owner=self.user)
        self.other = Account.objects.create(company_name="NR Other", admin_owner=User.objects.create_user("nr2", "nr2@example.com", "x"))
        self.project = AccountProject.objects.create(account=self.acct, name="P")
        self.note = AccountNote.objects.create(account=self.acct, author=self.user, content="hi")
        self.foreign = AccountNote.objects.create(account=self.other, content="no")
        self.client.force_authenticate(user=self.user)

    def _patch(self, refs):
        return self.client.patch(f"{URL}{self.project.id}/", {"note_refs": refs}, format="json")

    def test_unauthenticated(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(self._patch([]).status_code, 401)

    def test_defaults_empty(self):
        self.assertEqual(self.client.get(f"{URL}{self.project.id}/").data["note_refs"], [])

    def test_round_trip_all_kinds(self):
        refs = [
            {"kind": "account_note", "id": str(self.note.id), "label": "hi"},
            {"kind": "meeting_note", "id": "7", "meetingId": "12", "label": "n"},
            {"kind": "summary", "id": "recM::bullet", "meetingId": "recM", "label": "bullet"},
        ]
        r = self._patch(refs)
        self.assertEqual(r.status_code, 200)
        self.project.refresh_from_db()
        self.assertEqual(self.project.note_refs, refs)

    def test_int_ids_normalised_and_duplicates_dropped(self):
        r = self._patch([
            {"kind": "account_note", "id": self.note.id, "label": "a"},
            {"kind": "account_note", "id": str(self.note.id), "label": "a"},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["note_refs"]), 1)
        self.assertEqual(r.data["note_refs"][0]["id"], str(self.note.id))

    def test_rejects_bad_shapes(self):
        for bad in [
            "x", [1], [{"kind": "bogus", "id": "1"}], [{"kind": "summary"}],
            [{"kind": "summary", "id": ""}], [{"kind": "summary", "id": True}],
            [{"kind": "summary", "id": "x" * 201}],
            [{"kind": "summary", "id": "1", "label": "x" * 301}],
            [{"kind": "summary", "id": "1", "meetingId": {"a": 1}}],
        ]:
            self.assertEqual(self._patch(bad).status_code, 400, bad)

    def test_rejects_over_limit(self):
        refs = [{"kind": "summary", "id": f"m{i}"} for i in range(201)]
        self.assertEqual(self._patch(refs).status_code, 400)
        self.assertEqual(self._patch(refs[:200]).status_code, 200)

    def test_account_note_must_belong_to_account(self):
        r = self._patch([{"kind": "account_note", "id": str(self.foreign.id)}])
        self.assertEqual(r.status_code, 400)
        r = self._patch([{"kind": "account_note", "id": "abc"}])
        self.assertEqual(r.status_code, 400)

    def test_other_user_cannot_edit(self):
        self.client.force_authenticate(user=User.objects.create_user("nr3", "nr3@example.com", "x"))
        self.assertIn(self._patch([]).status_code, (403, 404))

    def test_create_with_refs(self):
        r = self.client.post(URL, {
            "account": self.acct.id, "name": "New",
            "note_refs": [{"kind": "account_note", "id": str(self.note.id), "label": "hi"}],
        }, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["note_refs"][0]["kind"], "account_note")
