"""
Management command: sync_ngrok

Reads the active ngrok tunnel URL from the local ngrok API, then:
  1. Updates the Twilio TwiML App's voice_url and status_callback to point
     at the new ngrok host.
  2. Rewrites DJANGO_ALLOWED_HOSTS in .env so the Django process (after
     restart) accepts requests from that host.

Usage:
    python manage.py sync_ngrok

Run this once each time you start a new ngrok session before starting
the Django dev server, or right after `ngrok http 8000` is up.
"""

import os
import re
import urllib.request
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


NGROK_API = "http://127.0.0.1:4040/api/tunnels"
ENV_PATH = Path(settings.BASE_DIR).parent / ".env"


def _get_ngrok_url() -> str:
    """Return the first https public URL from the local ngrok API."""
    try:
        with urllib.request.urlopen(NGROK_API, timeout=3) as resp:
            data = json.loads(resp.read())
    except Exception as exc:
        raise CommandError(
            f"Could not reach ngrok local API at {NGROK_API}. "
            f"Is ngrok running? ({exc})"
        )

    tunnels = data.get("tunnels", [])
    for tunnel in tunnels:
        url = tunnel.get("public_url", "")
        if url.startswith("https://"):
            return url.rstrip("/")

    raise CommandError(
        "No https tunnel found in ngrok. Make sure ngrok is forwarding to port 8000."
    )


def _update_env_allowed_hosts(ngrok_host: str) -> None:
    """Rewrite DJANGO_ALLOWED_HOSTS in .env to include the ngrok hostname."""
    if not ENV_PATH.exists():
        return

    text = ENV_PATH.read_text()
    current_line = re.search(r"^DJANGO_ALLOWED_HOSTS=(.*)$", text, re.MULTILINE)
    if not current_line:
        return

    hosts = [h.strip() for h in current_line.group(1).split(",") if h.strip()]

    # Remove any stale ngrok hostname and add the new one.
    hosts = [h for h in hosts if "ngrok" not in h]
    hosts.append(ngrok_host)

    new_line = f"DJANGO_ALLOWED_HOSTS={','.join(hosts)}"
    text = re.sub(r"^DJANGO_ALLOWED_HOSTS=.*$", new_line, text, flags=re.MULTILINE)
    ENV_PATH.write_text(text)


def _update_twilio_app(ngrok_url: str) -> dict:
    """Update the TwiML App's voice_url and status_callback, return updated values."""
    from twilio.rest import Client

    account_sid = settings.TWILIO_ACCOUNT_SID
    auth_token = settings.TWILIO_AUTH_TOKEN
    app_sid = settings.TWILIO_TWIML_APP_SID

    if not all([account_sid, auth_token, app_sid]):
        raise CommandError(
            "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_TWIML_APP_SID "
            "must all be set in .env."
        )

    client = Client(account_sid, auth_token)
    app = client.applications(app_sid).update(
        voice_url=f"{ngrok_url}/api/v1/realtime/voice/twiml/",
        voice_method="POST",
        status_callback=f"{ngrok_url}/api/v1/realtime/voice/status/",
        status_callback_method="POST",
    )
    return {
        "voice_url": app.voice_url,
        "status_callback": app.status_callback,
    }


class Command(BaseCommand):
    help = "Sync active ngrok tunnel URL into Twilio TwiML App and .env ALLOWED_HOSTS."

    def handle(self, *args, **options):
        self.stdout.write("Detecting ngrok tunnel…")
        ngrok_url = _get_ngrok_url()
        ngrok_host = ngrok_url.replace("https://", "")
        self.stdout.write(f"  Found: {ngrok_url}")

        self.stdout.write("Updating Twilio TwiML App…")
        urls = _update_twilio_app(ngrok_url)
        self.stdout.write(f"  voice_url       → {urls['voice_url']}")
        self.stdout.write(f"  status_callback → {urls['status_callback']}")

        self.stdout.write(f"Updating {ENV_PATH.name} ALLOWED_HOSTS…")
        _update_env_allowed_hosts(ngrok_host)
        self.stdout.write(f"  Added {ngrok_host}")

        self.stdout.write(self.style.SUCCESS(
            "\nDone. Restart Django (if already running) for ALLOWED_HOSTS to take effect."
        ))
