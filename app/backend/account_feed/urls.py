from django.urls import path

from .views import AccountFeedConfigView, AccountFeedCustomFieldView

urlpatterns = [
    path("<int:account_id>/feed/", AccountFeedConfigView.as_view(), name="account-feed-config"),
    path("<int:account_id>/feed/custom-fields/", AccountFeedCustomFieldView.as_view(), name="account-feed-custom-fields"),
    path("<int:account_id>/feed/custom-fields/<int:field_id>/", AccountFeedCustomFieldView.as_view(), name="account-feed-custom-field-detail"),
]
