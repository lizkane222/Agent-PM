"""
JWT authentication middleware for Django Channels WebSocket connections.

AuthMiddlewareStack relies on Django session cookies, which this app does not
use — auth is JWT-only (tokens in localStorage). This middleware reads a `token`
query parameter from the WebSocket URL and resolves it to a Django User so that
downstream consumers see an authenticated scope["user"].
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

User = get_user_model()


@database_sync_to_async
def _user_from_jwt(token_string: str):
    try:
        token = AccessToken(token_string)
        return User.objects.get(pk=token["user_id"])
    except (InvalidToken, TokenError, User.DoesNotExist, KeyError):
        return AnonymousUser()


class JwtAuthMiddleware(BaseMiddleware):
    """Read ?token=<jwt> from the WebSocket query string and populate scope["user"]."""

    async def __call__(self, scope, receive, send):
        qs = parse_qs(scope.get("query_string", b"").decode())
        token_list = qs.get("token", [])
        if token_list:
            scope["user"] = await _user_from_jwt(token_list[0])
        else:
            scope.setdefault("user", AnonymousUser())
        return await super().__call__(scope, receive, send)
