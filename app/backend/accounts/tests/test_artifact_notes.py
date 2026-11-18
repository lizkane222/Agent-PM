"""ArtifactNote CRUD, threading, permissions, cascade; reminders in `used_in`; registrations."""
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from accounts.artifact_links import used_in_map
from accounts.models import AccountArtifact, ArtifactNote
from accounts.tests.test_views import _make_account, _make_artifact, _make_user

URL = "/api/v1/accounts/artifact-notes/"


class NotesBase(APITestCase):
    def setUp(self):
        cache.clear()
        from team.models import TeamMember
        self.owner = _make_user("nt_owner")
        self.mate = _make_user("nt_mate")
        self.stranger = _make_user("nt_stranger")
        self.admin = _make_user("nt_admin")
        from team.models import UserProfile
        prof, _ = UserProfile.objects.get_or_create(user=self.admin)
        prof.access_level = "admin"
        prof.save(update_fields=["access_level"])
        self.acct = _make_account("Acme", admin_owner=self.owner)
        self.acct.team_members.add(TeamMember.objects.create(full_name="Mate", email="m@x.com", user=self.mate))
        self.admin_member = TeamMember.objects.create(full_name="Adm", email="a@x.com", user=self.admin)
        self.acct.team_members.add(self.admin_member)
        self.art = _make_artifact(self.acct, self.owner, "Deck")

    def post(self, user, html="<p>Hello</p>", parent=None, artifact=None):
        self.client.force_authenticate(user)
        body = {"artifact": (artifact or self.art).id, "html": html}
        if parent:
            body["parent"] = parent
        return self.client.post(URL, body, format="json")


class ArtifactNoteTests(NotesBase):
    def test_unauthenticated_is_401(self):
        self.assertEqual(self.client.get(URL + f"?artifact={self.art.id}").status_code, 401)
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 401)

    def test_create_sets_author_and_derives_text(self):
        resp = self.post(self.mate, "<p>Hello <b>world</b></p>")
        self.assertEqual(resp.status_code, 201)
        note = ArtifactNote.objects.get(pk=resp.data["id"])
        self.assertEqual((note.author_id, note.text), (self.mate.id, "Hello world"))
        self.assertEqual(resp.data["author_display"], "nt_mate")

    def test_client_cannot_forge_author_or_text(self):
        self.client.force_authenticate(self.mate)
        resp = self.client.post(URL, {"artifact": self.art.id, "html": "<p>x</p>", "author": self.owner.id, "text": "forged"}, format="json")
        note = ArtifactNote.objects.get(pk=resp.data["id"])
        self.assertEqual((note.author_id, note.text), (self.mate.id, "x"))

    def test_html_is_sanitized(self):
        resp = self.post(self.owner, "<p onclick='x()'>Hi</p><script>alert(1)</script>")
        self.assertNotIn("script", resp.data["html"].lower())
        self.assertNotIn("onclick", resp.data["html"].lower())

    def test_empty_note_is_rejected(self):
        self.assertEqual(self.post(self.owner, "<p>  </p>").status_code, 400)

    def test_stranger_cannot_create_or_list(self):
        self.assertEqual(self.post(self.stranger).status_code, 404)
        self.post(self.owner)
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(URL + f"?artifact={self.art.id}").data["results"], [])

    def test_list_requires_an_artifact_filter_and_is_newest_first(self):
        first = self.post(self.owner, "<p>first</p>").data["id"]
        second = self.post(self.mate, "<p>second</p>").data["id"]
        self.client.force_authenticate(self.mate)
        self.assertEqual(self.client.get(URL).data["results"], [])
        ids = [n["id"] for n in self.client.get(URL + f"?artifact={self.art.id}").data["results"]]
        self.assertEqual(ids, [second, first])

    def test_batched_list(self):
        other = _make_artifact(self.acct, self.owner, "Other")
        a = self.post(self.owner).data["id"]
        b = self.post(self.owner, artifact=other).data["id"]
        self.client.force_authenticate(self.owner)
        ids = {n["id"] for n in self.client.get(URL + f"?artifact__in={self.art.id},{other.id}").data["results"]}
        self.assertEqual(ids, {a, b})

    def test_reply_chain_and_reply_count(self):
        root = self.post(self.owner, "<p>root</p>").data["id"]
        child = self.post(self.mate, "<p>child</p>", parent=root).data["id"]
        grand = self.post(self.owner, "<p>grand</p>", parent=child).data["id"]
        self.client.force_authenticate(self.owner)
        rows = {n["id"]: n for n in self.client.get(URL + f"?artifact={self.art.id}").data["results"]}
        self.assertEqual((rows[root]["reply_count"], rows[child]["reply_count"], rows[grand]["reply_count"]), (1, 1, 0))
        self.assertEqual(rows[grand]["parent"], child)

    def test_reply_must_be_on_the_same_artifact(self):
        other = _make_artifact(self.acct, self.owner, "Other")
        root = self.post(self.owner, artifact=other).data["id"]
        self.assertEqual(self.post(self.owner, parent=root).status_code, 400)

    def test_author_edits_others_cannot(self):
        nid = self.post(self.mate, "<p>mine</p>").data["id"]
        self.client.force_authenticate(self.mate)
        resp = self.client.patch(f"{URL}{nid}/", {"html": "<p>edited</p>"}, format="json")
        self.assertEqual((resp.status_code, resp.data["text"]), (200, "edited"))
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(f"{URL}{nid}/", {"html": "<p>x</p>"}, format="json").status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f"{URL}{nid}/", {"html": "<p>x</p>"}, format="json").status_code, 403)
        self.assertEqual(ArtifactNote.objects.get(pk=nid).text, "edited")

    def test_edit_cannot_move_a_note_to_another_artifact_or_thread(self):
        other = _make_artifact(self.acct, self.owner, "Other")
        nid = self.post(self.owner).data["id"]
        self.client.force_authenticate(self.owner)
        self.client.patch(f"{URL}{nid}/", {"artifact": other.id}, format="json")
        self.assertEqual(ArtifactNote.objects.get(pk=nid).artifact_id, self.art.id)

    def test_stranger_update_and_delete_are_404(self):
        nid = self.post(self.owner).data["id"]
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.patch(f"{URL}{nid}/", {"html": "<p>x</p>"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"{URL}{nid}/").status_code, 404)

    def test_delete_own_admin_can_delete_others_member_cannot(self):
        nid = self.post(self.mate).data["id"]
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(f"{URL}{nid}/").status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(f"{URL}{nid}/").status_code, 204)
        nid2 = self.post(self.mate).data["id"]
        self.client.force_authenticate(self.mate)
        self.assertEqual(self.client.delete(f"{URL}{nid2}/").status_code, 204)

    def test_deleting_a_note_deletes_its_replies(self):
        root = self.post(self.owner).data["id"]
        child = self.post(self.mate, parent=root).data["id"]
        self.post(self.owner, parent=child)
        self.client.force_authenticate(self.owner)
        self.client.delete(f"{URL}{root}/")
        self.assertEqual(ArtifactNote.objects.count(), 0)

    def test_deleting_the_artifact_deletes_notes(self):
        self.post(self.owner)
        self.art.delete()
        self.assertEqual(ArtifactNote.objects.count(), 0)


class DiscussionAudienceTests(NotesBase):
    """An artifact's notes and comments are one conversation: everyone who can see the artifact
    reads and writes both, and every Admin does too (not only one who switched on the staff view)."""

    def setUp(self):
        super().setUp()
        from team.models import UserProfile
        self.other_admin = _make_user("nt_admin2")  # an Admin who is NOT on the account, no staff-view override
        prof, _ = UserProfile.objects.get_or_create(user=self.other_admin)
        prof.access_level = "admin"
        prof.staff_view_override = False  # the Admin who switched the staff data view off
        prof.save(update_fields=["access_level", "staff_view_override"])
        self.post(self.mate, "<p>team note</p>")

    def comment_url(self):
        return f"/api/v1/comments/comments/?resource_type=artifact&resource_id={self.art.id}"

    def test_an_admin_off_the_account_reads_and_writes_notes(self):
        self.client.force_authenticate(self.other_admin)
        self.assertEqual(self.client.get(URL + f"?artifact={self.art.id}").data["count"], 1)
        self.assertEqual(self.post(self.other_admin, "<p>from admin</p>").status_code, 201)

    def test_that_admin_also_sees_the_comments(self):
        from comments.models import Comment
        Comment.objects.create(resource_type="artifact", resource_id=self.art.id, author=self.mate, content="hello")
        self.client.force_authenticate(self.other_admin)
        resp = self.client.get(self.comment_url())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data.get("results", resp.data)), 1)

    def test_team_members_see_both(self):
        from comments.models import Comment
        Comment.objects.create(resource_type="artifact", resource_id=self.art.id, author=self.owner, content="c")
        self.client.force_authenticate(self.mate)
        self.assertEqual(self.client.get(URL + f"?artifact={self.art.id}").data["count"], 1)
        self.assertEqual(len(self.client.get(self.comment_url()).data.get("results", [])), 1)

    def test_a_non_admin_stranger_sees_neither(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(URL + f"?artifact={self.art.id}").data["count"], 0)
        self.assertEqual(self.post(self.stranger, "<p>nope</p>").status_code, 404)
        # An invisible record just lists nothing (comments never confirm it exists).
        self.assertEqual(len(self.client.get(self.comment_url()).data.get("results", [])), 0)


class UsedInRemindersTests(NotesBase):
    def make_reminder(self, user, links):
        from scheduler.models import Reminder
        from django.utils import timezone
        return Reminder.objects.create(created_by=user, title="Follow up", due_at=timezone.now(), links=links)

    def test_reminders_of_the_caller_that_link_the_artifact_are_listed(self):
        mine = self.make_reminder(self.owner, [{"resource_type": "artifact", "resource_id": self.art.id, "resource_label": "Deck"}])
        self.make_reminder(self.mate, [{"resource_type": "artifact", "resource_id": self.art.id, "resource_label": "Deck"}])
        self.make_reminder(self.owner, [{"resource_type": "artifact", "resource_id": 999999, "resource_label": "x"}])
        usage = used_in_map([self.art.id], [self.acct.id], user=self.owner)[self.art.id]
        self.assertEqual([(u["resource_type"], u["resource_id"], u["url"]) for u in usage], [("reminder", mine.id, "/reminders")])
        self.assertNotIn(self.art.id, used_in_map([self.art.id], [self.acct.id]))  # no user: no reminders

    def test_serializer_exposes_reminders_in_used_in(self):
        rem = self.make_reminder(self.owner, [{"resource_type": "artifact", "resource_id": self.art.id, "resource_label": "Deck"}])
        self.client.force_authenticate(self.owner)
        rows = self.client.get(f"/api/v1/accounts/accounts/{self.acct.id}/artifacts/").data
        self.assertIn(("reminder", rem.id), [(u["resource_type"], u["resource_id"]) for u in rows[0]["used_in"]])

    def test_query_count_does_not_grow_with_artifacts_or_reminders(self):
        def count(n):
            arts = [_make_artifact(self.acct, self.owner, f"A{i}") for i in range(n)]
            for a in arts:
                self.make_reminder(self.owner, [{"resource_type": "artifact", "resource_id": a.id, "resource_label": "x"}])
            with CaptureQueriesContext(connection) as ctx:
                used_in_map([a.id for a in arts], [self.acct.id], user=self.owner)
            return len(ctx)
        self.assertEqual(count(2), count(6))
        self.assertLessEqual(count(2), 4)

    def test_a_reminder_can_link_an_artifact_the_user_can_see_only(self):
        self.client.force_authenticate(self.owner)
        body = {"title": "t", "due_at": "2099-01-01T10:00:00Z", "links": [{"resource_type": "artifact", "resource_id": self.art.id}]}
        resp = self.client.post("/api/v1/scheduler/reminders/", body, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["links"][0]["resource_label"], "Deck")
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.post("/api/v1/scheduler/reminders/", body, format="json").status_code, 400)


class RegistrationTests(NotesBase):
    def test_comments_accept_the_artifact_type_and_gate_on_visibility(self):
        self.client.force_authenticate(self.mate)
        body = {"resource_type": "artifact", "resource_id": self.art.id, "content": "hi"}
        self.assertEqual(self.client.post("/api/v1/comments/comments/", body, format="json").status_code, 201)
        self.client.force_authenticate(self.stranger)
        self.assertIn(self.client.post("/api/v1/comments/comments/", body, format="json").status_code, (403, 404))

    def test_sensitive_visibility_knows_artifact_notes(self):
        from sensitive.visibility import RESOURCE_TYPES, can_see
        note = ArtifactNote.objects.create(artifact=self.art, author=self.owner, html="<p>x</p>", text="x")
        self.assertIn("artifact_note", RESOURCE_TYPES)
        self.assertTrue(can_see(self.mate, "artifact_note", note.id))
        self.assertFalse(can_see(self.stranger, "artifact_note", note.id))
        self.assertFalse(can_see(self.mate, "artifact_note", 999999))
