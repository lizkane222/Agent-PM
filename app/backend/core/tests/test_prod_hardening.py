"""Production must fail closed, and the env overrides must still allow a plain-HTTP first launch."""
import json
import os
import subprocess
import sys
from pathlib import Path

from rest_framework.test import APITestCase

BACKEND = Path(__file__).resolve().parents[2]
GOOD_KEY = "k" * 50


def _settings(**env):
    base = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "CSRF_", "DRF_"))}
    base.update({"DJANGO_SETTINGS_MODULE": "core.settings", "DJANGO_DEBUG": "False",
                 "DJANGO_SECRET_KEY": GOOD_KEY})
    base.update(env)
    code = (
        "import json, django; from django.conf import settings as s;"
        "print(json.dumps({k: getattr(s, k, None) for k in ['SESSION_COOKIE_SECURE','CSRF_COOKIE_SECURE',"
        "'SECURE_SSL_REDIRECT','SECURE_HSTS_SECONDS','USE_X_FORWARDED_HOST','CSRF_TRUSTED_ORIGINS','ALLOWED_HOSTS']}))"
    )
    return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=base, capture_output=True, text=True)


class ProductionSettingsTest(APITestCase):
    def test_secure_by_default_when_debug_off(self):
        out = _settings()
        self.assertEqual(out.returncode, 0, out.stderr[-500:])
        cfg = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertTrue(cfg["SESSION_COOKIE_SECURE"])
        self.assertTrue(cfg["CSRF_COOKIE_SECURE"])
        self.assertTrue(cfg["SECURE_SSL_REDIRECT"])
        self.assertGreater(cfg["SECURE_HSTS_SECONDS"], 0)
        self.assertFalse(cfg["USE_X_FORWARDED_HOST"])

    def test_plain_http_launch_can_be_enabled_from_env(self):
        out = _settings(DJANGO_SECURE_SSL_REDIRECT="False", DJANGO_COOKIE_SECURE="False",
                        DJANGO_SECURE_HSTS_SECONDS="0", CSRF_TRUSTED_ORIGINS="https://a.example, https://b.example",
                        DJANGO_ALLOWED_HOSTS="a.example, b.example")
        self.assertEqual(out.returncode, 0, out.stderr[-500:])
        cfg = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertFalse(cfg["SECURE_SSL_REDIRECT"])
        self.assertFalse(cfg["SESSION_COOKIE_SECURE"])
        self.assertEqual(cfg["SECURE_HSTS_SECONDS"], 0)
        self.assertEqual(cfg["CSRF_TRUSTED_ORIGINS"], ["https://a.example", "https://b.example"])
        self.assertEqual(cfg["ALLOWED_HOSTS"], ["a.example", "b.example"])

    def test_weak_secret_key_is_refused_in_production(self):
        for key in ("short", "django-insecure-" + "x" * 50):
            self.assertNotEqual(_settings(DJANGO_SECRET_KEY=key).returncode, 0, key)


class HealthAndSchemaTest(APITestCase):
    def test_health_is_public_and_returns_no_data(self):
        for path in ("/health/", "/api/v1/health/"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertEqual(r.content, b"")

    def test_schema_requires_authentication(self):
        self.assertEqual(self.client.get("/api/schema/").status_code, 401)
        self.assertEqual(self.client.get("/api/schema/swagger-ui/").status_code, 401)
