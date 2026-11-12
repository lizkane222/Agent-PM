"""Notifications, public items and left notes."""

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from rest_framework.test import APITestCase

from team.models import LeftNote, Notification, PublicItem, TeamMember, UserProfile
from team.notifications import record_notification

User = get_user_model()

NOTIFS = "/api/v1/team/notifications/"
PUBLIC = "/api/v1/team/public-items/"


def _user(name, staff=False):
    u = User.objects.create_user(username=name, email=f"{name}@example.com", password="pw")
    if staff:
        u.is_staff = True
        u.save()
        UserProfile.objects.create(user=u, staff_view_override=True)
    return u


def _member(user):
    return TeamMember.objects.create(full_name=user.username.title(), email=user.email, user=user)


class NotificationViewTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.a, self.b = _user("ann"), _user("bob")

    def test_unauthenticated_401(self):
        self.assertEqual(self.client.get(NOTIFS).status_code, 401)

    def test_lists_only_own_and_filters(self):
        record_notification(self.a, "push", "reminder", "mine")
        record_notification(self.a, "slack", "comment_reply", "mine2")
        record_notification(self.b, "push", "reminder", "theirs")
        self.client.force_authenticate(self.a)
        titles = {n["title"] for n in self.client.get(NOTIFS).data["results"]}
        self.assertEqual(titles, {"mine", "mine2"})
        by_channel = self.client.get(NOTIFS, {"channel": "push"}).data["results"]
        self.assertEqual([n["title"] for n in by_channel], ["mine"])

    def test_staff_sees_only_own(self):
        staff = _user("boss", staff=True)
        record_notification(self.a, "push", "reminder", "x")
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get(NOTIFS).data["results"], [])

    def test_mark_read_only_touches_own(self):
        mine = record_notification(self.a, "push", "reminder", "m")
        theirs = record_notification(self.b, "push", "reminder", "t")
        self.client.force_authenticate(self.a)
        resp = self.client.post(NOTIFS + "mark-read/", {"ids": [mine.id, theirs.id]}, format="json")
        self.assertEqual(resp.data["updated"], 1)
        mine.refresh_from_db(); theirs.refresh_from_db()
        self.assertIsNotNone(mine.read_at)
        self.assertIsNone(theirs.read_at)

    def test_record_never_raises(self):
        self.assertIsNone(record_notification(None, "push", "x", "t"))


class ReminderRecordsNotificationTests(APITestCase):
    def test_in_app_reminder_is_recorded(self):
        from django.utils import timezone
        from scheduler.models import Reminder
        from scheduler.tasks import _dispatch_reminder

        user = _user("remy")
        r = Reminder.objects.create(
            created_by=user, title="Call", due_at=timezone.now(), notify_in_app=True,
            notify_slack=True,
        )
        _dispatch_reminder(r)
        rows = {n.channel: n.status for n in Notification.objects.filter(user=user)}
        self.assertEqual(rows["in_app"], "sent")
        self.assertEqual(rows["slack"], "skipped")  # no token configured


class PublicItemTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.a, self.b = _user("ann"), _user("bob")
        self.ma, self.mb = _member(self.a), _member(self.b)

    def test_unauthenticated_401(self):
        self.assertEqual(self.client.get(PUBLIC).status_code, 401)

    def test_create_sets_owner_and_anyone_can_read(self):
        self.client.force_authenticate(self.a)
        resp = self.client.post(PUBLIC, {"item_type": "note", "title": "Hi", "body": "<p>x</p><script>1</script>"}, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["owner"], self.a.id)
        self.assertNotIn("<script", resp.data["body"])
        self.client.force_authenticate(self.b)
        got = self.client.get(PUBLIC, {"member": self.ma.id}).data
        self.assertEqual([i["title"] for i in got], ["Hi"])

    def test_list_without_member_is_own_only(self):
        PublicItem.objects.create(owner=self.a, item_type="note", title="A")
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(PUBLIC).data, [])

    def test_cannot_edit_or_delete_others(self):
        item = PublicItem.objects.create(owner=self.a, item_type="note", title="A")
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.patch(f"{PUBLIC}{item.id}/", {"title": "x"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"{PUBLIC}{item.id}/").status_code, 404)

    def test_staff_cannot_edit_others(self):
        item = PublicItem.objects.create(owner=self.a, item_type="note", title="A")
        self.client.force_authenticate(_user("boss", staff=True))
        self.assertEqual(self.client.patch(f"{PUBLIC}{item.id}/", {"title": "x"}, format="json").status_code, 404)

    def test_owner_can_update_and_delete(self):
        item = PublicItem.objects.create(owner=self.a, item_type="note", title="A")
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.patch(f"{PUBLIC}{item.id}/", {"title": "B"}, format="json").data["title"], "B")
        self.assertEqual(self.client.delete(f"{PUBLIC}{item.id}/").status_code, 204)

    def test_rejects_javascript_urls(self):
        self.client.force_authenticate(self.a)
        resp = self.client.post(PUBLIC, {"item_type": "artifact_link", "title": "x", "url": "javascript:alert(1)"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_link_requires_url_and_ref_requires_record(self):
        self.client.force_authenticate(self.a)
        self.assertEqual(self.client.post(PUBLIC, {"item_type": "artifact_link", "title": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(PUBLIC, {"item_type": "record_ref", "title": "x"}, format="json").status_code, 400)

    def test_public_note_keeps_lists_and_checklist_state(self):
        task = (
            '<ul data-type="taskList">'
            '<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li>'
            '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>todo</p></div></li>'
            '</ul><ol><li><p>one</p></li></ol><ul><li><p>dot</p></li></ul>'
        )
        self.client.force_authenticate(self.a)
        body = self.client.post(PUBLIC, {"item_type": "note", "title": "L", "body": task}, format="json").data["body"]
        self.assertIn("\u2611 done", body)
        self.assertIn("\u2610 todo", body)
        self.assertNotIn("<input", body)
        self.assertNotIn("taskList", body)
        self.assertIn("<ol><li>", body)
        self.assertIn("<ul><li><p>dot", body)

    def test_blocked_file_type(self):
        self.client.force_authenticate(self.a)
        f = SimpleUploadedFile("x.sh", b"echo hi")
        resp = self.client.post(PUBLIC, {"item_type": "artifact_file", "title": "x", "file": f}, format="multipart")
        self.assertEqual(resp.status_code, 403)


class MemberProfileAndNoteTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.a, self.b = _user("ann"), _user("bob")
        self.ma, self.mb = _member(self.a), _member(self.b)

    def test_profile_requires_auth_and_hides_private_fields(self):
        self.assertEqual(self.client.get(f"/api/v1/team/members/{self.mb.id}/profile/").status_code, 401)
        self.client.force_authenticate(self.a)
        data = self.client.get(f"/api/v1/team/members/{self.mb.id}/profile/").data
        self.assertEqual(data["full_name"], "Bob")
        self.assertFalse(data["is_self"])
        self.assertNotIn("phone_number", data)

    def test_leave_note_notifies_recipient_and_is_not_public(self):
        self.client.force_authenticate(self.a)
        resp = self.client.post(f"/api/v1/team/members/{self.mb.id}/leave-note/", {"body": "call me"}, format="json")
        self.assertEqual(resp.status_code, 201)
        n = Notification.objects.get(user=self.b)
        self.assertEqual(n.kind, "note_for_you")
        self.assertEqual(PublicItem.objects.count(), 0)
        self.client.force_authenticate(self.b)
        got = self.client.get(f"/api/v1/team/members/{self.mb.id}/leave-note/").data
        self.assertEqual(got[0]["body"], "call me")

    def test_cannot_read_someone_elses_notes(self):
        LeftNote.objects.create(author=self.b, recipient=self.a, body="s")
        self.client.force_authenticate(self.b)
        self.assertEqual(self.client.get(f"/api/v1/team/members/{self.ma.id}/leave-note/").status_code, 403)

    def test_validation(self):
        self.client.force_authenticate(self.a)
        url = f"/api/v1/team/members/{self.mb.id}/leave-note/"
        self.assertEqual(self.client.post(url, {"body": "  "}, format="json").status_code, 400)
        self_url = f"/api/v1/team/members/{self.ma.id}/leave-note/"
        self.assertEqual(self.client.post(self_url, {"body": "hi"}, format="json").status_code, 400)
        ghost = TeamMember.objects.create(full_name="Ghost", email="g@example.com")
        self.assertEqual(self.client.post(f"/api/v1/team/members/{ghost.id}/leave-note/", {"body": "hi"}, format="json").status_code, 400)
