"""Admin API for daily token budgets, plus a read-only 'me' view for any signed-in user."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import is_admin

from . import token_budget as tb
from .models import RoleTokenDefault, TokenAlert, UserTokenBudget

User = get_user_model()

MAX_TOKENS = 10_000_000_000  # sanity ceiling; keeps a typo from becoming a "limit" nobody can hit


class _AdminOnly(APIView):
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not is_admin(request.user):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Only admins can manage token budgets.")


def _money(d: Decimal) -> str:
    return f"{d:.4f}"


def _limit_view(tokens: int | None, p) -> dict:
    return {
        "tokens": tokens,
        "usd": _money(tb.tokens_to_usd(tokens, p)) if tokens is not None else None,
    }


class LimitError(ValueError):
    pass


def parse_limit(body: dict, name: str, p) -> tuple[bool, int | None]:
    """
    Read `<name>_tokens` or `<name>_usd` from the body.

    Returns (provided, tokens). `null` clears the limit. Giving both is refused, because
    they could disagree and one of them would silently win.
    """
    has_t, has_u = f"{name}_tokens" in body, f"{name}_usd" in body
    if has_t and has_u:
        raise LimitError(f"Send either {name}_tokens or {name}_usd, not both.")
    if not (has_t or has_u):
        return False, None
    raw = body[f"{name}_tokens"] if has_t else body[f"{name}_usd"]
    if raw is None or raw == "":
        return True, None
    try:
        if has_t:
            if isinstance(raw, bool) or int(raw) != Decimal(str(raw)):
                raise LimitError(f"{name}_tokens must be a whole number.")
            tokens = int(raw)
        else:
            tokens = tb.usd_to_tokens(Decimal(str(raw)), p)
    except (InvalidOperation, ValueError, TypeError):
        raise LimitError(f"{name}_{'tokens' if has_t else 'usd'} must be a number.")
    if tokens < 0 or tokens > MAX_TOKENS:
        raise LimitError(f"{name} must be between 0 and {MAX_TOKENS:,} tokens.")
    return True, tokens


def _check_order(warn, block):
    if warn is not None and block is not None and warn > block:
        raise LimitError("The warn limit can't be higher than the block limit.")


class TokenBudgetOverview(_AdminOnly):
    """GET: pricing, role defaults and every active user's allowance + usage today."""

    def get(self, request):
        p = tb.get_pricing()
        roles = {r.role: r for r in RoleTokenDefault.objects.all()}
        role_rows = [{
            "role": r, "label": tb.ROLE_LABELS[r],
            "warn": _limit_view(roles[r].warn_tokens if r in roles else None, p),
            "block": _limit_view(roles[r].block_tokens if r in roles else None, p),
        } for r in tb.ROLE_ORDER]

        users = []
        for u in User.objects.filter(is_active=True).select_related("profile").order_by("username"):
            st = tb.status_for(u)
            i, o = tb.usage_on(u, tb.local_today(u))
            own = UserTokenBudget.objects.filter(user=u).first()
            b = tb.effective_budget(u)
            since = tb.local_today(u) - timedelta(days=13)
            alert_days = (TokenAlert.objects.filter(user=u, day__gte=since).values("day").distinct().count())
            block_days = TokenAlert.objects.filter(user=u, level="block", day__gte=since).count()
            users.append({
                "user_id": u.pk,
                "username": u.get_username(),
                "display_name": getattr(getattr(u, "profile", None), "display_name", "") or u.get_username(),
                "role": tb.role_of(u),
                "state": st.state,
                "used_tokens": i + o,
                "used_usd": _money(tb.usage_usd(i, o, p)),
                "warn": _limit_view(b.warn, p), "warn_source": b.warn_source,
                "block": _limit_view(b.block, p), "block_source": b.block_source,
                "block_at_warn": b.block_at_warn,
                "has_override": own is not None,
                # "Consistently hit": distinct days in the last 14 on which any limit was reached.
                "days_at_limit_14": alert_days,
                "days_blocked_14": block_days,
            })
        return Response({
            "pricing": _pricing_view(p),
            "roles": role_rows,
            "users": users,
            "period": "daily",
            "counts": "Chat and voice turns, including skill runs. Author-side helpers (generate, review, recommend, estimate) and background summaries are not counted.",
        })


def _pricing_view(p) -> dict:
    blended = tb.blended_usd_per_million(p)
    return {
        "input_usd_per_million": _money(Decimal(p.input_usd_per_million)),
        "output_usd_per_million": _money(Decimal(p.output_usd_per_million)),
        "output_share": str(p.output_share),
        "blended_usd_per_million": _money(blended),
        "example": {"tokens": 1_000_000, "usd": _money(tb.tokens_to_usd(1_000_000, p))},
        "updated_at": p.updated_at,
    }


class TokenPricingView(_AdminOnly):
    def put(self, request):
        p = tb.get_pricing()
        try:
            for field in ("input_usd_per_million", "output_usd_per_million", "output_share"):
                if field in request.data:
                    v = Decimal(str(request.data[field]))
                    if v < 0 or (field == "output_share" and v > 1):
                        raise LimitError(f"{field} is out of range.")
                    setattr(p, field, v)
        except (InvalidOperation, LimitError) as exc:
            return Response({"detail": str(exc) if isinstance(exc, LimitError) else "Prices must be numbers."},
                            status=status.HTTP_400_BAD_REQUEST)
        if tb.blended_usd_per_million(p) <= 0:
            return Response({"detail": "The blended price must be above zero."}, status=status.HTTP_400_BAD_REQUEST)
        p.updated_by = request.user
        p.save()
        return Response(_pricing_view(p))


class RoleDefaultView(_AdminOnly):
    def put(self, request, role):
        if role not in tb.ROLE_LABELS:
            return Response({"detail": "Unknown role."}, status=status.HTTP_404_NOT_FOUND)
        p = tb.get_pricing()
        row, _ = RoleTokenDefault.objects.get_or_create(role=role)
        try:
            for name in ("warn", "block"):
                provided, tokens = parse_limit(request.data, name, p)
                if provided:
                    setattr(row, f"{name}_tokens", tokens)
            _check_order(row.warn_tokens, row.block_tokens)
        except LimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        row.updated_by = request.user
        row.save()
        return Response({"role": role, "label": tb.ROLE_LABELS[role],
                         "warn": _limit_view(row.warn_tokens, p), "block": _limit_view(row.block_tokens, p)})


class UserBudgetView(_AdminOnly):
    def put(self, request, user_id):
        target = User.objects.filter(pk=user_id, is_active=True).first()
        if target is None:
            return Response({"detail": "No such user."}, status=status.HTTP_404_NOT_FOUND)
        p = tb.get_pricing()
        row, _ = UserTokenBudget.objects.get_or_create(user=target)
        try:
            for name in ("warn", "block"):
                provided, tokens = parse_limit(request.data, name, p)
                if provided:
                    setattr(row, f"{name}_tokens", tokens)
            if "block_at_warn" in request.data:
                if not isinstance(request.data["block_at_warn"], bool):
                    raise LimitError("block_at_warn must be true or false.")
                row.block_at_warn = request.data["block_at_warn"]
            b = tb.effective_budget(target)
            # Order is judged on what will actually apply, so overriding only one limit can't
            # silently invert it against the role default for the other.
            warn = row.warn_tokens if row.warn_tokens is not None else (b.warn if b.warn_source == "role" else None)
            block = row.block_tokens if row.block_tokens is not None else (b.block if b.block_source == "role" else None)
            _check_order(warn, block)
        except LimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        row.updated_by = request.user
        row.save()
        eff = tb.effective_budget(target)
        return Response({"user_id": target.pk, "warn": _limit_view(eff.warn, p), "block": _limit_view(eff.block, p),
                         "block_at_warn": eff.block_at_warn, "warn_source": eff.warn_source, "block_source": eff.block_source})

    def delete(self, request, user_id):
        """Drop the override entirely: the person falls back to their role's defaults."""
        UserTokenBudget.objects.filter(user_id=user_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyTokenBudgetView(APIView):
    """GET: the signed-in user's own allowance and usage today. Never exposes anyone else's."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        p = tb.get_pricing()
        st = tb.status_for(request.user)
        return Response({**st.as_dict(), "used_usd": _money(tb.tokens_to_usd(st.used, p))})
