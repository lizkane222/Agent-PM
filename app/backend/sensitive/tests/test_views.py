"""Sensitive-mark API: permissions, batching, idempotency, caps, and no secret leakage."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Account, AccountNote
from realtime.models import AgentActivityEvent
from sensitive.models import MAX_MARKS_PER_RECORD, MAX_TEXT_LENGTH, SensitiveMark
from sensitive.views import SUMMARY_MAX_IDS
from team.models import TeamMember

User = get_user_model()
URL = "/api/v1/sensitive/marks/"
SECRET = "hunter2-very-secret"


class Base(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice", password="x")
        self.bob = User.objects.create_user("bob", password="x")
        self.staff = User.objects.create_user("root", password="x", is_staff=True)
        self.acct = Account.objects.create(company_name="Acme")
        TeamMember.objects.create(full_name="Alice", email="alice@x.com", user=self.alice)
        self.acct.team_members.add(self.alice.team_member)
        self.note = AccountNote.objects.create(account=self.acct, author=self.alice, content="n")
        self.other = Account.objects.create(company_name="Hidden Co")
        self.hidden_note = AccountNote.objects.create(account=self.other, author=self.staff, content="h")

    def post(self, rid, **kw):
        body = {"resource_type": "account_note", "resource_id": str(rid), "field": "body", "text": SECRET}
        body.update(kw)
        return self.client.post(URL, body, format="json")


class AuthTests(Base):
    def test_unauthenticated_401(self):
        self.assertEqual(self.client.get(URL).status_code, 401)
        self.assertEqual(self.client.post(URL, {}).status_code, 401)
        self.assertEqual(self.client.delete(URL + "1/").status_code, 401)


class CreateListDeleteTests(Base):
    def test_create_sets_owner_and_is_idempotent(self):
        self.client.force_authenticate(self.alice)
        r1 = self.post(self.note.id)
        r2 = self.post(self.note.id)
        self.assertEqual((r1.status_code, r2.status_code), (201, 200))
        self.assertEqual(r1.data["id"], r2.data["id"])
        self.assertEqual(SensitiveMark.objects.get().created_by, self.alice)

    def test_whole_line_mark_with_blank_text(self):
        self.client.force_authenticate(self.alice)
        r = self.post(self.note.id, text="", line_key="abc")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["text"], "")

    def test_shared_with_everyone_who_can_see_the_record(self):
        self.client.force_authenticate(self.alice)
        self.post(self.note.id)
        self.acct.team_members.add(TeamMember.objects.create(full_name="Bob", email="b@x.com", user=self.bob))
        self.client.force_authenticate(self.bob)
        resp = self.client.get(URL, {"resource_type": "account_note", "resource_ids": f"{self.note.id},999"})
        self.assertEqual(list(resp.data["results"]), [str(self.note.id)])
        self.assertEqual(resp.data["results"][str(self.note.id)][0]["text"], SECRET)

    def test_list_omits_ids_with_none_and_invisible_ids(self):
        SensitiveMark.objects.create(resource_type="account_note", resource_id=str(self.hidden_note.id),
                                     field="body", text=SECRET)
        self.client.force_authenticate(self.alice)
        resp = self.client.get(URL, {"resource_type": "account_note",
                                     "resource_ids": f"{self.note.id},{self.hidden_note.id}"})
        self.assertEqual(resp.data, {"results": {}})

    def test_invisible_record_404_same_as_nonexistent(self):
        self.client.force_authenticate(self.alice)
        a = self.post(self.hidden_note.id)
        b = self.post(987654)
        c = self.post(1, resource_type="nonsense")
        self.assertEqual((a.status_code, b.status_code, c.status_code), (404, 404, 404))
        self.assertEqual(a.data, b.data)
        self.assertEqual(SensitiveMark.objects.count(), 0)

    def test_staff_can_mark_anything_they_can_see(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.post(self.hidden_note.id).status_code, 201)

    def test_delete_visible_mark_and_invisible_404(self):
        self.client.force_authenticate(self.alice)
        mid = self.post(self.note.id).data["id"]
        self.assertEqual(self.client.delete(f"{URL}{mid}/").status_code, 204)
        hidden = SensitiveMark.objects.create(resource_type="account_note",
                                              resource_id=str(self.hidden_note.id), field="body", text=SECRET)
        r = self.client.delete(f"{URL}{hidden.id}/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.client.delete(f"{URL}99999/").status_code, 404)
        self.assertTrue(SensitiveMark.objects.filter(pk=hidden.pk).exists())

    def test_batch_cap(self):
        self.client.force_authenticate(self.alice)
        ids = ",".join(str(i) for i in range(1, SUMMARY_MAX_IDS + 2))
        self.assertEqual(self.client.get(URL, {"resource_type": "account_note", "resource_ids": ids}).status_code, 400)

    def test_list_unknown_type_400(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get(URL, {"resource_type": "zzz", "resource_ids": "1"}).status_code, 400)

    def test_text_and_count_caps(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.post(self.note.id, text="x" * (MAX_TEXT_LENGTH + 1)).status_code, 400)
        self.assertEqual(self.post(self.note.id, text="   ").status_code, 400)
        self.assertEqual(self.post(self.note.id, field="").status_code, 400)
        SensitiveMark.objects.bulk_create([
            SensitiveMark(resource_type="account_note", resource_id=str(self.note.id), field="body",
                          text=f"t{i}", fingerprint=f"fp{i}") for i in range(MAX_MARKS_PER_RECORD)])
        self.assertEqual(self.post(self.note.id, text="one more").status_code, 400)


class NoLeakTests(Base):
    def test_activity_events_and_errors_never_contain_the_text(self):
        self.client.force_authenticate(self.alice)
        mid = self.post(self.note.id).data["id"]
        self.client.delete(f"{URL}{mid}/")
        events = list(AgentActivityEvent.objects.filter(user=self.alice))
        self.assertEqual(len(events), 2)
        kinds = {e.metadata["kind"] for e in events}
        self.assertEqual(kinds, {"sensitive.marked", "sensitive.unmarked"})
        for e in events:
            self.assertNotIn(SECRET, f"{e.title}{e.detail}{e.metadata}")
        err = self.post(self.hidden_note.id)
        self.assertNotIn(SECRET, str(err.data))


class OtherTypesTests(Base):
    def test_open_types_and_contacts(self):
        from accounts.models import CustomerContact, CustomerContactNote
        c = CustomerContact.objects.create(account=self.acct, name="Pat")
        cn = CustomerContactNote.objects.create(contact=c, content="x")
        hc = CustomerContact.objects.create(account=self.other, name="Hid")
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.post(c.id, resource_type="customer_contact").status_code, 201)
        self.assertEqual(self.post(cn.id, resource_type="contact_note").status_code, 201)
        self.assertEqual(self.post(hc.id, resource_type="customer_contact").status_code, 404)
        me = TeamMember.objects.get(user=self.alice)
        self.assertEqual(self.post(me.id, resource_type="team_member").status_code, 201)
