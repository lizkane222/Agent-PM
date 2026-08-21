/**
 * SettingsPage — OAuth connections, Twilio config, and notification preferences.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { integrationsApi, teamApi } from "../lib/api";
import { logout } from "../lib/auth";
import SettingsIcon from "../assets/icons/Settings.svg?react";
import { useNotificationDefaults } from "../context/NotificationDefaultsContext";
import type { OAuthCredential, UserProfile } from "../types";
import TagInput from "../components/shared/TagInput";

function _urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function useEditAppEnabled() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("editAppEnabled") === "true");
  function toggle(v: boolean) {
    setEnabled(v);
    localStorage.setItem("editAppEnabled", String(v));
    window.dispatchEvent(new StorageEvent("storage", { key: "editAppEnabled", newValue: String(v) }));
  }
  return { enabled, toggle };
}

function ConnectionCard({
  name,
  description,
  isConnected,
  connectedEmail,
  expiresAt,
  onConnect,
  onTest,
  provider,
  onDisconnected,
  afterContent,
}: {
  name: string;
  description: string;
  isConnected: boolean;
  connectedEmail?: string;
  expiresAt?: string | null;
  onConnect: () => void;
  onTest?: () => Promise<{ label: string; ok: boolean; detail: string }>;
  provider?: string;
  onDisconnected?: () => void;
  afterContent?: ReactNode;
}) {
  const [testState, setTestState] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [testDetail, setTestDetail] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  async function runTest() {
    if (!onTest) return;
    setTestState("running");
    setTestDetail("");
    try {
      const result = await onTest();
      setTestState(result.ok ? "pass" : "fail");
      setTestDetail(result.detail);
    } catch {
      setTestState("fail");
      setTestDetail("Unexpected error — check console.");
    }
  }

  async function runDisconnect() {
    if (!provider) return;
    if (!confirmDisconnect) { setConfirmDisconnect(true); return; }
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await integrationsApi.disconnect(provider);
      onDisconnected?.();
    } catch {
      setDisconnectError("Failed to disconnect. Try again.");
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }

  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 pr-4">
          <p className="text-sm font-medium text-[var(--twilio-navy)]">{name}</p>
          <p className="text-sm text-[var(--twilio-navy)] mt-0.5">{description}</p>
          {isConnected && connectedEmail && (
            <p className="text-sm text-indigo-600 mt-1">{connectedEmail}</p>
          )}
          {isConnected && expiresAt && (
            <p className="text-sm text-[var(--twilio-navy)] mt-0.5">
              Token expires: {new Date(expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {isConnected && onTest && (
            <button
              onClick={() => void runTest()}
              disabled={testState === "running"}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {testState === "running" ? "Testing…" : "Test"}
            </button>
          )}
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Successfully Connected!
            </span>
          ) : (
            <button
              onClick={onConnect}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Connect
            </button>
          )}
          {isConnected && provider && onDisconnected && (
            <>
              <button
                onClick={() => void runDisconnect()}
                disabled={disconnecting}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  confirmDisconnect
                    ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
                title="Revoke this app's access token — you can reconnect anytime."
              >
                {disconnecting ? "Disconnecting…" : confirmDisconnect ? "Confirm disconnect" : "Disconnect"}
              </button>
              {confirmDisconnect && !disconnecting && (
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {testState !== "idle" && testDetail && (
        <p className={`mt-2 text-xs rounded px-2 py-1 ${testState === "pass" ? "bg-green-50 text-green-700" : testState === "fail" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-500"}`}>
          {testDetail}
        </p>
      )}
      {disconnectError && (
        <p className="mt-2 text-xs rounded px-2 py-1 bg-red-50 text-red-700">{disconnectError}</p>
      )}
      {afterContent && (
        <div className="mt-3 border-t border-gray-50 pt-3">{afterContent}</div>
      )}
    </div>
  );
}

function StaffGmailKeywordsSection() {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await teamApi.getGmailKeywords();
        setKeywords(data.keywords);
      } catch {
        setError("Failed to load Gmail keywords");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const { data } = await teamApi.setGmailKeywords(keywords);
      setKeywords(data.keywords);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch {
      setError("Failed to save Gmail keywords");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return null;

  return (
    <section className="bg-white rounded-lg border border-amber-200 shadow-sm">
      <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-2">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-500 shrink-0">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <div>
          <h2 className="text-sm font-semibold text-amber-900">Gmail Default Keywords</h2>
          <p className="text-xs text-amber-700 mt-0.5">These keywords are used as defaults for all users' Gmail sync filters.</p>
        </div>
      </div>
      <div className="px-6 py-5 space-y-4">
        <TagInput
          tags={keywords}
          onChange={setKeywords}
          label="Default Keywords"
          hint="Add keywords that will be suggested to all users as Gmail sync filters. All users' keyword lists merge with these defaults."
          placeholder="Add keyword and press Enter…"
          maxTags={100}
        />
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save Keywords"}
        </button>
        {saveSuccess && (
          <p className="text-sm text-green-600 font-medium">Default keywords saved.</p>
        )}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<OAuthCredential[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [airtableSynced, setAirtableSynced] = useState(false);
  const [pushStatus, setPushStatus] = useState<"idle" | "requesting" | "registered" | "denied" | "unsupported">("idle");
  const [gmailWatchState, setGmailWatchState] = useState<"idle" | "registering" | "success" | "error">("idle");
  const [gmailConfig, setGmailConfig] = useState<{ label_name?: string; keywords?: string[]; block_keywords?: string[] }>({});
  const [gmailConfigIsSaving, setGmailConfigIsSaving] = useState(false);
  const [gmailConfigSaveSuccess, setGmailConfigSaveSuccess] = useState(false);
  const [scraperStatus, setScraperStatus] = useState<{ confluence: boolean; jira: boolean; zendesk: boolean; gong: boolean; notion: boolean } | null>(null);
  const pushRegistered = useRef(false);
  const { defaults: notifDefaults, setDefaults: setNotifDefaults } = useNotificationDefaults();

  useEffect(() => {
    (async () => {
      try {
        const [statusRes, profileRes, scraperRes] = await Promise.all([
          integrationsApi.getStatus(),
          teamApi.getMyProfile(),
          integrationsApi.getScraperStatus(),
        ]);
        setCredentials(statusRes.data.connected);
        setProfile(profileRes.data);
        setScraperStatus(scraperRes.data);
        // Load Gmail config from profile
        if (profileRes.data.gmail_watch_config) {
          setGmailConfig(profileRes.data.gmail_watch_config);
        }
        if (profileRes.data.push_subscription_active) {
          setPushStatus("registered");
          pushRegistered.current = true;
        }
      } catch {
        // Fail gracefully.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const isConnected = (provider: string) =>
    credentials.some((c) => c.provider === provider && c.is_active);

  const getCredential = (provider: string) =>
    credentials.find((c) => c.provider === provider);

  const handleGoogleConnect = useCallback(async () => {
    try {
      const { data } = await integrationsApi.startGoogleConnect();
      const popup = window.open(data.authorization_url, "_blank");
      const poll = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(poll);
          try {
            const { data: status } = await integrationsApi.getStatus();
            setCredentials(status.connected);
          } catch {}
        }
      }, 500);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: unknown } };
      const status = axiosErr?.response?.status;
      const detail = JSON.stringify(axiosErr?.response?.data ?? String(err));
      alert(`Google OAuth failed (HTTP ${status ?? "network error"}): ${detail}`);
    }
  }, []);

  const handleDisconnected = useCallback((provider: string) => {
    setCredentials((prev) => prev.filter((c) => c.provider !== provider));
  }, []);

  const handleSlackConnect = useCallback(async () => {
    try {
      const { data } = await integrationsApi.startSlackConnect();
      window.open(data.authorization_url, "_blank");
    } catch {
      alert("Failed to start Slack OAuth flow.");
    }
  }, []);

  const handleAirtableConnect = useCallback(async () => {
    try {
      await integrationsApi.connectAirtable();
      const { data } = await integrationsApi.getStatus();
      setCredentials(data.connected);
    } catch {
      alert("Failed to connect Airtable. Ensure AIRTABLE_API_KEY is set in .env.");
    }
  }, []);

  const handleOAuthPopup = useCallback((_provider: string, url: string) => {
    const popup = window.open(url, "_blank");
    const poll = setInterval(async () => {
      if (popup?.closed) {
        clearInterval(poll);
        try {
          const { data } = await integrationsApi.getStatus();
          setCredentials(data.connected);
        } catch {}
      }
    }, 500);
  }, []);

  const { enabled: editAppEnabled, toggle: toggleEditApp } = useEditAppEnabled();

  const handleProfileSave = useCallback(async () => {
    if (!profile) return;
    setIsSavingProfile(true);
    setAirtableSynced(false);
    try {
      const { data } = await teamApi.updateMyProfile({
        display_name: profile.display_name,
        title: profile.title,
        timezone: profile.timezone,
        phone_number: profile.phone_number,
        google_account_email: profile.google_account_email,
        slack_user_id: profile.slack_user_id,
        notification_email: profile.notification_email,
        notification_slack: profile.notification_slack,
      });
      setProfile(data);
      setSaveSuccess(true);
      if (data.airtable_collaborator_id) setAirtableSynced(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch {
      alert("Failed to save profile.");
    } finally {
      setIsSavingProfile(false);
    }
  }, [profile]);

  const handleGmailWatchRegister = useCallback(async () => {
    setGmailWatchState("registering");
    try {
      await integrationsApi.registerGmailWatch();
      setGmailWatchState("success");
      setTimeout(() => setGmailWatchState("idle"), 4000);
    } catch {
      setGmailWatchState("error");
      setTimeout(() => setGmailWatchState("idle"), 4000);
    }
  }, []);

  const handleSaveGmailConfig = useCallback(async () => {
    if (!profile) return;
    setGmailConfigIsSaving(true);
    try {
      const { data } = await teamApi.updateMyProfile({
        gmail_watch_config: gmailConfig,
      });
      setProfile(data);
      setGmailConfig(data.gmail_watch_config || {});
      setGmailConfigSaveSuccess(true);
      setTimeout(() => setGmailConfigSaveSuccess(false), 4000);
    } catch {
      alert("Failed to save Gmail config.");
    } finally {
      setGmailConfigIsSaving(false);
    }
  }, [profile, gmailConfig]);

  const handleSignOut = useCallback(async () => {
    await logout();
    window.location.href = "/oidc/logout/";
  }, []);

  const handlePushRegister = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("unsupported");
      return;
    }
    if (pushStatus === "registered") {
      // Unregister
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await teamApi.deletePushSubscription();
        setPushStatus("idle");
        pushRegistered.current = false;
        setProfile((p) => p ? { ...p, push_subscription_active: false } : p);
      } catch {
        alert("Failed to unregister push notifications.");
      }
      return;
    }
    setPushStatus("requesting");
    try {
      // Fetch VAPID public key
      const keyRes = await fetch("/api/v1/push/vapid-public-key/");
      if (!keyRes.ok) {
        alert(`Push notifications unavailable (server returned ${keyRes.status}). Restart the backend and try again.`);
        setPushStatus("idle");
        return;
      }
      const { vapid_public_key } = await keyRes.json() as { vapid_public_key: string };
      if (!vapid_public_key) {
        alert("Push notifications are not configured on the server yet. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to your .env and restart.");
        setPushStatus("idle");
        return;
      }

      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Request OS permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushStatus("denied");
        return;
      }

      // Subscribe to push
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(vapid_public_key) as BufferSource,
      });

      await teamApi.savePushSubscription(sub.toJSON());
      setPushStatus("registered");
      pushRegistered.current = true;
      setProfile((p) => p ? { ...p, push_subscription_active: true } : p);
    } catch (err) {
      console.error("Push registration failed:", err);
      setPushStatus("idle");
      alert("Failed to enable push notifications. Check browser console for details.");
    }
  }, [pushStatus]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-[var(--twilio-navy)]">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto space-y-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] flex items-center gap-2"><SettingsIcon width={24} height={24} style={{ flexShrink: 0 }} />Settings</h1>
          <p className="text-sm text-[var(--twilio-navy)] mt-1">
            Manage your integrations, profile, and notification preferences.
          </p>
        </div>
        <button
          onClick={() => void handleSignOut()}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>

      {/* Integrations */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Integrations</h2>
          <p className="text-sm text-[var(--twilio-navy)] mt-0.5">
            Connect third-party services for the agent to use.
          </p>
        </div>
        <div className="px-6 py-2">
          <ConnectionCard
            name="Google Calendar & Gmail"
            description="Read and write calendar events, send and read emails."
            isConnected={isConnected("google")}
            connectedEmail={getCredential("google")?.scopes.includes("email") ? "Connected" : undefined}
            expiresAt={getCredential("google")?.token_expiry}
            onConnect={handleGoogleConnect}
            provider="google"
            onDisconnected={() => handleDisconnected("google")}
            onTest={async () => {
              const { data } = await integrationsApi.testGmail();
              if (data.ok) {
                const scopeNote = data.gmail_scope_granted ? "Gmail scope granted" : "Warning: Gmail scope not granted — re-connect to add it";
                return {
                  label: "Gmail test",
                  ok: true,
                  detail: `Connected as ${data.email} · ${data.messages_total?.toLocaleString() ?? "?"} messages · ${scopeNote}`,
                };
              }
              return { label: "Gmail test", ok: false, detail: data.error ?? "Unknown error" };
            }}
          />
          <ConnectionCard
            name="Gmail"
            description="Connect your Gmail inbox to read and send emails. Uses your Okta Google tile if configured."
            isConnected={isConnected("gmail")}
            connectedEmail={getCredential("gmail")?.scopes?.includes("email") ? "Connected" : undefined}
            expiresAt={getCredential("gmail")?.token_expiry}
            provider="gmail"
            onDisconnected={() => handleDisconnected("gmail")}
            onConnect={async () => {
              try {
                const { data } = await integrationsApi.startGmailConnect();
                handleOAuthPopup("gmail", data.authorization_url);
              } catch {
                alert("Failed to start Gmail OAuth. Ensure GOOGLE_CLIENT_ID and GMAIL_REDIRECT_URI are set in .env.");
              }
            }}
            onTest={async () => {
              const { data } = await integrationsApi.testGmail();
              if (data.ok) {
                return {
                  label: "Gmail test",
                  ok: true,
                  detail: `Connected as ${data.email} · ${data.messages_total?.toLocaleString() ?? "?"} messages`,
                };
              }
              return { label: "Gmail test", ok: false, detail: data.error ?? "Unknown error" };
            }}
            afterContent={
              isConnected("gmail") ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => void handleGmailWatchRegister()}
                    disabled={gmailWatchState === "registering"}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {gmailWatchState === "registering" ? "Registering…" : "Register Gmail watch"}
                  </button>
                  {gmailWatchState === "success" && (
                    <span className="text-sm text-green-600 font-medium">Watch registered — new emails will be synced automatically.</span>
                  )}
                  {gmailWatchState === "error" && (
                    <span className="text-sm text-red-600">Failed to register watch. Check that Celery is running.</span>
                  )}
                </div>
              ) : undefined
            }
          />
          {isConnected("gmail") && (
            <div className="py-4 border-b border-gray-100">
              <details className="group">
                <summary className="cursor-pointer flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--twilio-navy)]">Gmail Sync Filters</p>
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-2">
                      Gmail Label to Watch (optional)
                    </label>
                    <input
                      type="text"
                      value={gmailConfig.label_name ?? ""}
                      onChange={(e) =>
                        setGmailConfig((prev) => ({ ...prev, label_name: e.target.value }))
                      }
                      placeholder="e.g., Agent PM - Threads"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Leave blank to watch all INBOX emails. If set, only emails in this label are synced.
                    </p>
                  </div>
                  <TagInput
                    tags={gmailConfig.keywords ?? []}
                    onChange={(keywords) => setGmailConfig((prev) => ({ ...prev, keywords }))}
                    label="Keywords to Match"
                    hint="Add keywords to filter emails. Fuzzy matching catches typos. Leave empty to match all (unless blocked)."
                    placeholder="Add keyword and press Enter…"
                    maxTags={100}
                  />
                  <TagInput
                    tags={gmailConfig.block_keywords ?? []}
                    onChange={(block_keywords) =>
                      setGmailConfig((prev) => ({ ...prev, block_keywords }))
                    }
                    label="Block Keywords"
                    hint="Emails matching these keywords are skipped, even if they match keywords above."
                    placeholder="Add keyword to block and press Enter…"
                    maxTags={100}
                  />
                  <button
                    onClick={() => void handleSaveGmailConfig()}
                    disabled={gmailConfigIsSaving}
                    className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {gmailConfigIsSaving ? "Saving…" : "Save Gmail Filters"}
                  </button>
                  {gmailConfigSaveSuccess && (
                    <p className="text-sm text-green-600 font-medium">Gmail filters saved.</p>
                  )}
                </div>
              </details>
            </div>
          )}
          <ConnectionCard
            name="Slack"
            description="Read messages and threads from your workspace."
            isConnected={isConnected("slack")}
            provider="slack"
            onDisconnected={() => handleDisconnected("slack")}
            onConnect={() => void handleSlackConnect()}
          />
          <ConnectionCard
            name="Airtable"
            description="Read and write records in your team's Airtable bases."
            isConnected={isConnected("airtable")}
            provider="airtable"
            onDisconnected={() => handleDisconnected("airtable")}
            onConnect={() => void handleAirtableConnect()}
          />
          <ConnectionCard
            name="Salesforce (Cloud Coach)"
            description="Sync accounts, projects, tasks, log time, and post Chatter updates."
            isConnected={isConnected("salesforce")}
            provider="salesforce"
            onDisconnected={() => handleDisconnected("salesforce")}
            onConnect={async () => {
              try {
                const { data } = await integrationsApi.startSalesforceConnect();
                handleOAuthPopup("salesforce", data.authorization_url);
              } catch {
                alert("Failed to start Salesforce OAuth. Ensure SALESFORCE_CLIENT_ID and SALESFORCE_INSTANCE_URL are set in .env.");
              }
            }}
          />
          <ConnectionCard
            name="Gong"
            description="Pull call recordings, transcripts, and deal insights."
            isConnected={isConnected("gong")}
            provider="gong"
            onDisconnected={() => handleDisconnected("gong")}
            onConnect={() => handleOAuthPopup("gong", `${import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1"}/integrations/gong/connect/`)}
          />
          <ConnectionCard
            name="Zoom"
            description="Schedule meetings and access call recordings."
            isConnected={isConnected("zoom")}
            provider="zoom"
            onDisconnected={() => handleDisconnected("zoom")}
            onConnect={() => handleOAuthPopup("zoom", `${import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1"}/integrations/zoom/connect/`)}
          />
          <ConnectionCard
            name="Lucidchart"
            description="View and embed diagrams and process flows."
            isConnected={isConnected("lucidchart")}
            provider="lucidchart"
            onDisconnected={() => handleDisconnected("lucidchart")}
            onConnect={() => handleOAuthPopup("lucidchart", `${import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1"}/integrations/lucidchart/connect/`)}
          />
          <ConnectionCard
            name="GitHub"
            description="Read repositories, issues, pull requests, and commit history."
            isConnected={isConnected("github")}
            provider="github"
            onDisconnected={() => handleDisconnected("github")}
            onConnect={async () => {
              try {
                const { data } = await integrationsApi.startGitHubConnect();
                handleOAuthPopup("github", data.authorization_url);
              } catch {
                alert("Failed to start GitHub OAuth. Ensure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set in .env.");
              }
            }}
          />
          <ConnectionCard
            name="Google Drive, Docs & Sheets"
            description="Read and reference files, documents, and spreadsheets from Drive."
            isConnected={isConnected("google_drive")}
            provider="google_drive"
            onDisconnected={() => handleDisconnected("google_drive")}
            onConnect={async () => {
              try {
                const { data } = await integrationsApi.startGoogleDriveConnect();
                handleOAuthPopup("google_drive", data.authorization_url);
              } catch {
                alert("Failed to start Google Drive OAuth. Ensure GOOGLE_CLIENT_ID and GOOGLE_DRIVE_REDIRECT_URI are set in .env.");
              }
            }}
          />
          <ConnectionCard
            name="Notion"
            description="Read pages, databases, and workspace content from Notion."
            isConnected={isConnected("notion")}
            provider="notion"
            onDisconnected={() => handleDisconnected("notion")}
            onConnect={async () => {
              try {
                const { data } = await integrationsApi.startNotionConnect();
                handleOAuthPopup("notion", data.authorization_url);
              } catch {
                alert("Failed to start Notion OAuth. Ensure NOTION_CLIENT_ID and NOTION_CLIENT_SECRET are set in .env.");
              }
            }}
          />
          <ConnectionCard
            name="Microsoft Teams"
            description="Read Teams channels, chats, and messages from your organisation."
            isConnected={isConnected("microsoft")}
            provider="microsoft"
            onDisconnected={() => handleDisconnected("microsoft")}
            onConnect={async () => {
              try {
                const { data } = await integrationsApi.startMicrosoftConnect();
                handleOAuthPopup("microsoft", data.authorization_url);
              } catch {
                alert("Failed to start Microsoft OAuth. Ensure MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are set in .env.");
              }
            }}
          />
        </div>
      </section>

      {/* Organization Data Sources */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Organization Data Sources</h2>
          <p className="text-sm text-[var(--twilio-navy)] mt-0.5">
            Server-side scrapers that index your organization's knowledge bases on a schedule.
          </p>
        </div>
        <div className="px-6 py-2 divide-y divide-gray-100">
          {(["confluence", "jira", "zendesk", "gong", "notion"] as const).map((key) => (
            <div key={key} className="py-3 flex items-center justify-between">
              <p className="text-sm font-medium text-[var(--twilio-navy)] capitalize">{key}</p>
              {scraperStatus?.[key] ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Active
                </span>
              ) : (
                <span className="text-sm text-[var(--twilio-gray-60)]">Token not configured</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Twilio */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Twilio Voice & Sync</h2>
          <p className="text-sm text-[var(--twilio-navy)] mt-0.5">
            Twilio credentials are configured via environment variables on the server.
          </p>
        </div>
        <div className="px-6 py-4 text-sm text-[var(--twilio-navy)] space-y-2">
          <p>
            Set <code className="bg-gray-100 px-1 rounded text-sm">TWILIO_ACCOUNT_SID</code>,{" "}
            <code className="bg-gray-100 px-1 rounded text-sm">TWILIO_AUTH_TOKEN</code>, and{" "}
            <code className="bg-gray-100 px-1 rounded text-sm">TWILIO_SYNC_SERVICE_SID</code> in
            your <code className="bg-gray-100 px-1 rounded text-sm">.env</code> file.
          </p>
          <p className="text-[var(--twilio-navy)] text-sm">
            The Sync token endpoint is at{" "}
            <code className="bg-gray-100 px-1 rounded">/api/v1/realtime/sync-token/</code>.
          </p>
        </div>
      </section>

      {/* Profile */}
      {profile && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Your Profile</h2>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={profile.display_name ?? ""}
                  onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">
                  Job Title
                </label>
                <input
                  type="text"
                  value={profile.title ?? ""}
                  onChange={(e) => setProfile({ ...profile, title: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">
                  Twilio Email
                </label>
                <input
                  type="email"
                  value={profile.google_account_email ?? ""}
                  onChange={(e) => setProfile({ ...profile, google_account_email: e.target.value })}
                  placeholder="Twilio Email"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">
                  Slack
                </label>
                <input
                  type="text"
                  value={profile.slack_user_id ?? ""}
                  onChange={(e) => setProfile({ ...profile, slack_user_id: e.target.value })}
                  placeholder="username"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={profile.phone_number ?? ""}
                  onChange={(e) => setProfile({ ...profile, phone_number: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">
                  Timezone
                </label>
                <input
                  type="text"
                  value={profile.timezone ?? ""}
                  onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                  placeholder="America/New_York"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-[var(--twilio-navy)]">Reminder notification defaults</p>
                <p className="text-xs text-[var(--twilio-gray-60)] mt-0.5">
                  These channels are pre-selected when you create a new reminder. You can override them per reminder.
                </p>
              </div>

              {/* In-App */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifDefaults.notify_default_in_app}
                  onChange={(e) => setNotifDefaults({ notify_default_in_app: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--twilio-navy)]">In-app</p>
                  <p className="text-xs text-[var(--twilio-gray-60)]">Appears in the activity feed while the app is open.</p>
                </div>
              </label>

              {/* Slack */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifDefaults.notify_default_slack}
                  onChange={(e) => setNotifDefaults({ notify_default_slack: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--twilio-navy)]">Slack DM</p>
                  <p className="text-xs text-[var(--twilio-gray-60)]">
                    Sent to your Slack user ID via the org bot.
                    {!profile.slack_user_id && (
                      <span className="text-amber-600"> Add your Slack user ID above to enable this.</span>
                    )}
                  </p>
                </div>
              </label>

              {/* Laptop / Web Push */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={notifDefaults.notify_default_push}
                  onChange={(e) => setNotifDefaults({ notify_default_push: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--twilio-navy)]">Laptop (desktop push)</p>
                  <p className="text-xs text-[var(--twilio-gray-60)] mb-2">
                    OS-level desktop notification — works even when this tab is in the background.
                  </p>
                  {pushStatus === "unsupported" && (
                    <p className="text-xs text-red-600">Your browser doesn't support push notifications.</p>
                  )}
                  {pushStatus === "denied" && (
                    <p className="text-xs text-red-600">Permission denied. Allow notifications in your browser settings and try again.</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePushRegister()}
                    disabled={pushStatus === "requesting"}
                    className="text-xs font-medium px-3 py-1.5 border border-gray-200 bg-white text-[var(--twilio-gray-80)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {pushStatus === "requesting" ? "Requesting…" :
                     pushStatus === "registered" ? "✓ Registered — click to unregister" :
                     "Register this browser"}
                  </button>
                </div>
              </div>

              {/* SMS */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifDefaults.notify_default_sms}
                  onChange={(e) => setNotifDefaults({ notify_default_sms: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--twilio-navy)]">Phone (SMS)</p>
                  <p className="text-xs text-[var(--twilio-gray-60)]">
                    Twilio SMS to your phone number.
                    {!profile.phone_number && (
                      <span className="text-amber-600"> Add your phone number above to enable this.</span>
                    )}
                  </p>
                </div>
              </label>

              {/* Legacy email/slack general toggles */}
              <div className="pt-3 border-t border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">General notifications</p>
                <label className="flex items-center gap-2 text-sm text-[var(--twilio-navy)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.notification_email ?? false}
                    onChange={(e) => setProfile({ ...profile, notification_email: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Email notifications
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--twilio-navy)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.notification_slack ?? false}
                    onChange={(e) => setProfile({ ...profile, notification_slack: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Slack notifications
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2 flex-wrap">
              <button
                onClick={() => void handleProfileSave()}
                disabled={isSavingProfile}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {isSavingProfile ? "Saving…" : "Save Profile"}
              </button>
              {saveSuccess && (
                <span className="text-sm text-green-600 font-medium">Profile saved.</span>
              )}
              {saveSuccess && airtableSynced && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Synced to Airtable
                </span>
              )}
              {saveSuccess && !airtableSynced && (
                <span className="text-sm text-[var(--twilio-gray-60)]">
                  Airtable collaborator ID not resolved — check AIRTABLE_TABLE_TEAM in .env
                </span>
              )}
              {profile.airtable_collaborator_id && !saveSuccess && (
                <span className="inline-flex items-center gap-1.5 text-sm text-[var(--twilio-gray-60)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Airtable linked ({profile.airtable_collaborator_id})
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Staff view mode — only visible to staff users */}
      {profile?.is_staff && (
        <section className="bg-white rounded-lg border border-amber-200 shadow-sm">
          <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-500 shrink-0">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Staff Data View</h2>
              <p className="text-xs text-amber-700 mt-0.5">You are a staff user. This setting controls which accounts and data you see across the app.</p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={async () => {
                  if (!profile) return;
                  const next = !profile.staff_view_override;
                  try {
                    const { data } = await teamApi.updateMyProfile({ staff_view_override: next });
                    setProfile(data);
                    localStorage.setItem("accountsUpdated", Date.now().toString());
                    // CustomEvent needed because storage events don't fire in the same tab
                    window.dispatchEvent(new Event("accountsUpdated"));
                  } catch { /* best effort */ }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${profile.staff_view_override ? "bg-amber-500" : "bg-gray-300"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${profile.staff_view_override ? "translate-x-6" : "translate-x-1"}`} />
              </div>
              <span className="text-sm text-[var(--twilio-navy)]">
                {profile.staff_view_override ? "Showing all accounts (staff view)" : "Showing only your assigned accounts (user view)"}
              </span>
            </label>
            <p className="text-xs text-[var(--twilio-gray-60)]">
              When turned off, the app behaves as if you were a regular user — you only see accounts you are personally assigned to as a team member. Useful for testing the non-staff experience.
            </p>
          </div>
        </section>
      )}

      {/* Staff Gmail Keywords — only visible to staff users */}
      {profile?.is_staff && (
        <StaffGmailKeywordsSection />
      )}

      {/* Edit App */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Edit App</h2>
          <p className="text-sm text-[var(--twilio-navy)] mt-0.5">
            Click any element on the page to customise its background color or shadow. Export your changes as JSON to share.
          </p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => toggleEditApp(!editAppEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editAppEnabled ? "bg-[var(--twilio-blue)]" : "bg-gray-300"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${editAppEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </div>
            <span className="text-sm text-[var(--twilio-navy)]">
              {editAppEnabled ? "Edit mode ON — color picker is visible in the sidebar" : "Enable edit mode"}
            </span>
          </label>
          <p className="text-xs text-[var(--twilio-gray-60)]">
            When enabled, a color/shadow picker appears in the sidebar. Click "Pick element", then click any element on the page to open the editor. Use "Export JSON" in the picker to download your changes.
          </p>
          {editAppEnabled && (
            <Link
              to="/edit-preview"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--twilio-blue)] hover:underline"
            >
              Open Edit Page
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4"/>
              </svg>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
