import logging
from django.conf import settings
from django.db.models import Count, Q
from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from core.mixins import _staff_sees_all, is_admin
from core.pagination import ClientPageSizePagination
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated, SAFE_METHODS
from .models import Applet, AppletPin
from .serializers import AppletSerializer, AppletPinSerializer
from .write_back import push_applet_create, push_applet_update, push_applet_delete

logger = logging.getLogger(__name__)

class AppletViewSet(viewsets.ModelViewSet):
    serializer_class = AppletSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = ClientPageSizePagination

    @action(detail=False, methods=["get"], url_path="tags")
    def tags(self, request):
        """Every tag in use on any item: {tags: [{name, count}]}, most used first."""
        counts: dict[str, list] = {}
        for tag_list in Applet.objects.values_list("tags", flat=True):
            if not isinstance(tag_list, list):
                continue
            for t in tag_list:
                if not isinstance(t, str) or not t.strip():
                    continue
                name = " ".join(t.split())
                entry = counts.setdefault(name.lower(), [name, 0])
                entry[1] += 1
        rows = [{"name": n, "count": c} for n, c in counts.values()]
        rows.sort(key=lambda r: (-r["count"], r["name"].lower()))
        return Response({"tags": rows})

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        # Non-safe methods require the caller to be the applet submitter or staff.
        if request.method not in SAFE_METHODS:
            user = request.user
            if not user.is_staff and obj.submitted_by_id != getattr(user, "pk", None):
                raise PermissionDenied("You do not have permission to modify this applet.")

    def get_queryset(self):
        qs = Applet.objects.all()
        category = self.request.query_params.get("category")
        item_type = self.request.query_params.get("type")
        author = self.request.query_params.get("author")
        search = self.request.query_params.get("search")
        if category:
            qs = qs.filter(category=category)
        if item_type:
            qs = qs.filter(type=item_type)
        if author:
            qs = qs.filter(author=author)
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(description__icontains=search) |
                Q(author__icontains=search) |
                Q(tags__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        applet = serializer.save(submitted_by=self.request.user)
        airtable_id = push_applet_create(applet)
        if airtable_id:
            applet.airtable_id = airtable_id
            applet.save(update_fields=["airtable_id"])

    def perform_update(self, serializer):
        applet = serializer.save()
        push_applet_update(applet)

    def perform_destroy(self, instance):
        airtable_id = instance.airtable_id
        instance.delete()
        push_applet_delete(airtable_id)


def _visible_accounts(user):
    """Accounts whose pins this user may see: the ones they are on (everything for an Admin
    with the staff data view on)."""
    from accounts.models import Account
    if _staff_sees_all(user):
        return Account.objects.all()
    return Account.objects.filter(Q(team_members__user=user) | Q(admin_owner=user)).distinct()


class AppletPinViewSet(viewsets.ModelViewSet):
    """Pins of applets to the caller's profile (account null) or to an account they are on."""
    serializer_class = AppletPinSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        visible = _visible_accounts(user)
        qs = AppletPin.objects.select_related("applet", "account", "user").filter(
            Q(account__isnull=True, user=user) | Q(account__in=visible)
        )
        params = self.request.query_params
        if params.get("profile") == "1":
            qs = qs.filter(account__isnull=True)
        account = params.get("account")
        if account:
            if not account.isdigit() or not visible.filter(pk=int(account)).exists():
                raise Http404
            qs = qs.filter(account_id=int(account))
        applet = params.get("applet")
        if applet and applet.isdigit():
            qs = qs.filter(applet_id=int(applet))
        return qs

    def create(self, request, *args, **kwargs):
        raw_applet = request.data.get("applet")
        raw_account = request.data.get("account")
        try:
            applet = Applet.objects.get(pk=int(raw_applet))
        except (TypeError, ValueError, Applet.DoesNotExist):
            raise Http404
        account = None
        if raw_account not in (None, ""):
            from accounts.models import Account
            try:
                account = _visible_accounts(request.user).get(pk=int(raw_account))
            except (TypeError, ValueError, Account.DoesNotExist) as exc:  # unknown / not theirs: same 404
                raise Http404 from exc
        existing = AppletPin.objects.filter(applet=applet, account=account)
        if account is None:
            existing = existing.filter(user=request.user)
        pin = existing.first()
        created = pin is None
        if created:
            pin = AppletPin.objects.create(applet=applet, user=request.user, account=account)
        data = self.get_serializer(pin).data
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def perform_destroy(self, instance):
        from rest_framework.exceptions import PermissionDenied
        user = self.request.user
        if instance.user_id != user.pk and not is_admin(user):
            raise PermissionDenied("Only the person who pinned this (or an Admin) can remove it.")
        instance.delete()
