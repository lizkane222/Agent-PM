"""URL configuration for the agents app."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .budget_views import (
    MyTokenBudgetView, RoleDefaultView, TokenBudgetOverview, TokenPricingView, UserBudgetView,
)
from .views import AgentSessionViewSet, AgentToolCatalogView, UserListView

router = DefaultRouter()
router.register("sessions", AgentSessionViewSet, basename="agent-session")

urlpatterns = [
    path("", include(router.urls)),
    path("users/", UserListView.as_view(), name="agent-users-list"),
    path("tools/", AgentToolCatalogView.as_view(), name="agent-tool-catalog"),
    path("token-budgets/", TokenBudgetOverview.as_view(), name="token-budgets"),
    path("token-budgets/me/", MyTokenBudgetView.as_view(), name="token-budget-me"),
    path("token-budgets/pricing/", TokenPricingView.as_view(), name="token-budget-pricing"),
    path("token-budgets/roles/<str:role>/", RoleDefaultView.as_view(), name="token-budget-role"),
    path("token-budgets/users/<int:user_id>/", UserBudgetView.as_view(), name="token-budget-user"),
]
