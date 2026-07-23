"""Tests for discover.AppletViewSet — permission enforcement and CRUD."""

from unittest.mock import patch
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from discover.models import Applet

User = get_user_model()

APPLETS_URL = "/api/v1/discover/applets/"


def applet_detail_url(pk):
    return f"/api/v1/discover/applets/{pk}/"


def _make_user(username, is_staff=False):
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="pass"
    )
    user.is_staff = is_staff
    user.save()
    return user


def _make_applet(submitted_by, name="Test Applet"):
    return Applet.objects.create(
        type="applet",
        name=name,
        description="A description",
        url="https://example.com/applet",
        category="Tool",
        author=submitted_by.username,
        submitted_by=submitted_by,
    )


# Patch Airtable write-back helpers so they don't make real HTTP calls
PATCH_CREATE = patch("discover.views.push_applet_create", return_value=None)
PATCH_UPDATE = patch("discover.views.push_applet_update", return_value=None)
PATCH_DELETE = patch("discover.views.push_applet_delete", return_value=None)


class AppletListTest(APITestCase):
    """Any authenticated user can list all applets."""

    def setUp(self):
        self.user = _make_user("reader")
        self.applet = _make_applet(self.user, "Published Applet")

    def test_unauthenticated_returns_401(self):
        resp = self.client.get(APPLETS_URL)
        self.assertEqual(resp.status_code, 401)

    def test_authenticated_can_list(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(APPLETS_URL)
        self.assertEqual(resp.status_code, 200)
        names = [a["name"] for a in resp.data["results"]]
        self.assertIn("Published Applet", names)

    def test_category_filter(self):
        other = _make_applet(self.user, "Bot Applet")
        other.category = "Bot"
        other.save()
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(APPLETS_URL, {"category": "Tool"})
        names = [a["name"] for a in resp.data["results"]]
        self.assertIn("Published Applet", names)
        self.assertNotIn("Bot Applet", names)


class AppletWriteTest(APITestCase):
    """Create, update, delete — submitter or staff only for mutations."""

    def setUp(self):
        self.owner = _make_user("owner")
        self.other = _make_user("stranger")
        self.staff = _make_user("staffadmin", is_staff=True)
        self.applet = _make_applet(self.owner, "Owner Applet")

    @PATCH_CREATE
    def test_authenticated_user_can_create(self, *_):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(APPLETS_URL, {
            "type": "applet",
            "name": "New Applet",
            "description": "Desc",
            "url": "https://example.com/new",
            "category": "Tool",
            "author": "owner",
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Applet.objects.filter(name="New Applet").exists())

    def test_unauthenticated_create_returns_401(self):
        resp = self.client.post(APPLETS_URL, {
            "name": "Bad", "type": "applet",
        }, format="json")
        self.assertEqual(resp.status_code, 401)

    @PATCH_UPDATE
    def test_owner_can_update(self, *_):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.patch(applet_detail_url(self.applet.id), {"name": "Updated"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.applet.refresh_from_db()
        self.assertEqual(self.applet.name, "Updated")

    @PATCH_UPDATE
    def test_non_owner_cannot_update(self, *_):
        self.client.force_authenticate(user=self.other)
        resp = self.client.patch(applet_detail_url(self.applet.id), {"name": "Hack"}, format="json")
        self.assertEqual(resp.status_code, 403)

    @PATCH_UPDATE
    def test_staff_can_update_any_applet(self, *_):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.patch(applet_detail_url(self.applet.id), {"name": "Staff Edit"}, format="json")
        self.assertEqual(resp.status_code, 200)

    @PATCH_DELETE
    def test_owner_can_delete(self, *_):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.delete(applet_detail_url(self.applet.id))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Applet.objects.filter(pk=self.applet.id).exists())

    @PATCH_DELETE
    def test_non_owner_cannot_delete(self, *_):
        self.client.force_authenticate(user=self.other)
        resp = self.client.delete(applet_detail_url(self.applet.id))
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Applet.objects.filter(pk=self.applet.id).exists())
