"""ASGI config — Django Channels wraps the standard ASGI application."""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application
from django.urls import re_path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

django_asgi_app = get_asgi_application()

# Import routing after Django setup so apps are ready.
from realtime.routing import websocket_urlpatterns  # noqa: E402
from realtime.consumers import ConversationRelayConsumer  # noqa: E402
from realtime.jwt_auth_middleware import JwtAuthMiddleware  # noqa: E402

# /ws/voice-relay/ is called directly by Twilio's servers — no browser Origin header,
# no JWT. It must sit outside both AllowedHostsOriginValidator and JwtAuthMiddleware.
# All other WebSocket paths require a valid Origin and a JWT passed as ?token=<jwt>.
_relay_patterns = [
    re_path(r"^ws/voice-relay/$", ConversationRelayConsumer.as_asgi()),
]

_authenticated_patterns = [
    p for p in websocket_urlpatterns
    if not getattr(p.pattern, "_route", "").startswith("ws/voice-relay")
]

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(
            _relay_patterns
            + [
                re_path(
                    r"^",
                    AllowedHostsOriginValidator(
                        JwtAuthMiddleware(URLRouter(_authenticated_patterns))
                    ),
                )
            ]
        ),
    }
)
