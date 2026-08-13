"""URL configuration for the integrations app."""

from django.urls import path

from .views import (
    AirtableConnectView,
    ConfluenceAPITokenConnectView,
    ConfluenceOAuthCallbackView,
    ConfluenceOAuthInitView,
    GitHubOAuthCallbackView,
    GitHubOAuthInitView,
    GmailOAuthCallbackView,
    GmailOAuthInitView,
    GmailTestView,
    GmailThreadsView,
    GoogleActionItemsPushView,
    GoogleCalendarSyncView,
    GoogleDriveOAuthCallbackView,
    GoogleDriveOAuthInitView,
    GoogleOAuthCallbackView,
    GoogleOAuthInitView,
    IntegrationDisconnectView,
    IntegrationStatusView,
    JiraOAuthCallbackView,
    JiraOAuthInitView,
    MicrosoftOAuthCallbackView,
    MicrosoftOAuthInitView,
    NotionOAuthCallbackView,
    NotionOAuthInitView,
    SalesforceOAuthCallbackView,
    SalesforceOAuthInitView,
    ScraperStatusView,
    SlackNotifyMentionView,
    SlackOAuthCallbackView,
    SlackOAuthInitView,
    SlackWebhookView,
    TwilioWebhookView,
    ZendeskAdminCallbackView,
    ZendeskAdminConnectView,
    ZendeskOAuthCallbackView,
    ZendeskOAuthInitView,
)

urlpatterns = [
    path("status/", IntegrationStatusView.as_view(), name="integration-status"),
    path("scraper-status/", ScraperStatusView.as_view(), name="scraper-status"),
    # Confluence
    path("confluence/connect/", ConfluenceOAuthInitView.as_view(), name="confluence-oauth-init"),
    path("confluence/callback/", ConfluenceOAuthCallbackView.as_view(), name="confluence-oauth-callback"),
    path("confluence/connect-token/", ConfluenceAPITokenConnectView.as_view(), name="confluence-api-token-connect"),
    # JIRA
    path("jira/connect/", JiraOAuthInitView.as_view(), name="jira-oauth-init"),
    path("jira/callback/", JiraOAuthCallbackView.as_view(), name="jira-oauth-callback"),
    # Zendesk per-user
    path("zendesk/connect/", ZendeskOAuthInitView.as_view(), name="zendesk-oauth-init"),
    path("zendesk/callback/", ZendeskOAuthCallbackView.as_view(), name="zendesk-oauth-callback"),
    # Zendesk org-admin
    path("zendesk/admin-connect/", ZendeskAdminConnectView.as_view(), name="zendesk-admin-connect"),
    path("zendesk/admin-callback/", ZendeskAdminCallbackView.as_view(), name="zendesk-admin-callback"),
    path("oauth/<str:provider>/", IntegrationDisconnectView.as_view(), name="integration-disconnect"),
    path("gmail/connect/", GmailOAuthInitView.as_view(), name="gmail-oauth-init"),
    path("gmail/callback/", GmailOAuthCallbackView.as_view(), name="gmail-oauth-callback"),
    path("gmail/test/", GmailTestView.as_view(), name="gmail-test"),
    path("gmail/threads/", GmailThreadsView.as_view(), name="gmail-threads"),
    path("google/connect/", GoogleOAuthInitView.as_view(), name="google-oauth-init"),
    path("google/sync/", GoogleCalendarSyncView.as_view(), name="google-calendar-sync"),
    path("google/push-action-items/", GoogleActionItemsPushView.as_view(), name="google-push-action-items"),
    path("google/callback/", GoogleOAuthCallbackView.as_view(), name="google-oauth-callback"),
    path("slack/connect/", SlackOAuthInitView.as_view(), name="slack-oauth-init"),
    path("slack/callback/", SlackOAuthCallbackView.as_view(), name="slack-oauth-callback"),
    path("slack/notify-mention/", SlackNotifyMentionView.as_view(), name="slack-notify-mention"),
    path("airtable/connect/", AirtableConnectView.as_view(), name="airtable-connect"),
    path("salesforce/connect/", SalesforceOAuthInitView.as_view(), name="sf-oauth-init"),
    path("salesforce/callback/", SalesforceOAuthCallbackView.as_view(), name="sf-oauth-callback"),
    path("webhooks/twilio/", TwilioWebhookView.as_view(), name="twilio-webhook"),
    path("webhooks/slack/", SlackWebhookView.as_view(), name="slack-webhook"),
    # GitHub
    path("github/connect/", GitHubOAuthInitView.as_view(), name="github-oauth-init"),
    path("github/callback/", GitHubOAuthCallbackView.as_view(), name="github-oauth-callback"),
    # Google Drive / Docs / Sheets
    path("google-drive/connect/", GoogleDriveOAuthInitView.as_view(), name="gdrive-oauth-init"),
    path("google-drive/callback/", GoogleDriveOAuthCallbackView.as_view(), name="gdrive-oauth-callback"),
    # Notion
    path("notion/connect/", NotionOAuthInitView.as_view(), name="notion-oauth-init"),
    path("notion/callback/", NotionOAuthCallbackView.as_view(), name="notion-oauth-callback"),
    # Microsoft Teams
    path("microsoft/connect/", MicrosoftOAuthInitView.as_view(), name="ms-oauth-init"),
    path("microsoft/callback/", MicrosoftOAuthCallbackView.as_view(), name="ms-oauth-callback"),
]
