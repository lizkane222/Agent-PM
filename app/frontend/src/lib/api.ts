/**
 * Typed axios client pointing at the Django REST API.
 *
 * - Base URL is read from VITE_API_BASE_URL (defaults to /api/v1 which is
 *   proxied to http://localhost:8000 by the Vite dev server).
 * - Request interceptor attaches the JWT Bearer token from localStorage.
 * - Response interceptor attempts a silent token refresh on 401 errors and
 *   retries the original request once before redirecting to /login.
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type {
  Account,
  AccountArtifact,
  AccountNote,
  CustomerContact,
  CustomerContactNote,
  ActionItem,
  ActionItemAttachment,
  AgentActivityEvent,
  AgentSession,
  SessionParticipant,
  AirtableAccount,
  AirtableActionItem,
  AirtableMeeting,
  CalendarEvent,
  AgentSkill,
  ClaudeSkill,
  Comment,
  CommentMention,
  CommentReference,
  CommentResourceType,
  CommentSummaryResponse,
  FeedbackItem,
  FeedbackComment as FeedbackCommentType,
  DiscoverApplet,
  EventMatchResult,
  MeetingNote,
  OAuthCredential,
  PageLayout,
  PaginatedResponse,
  Reminder,
  AccountProject,
  LogTimeDayAssignment,
  SalesforceConnectionStatus,
  SalesforceProject,
  SalesforceTask,
  SalesforceTimeEntry,
  SyncToken,
  AccountQuickLink,
  Tag,
  SalesforceAccount,
  Task,
  TeamMember,
  UserProfile,
  VoiceSession,
  WorkingSession,
  ExportItemSnapshot,
  UserPageNote,
  AccountFeedConfig,
  AccountFeedCustomField,
} from "../types";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isTokenExpired,
  refreshAccessToken,
} from "./auth";
import {
  MAX_429_RETRIES,
  requestSemaphore,
  retryDelayMs,
  sleep,
} from "./rateLimit";
import { clearGetCache, createCachingAdapter } from "./requestCache";
import { isActionItemMutationUrl, notifyActionItemsChanged } from "./actionItemEvents";

const BASE_URL = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  // Coalesce concurrent identical GETs and serve repeats from a short TTL cache.
  // Applied as an adapter rather than an interceptor so it sits below the retry and
  // auth layers and covers every existing call site. See lib/requestCache.ts.
  adapter: createCachingAdapter(axios.getAdapter(axios.defaults.adapter)),
});

// ── Rate guard — concurrency cap + release ───────────────────────────────────
// The backend applies a global DRF UserRateThrottle (200/min). Cap in-flight
// requests so a fan-out queues instead of bursting past it. See lib/rateLimit.ts.

/** Per-request bookkeeping added by the rate guard and the retry interceptors. */
type GuardedRequestConfig = InternalAxiosRequestConfig & {
  /** True while this config holds a semaphore slot. Reset on each (re)send. */
  _slotHeld?: boolean;
  /** Number of 429 retries already performed for this config. */
  _429Retry?: number;
};

/**
 * Release this request's slot, if it still holds one.
 *
 * Idempotent: the flag is cleared on release and set again by the acquire
 * interceptor when a config is re-sent (by the 401-refresh or 429-retry paths),
 * so a retried request acquires a fresh slot and never double-releases.
 */
function releaseSlot(config: GuardedRequestConfig | undefined): void {
  if (config?._slotHeld) {
    config._slotHeld = false;
    requestSemaphore.release();
  }
}

// Registered FIRST so it runs before the analytics, 401, and 429 handlers below.
// Axios runs response interceptors in registration order, and the 401/429 handlers
// re-issue the request through apiClient — which acquires a new slot. If the
// original slot were still held, MAX_CONCURRENT_REQUESTS concurrent retries would
// deadlock the queue permanently.
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    releaseSlot(response.config as GuardedRequestConfig);
    return response;
  },
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      releaseSlot(error.config as GuardedRequestConfig | undefined);
    }
    return Promise.reject(error);
  },
);

// ── Request interceptor — attach JWT (proactive refresh if expired) ──────────

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  let token = getAccessToken();

  // If the token is expired (or missing), refresh before sending so we never
  // hit the server with a stale token. Uses the shared singleton from auth.ts
  // so concurrent callers never rotate the refresh token more than once.
  if (!token || isTokenExpired(token)) {
    if (getRefreshToken()) {
      token = await refreshAccessToken().catch(() => "");
    }
  }

  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  // Take a concurrency slot last, immediately before the request goes out, so a
  // slot is never held while waiting on the token refresh above. Safe from
  // deadlock because refreshAccessToken() uses raw axios, not apiClient.
  await requestSemaphore.acquire();
  (config as GuardedRequestConfig)._slotHeld = true;
  return config;
});

// ── Response interceptor — Segment tracking for mutating requests ─────────────
// Maps URL path segments → human-readable resource names for track events.
const RESOURCE_LABELS: Array<[RegExp, string]> = [
  [/\/airtable\/action-items/, "Action Item"],
  [/\/airtable\/meetings/, "Meeting"],
  [/\/airtable\/accounts/, "Airtable Account"],
  [/\/accounts\/notes/, "Account Note"],
  [/\/accounts\/artifacts/, "Account Artifact"],
  [/\/accounts\/contacts/, "Contact"],
  [/\/accounts/, "Account"],
  [/\/scheduler\/events/, "Calendar Event"],
  [/\/scheduler\/action-items/, "Action Item"],
  [/\/scheduler\/reminders/, "Reminder"],
  [/\/scheduler\/tasks/, "Task"],
  [/\/scheduler\/meeting-notes/, "Meeting Note"],
  [/\/team\/members/, "Team Member"],
  [/\/team\/profile/, "Profile"],
  [/\/comments/, "Comment"],
  [/\/skills/, "Claude Skill"],
  [/\/layouts/, "Page Layout"],
  [/\/salesforce\/log-time/, "Salesforce Time Log"],
  [/\/discover/, "Discover Applet"],
];

const METHOD_VERBS: Record<string, string> = {
  POST: "Created",
  PUT: "Updated",
  PATCH: "Updated",
  DELETE: "Deleted",
};

apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    const method = response.config.method?.toUpperCase() ?? "";
    const verb = METHOD_VERBS[method];
    if (!verb) return response;
    const url = response.config.url ?? "";
    const matched = RESOURCE_LABELS.find(([re]) => re.test(url));
    if (!matched) return response;
    const [, resourceLabel] = matched;
    // Lazy-import to avoid circular dep at module load time
    import("./analytics").then(({ track }) => {
      const props: Record<string, unknown> = { resource: resourceLabel };
      if (method === "DELETE") {
        const idMatch = url.match(/\/(\d+)\/?$/);
        if (idMatch) props["id"] = Number(idMatch[1]);
      } else if (response.data && typeof response.data === "object") {
        const d = response.data as Record<string, unknown>;
        if (d["id"]) props["id"] = d["id"];
        if (d["name"]) props["name"] = d["name"];
        if (d["title"]) props["name"] = d["title"];
        if (d["task"]) props["name"] = d["task"];
        if (d["company_name"]) props["name"] = d["company_name"];
        if (d["status"]) props["status"] = d["status"];
        if (d["priority"]) props["priority"] = d["priority"];
        if (d["account_name"]) props["account_name"] = d["account_name"];
      }
      track(`${resourceLabel} ${verb}`, props);
    }).catch(() => {});
    return response;
  },
  undefined,
);

// ── Response interceptor — auto-refresh on 401 ───────────────────────────────

let _retryQueue: Array<(token: string) => void> = [];

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (!getRefreshToken()) {
        clearTokens();
        // Drop cached GETs so the next session can't read this user's data.
        clearGetCache();
        window.location.href = "/login";
        return Promise.reject(error);
      }

      // Queue concurrent 401s while a refresh is already in flight (shared
      // singleton in auth.ts ensures only one token rotation happens).
      return new Promise<AxiosResponse>((resolve, reject) => {
        _retryQueue.push((token) => {
          if (originalRequest.headers) {
            originalRequest.headers["Authorization"] = `Bearer ${token}`;
          }
          resolve(apiClient(originalRequest));
        });

        refreshAccessToken()
          .then((token) => {
            _retryQueue.forEach((cb) => cb(token));
            _retryQueue = [];
          })
          .catch(() => {
            _retryQueue = [];
            clearTokens();
            clearGetCache();
            window.location.href = "/login";
            reject(error);
          });
      });
    }

    return Promise.reject(error);
  }
);

// ── Response interceptor — retry with backoff on 429 ─────────────────────────
// Registered last so it runs after the 401 handler. The slot for this request was
// already released by the guard interceptor at the top of this file, so sleeping
// here doesn't occupy the queue; the re-sent request acquires a fresh slot.

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);
    if (error.response?.status !== 429) return Promise.reject(error);

    const config = error.config as GuardedRequestConfig | undefined;
    if (!config) return Promise.reject(error);

    const attempt = (config._429Retry ?? 0) + 1;
    if (attempt > MAX_429_RETRIES) {
      // Out of retries — reject so existing .catch() handlers still run.
      return Promise.reject(error);
    }
    config._429Retry = attempt;

    const retryAfter = error.response.headers?.["retry-after"] as string | undefined;
    await sleep(retryDelayMs(attempt, retryAfter));
    return apiClient(config);
  }
);

// ── Action item change broadcast ─────────────────────────────────────────────
// Every page that shows action items keeps its own copy in state and refreshes on a
// `storage` event. Firing that from here — rather than at each mutation site — is what
// makes "create anywhere, fresh everywhere" hold: three creation paths used to forget,
// so an item made on Account Detail never reached the Calendar sidebar.
apiClient.interceptors.response.use((response: AxiosResponse) => {
  const method = (response.config?.method ?? "get").toLowerCase();
  const url = response.config?.url ?? "";
  if (method !== "get" && isActionItemMutationUrl(url)) notifyActionItemsChanged();
  return response;
});

// ── Cache opt-out helper ──────────────────────────────────────────────────────
// GETs are coalesced and briefly cached (lib/requestCache.ts). A refetch triggered by
// an event — a setting toggled, an agent response finishing — wants the current server
// state, so it opts out. The mount-time fetch of the same endpoint stays cacheable.

function freshConfig(opts?: { fresh?: boolean }): AxiosRequestConfig {
  return opts?.fresh ? { noCache: true } : {};
}

// ── Empty-result helpers for batch endpoints ──────────────────────────────────
// A batch helper called with zero IDs has a knowable answer, so it resolves a
// synthetic response instead of sending a request with an empty filter (which the
// backend would read as "no valid IDs" and answer with an empty list anyway — this
// just saves the round trip, and the request budget).

function syntheticResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  };
}

function emptyPage<T>(): AxiosResponse<PaginatedResponse<T>> {
  return syntheticResponse<PaginatedResponse<T>>({
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
}

// ── Envelope unwrapping ───────────────────────────────────────────────────────
// Some list endpoints answer with a bare JSON array and others with the DRF
// `{count, next, previous, results}` envelope, and which one you get is not
// obvious from the URL. Under `/layouts/` both shapes are live at once: `pinned/`
// is a custom @action returning `Response(serializer.data)` (bare array), while
// `working-sessions/` and `page-notes/` are plain ModelViewSets that inherit the
// global PageNumberPagination (envelope).
//
// A fetcher that guesses wrong hands the page an object where it declared an
// array, and the mismatch does not surface until a render calls `.map` on it —
// which throws during render and unmounts the whole route, blanking the page.
// So accept either shape and always resolve the array.
function unwrapResults<T>(
  promise: Promise<AxiosResponse<T[] | PaginatedResponse<T>>>,
): Promise<AxiosResponse<T[]>> {
  return promise.then(res => ({
    ...res,
    data: Array.isArray(res.data) ? res.data : res.data?.results ?? [],
  }));
}

// ── Typed API helpers ─────────────────────────────────────────────────────────

export interface TokenStats {
  all_time: { input_tokens: number; output_tokens: number; total_tokens: number };
  by_session: { session_id: number; title: string; input_tokens: number; output_tokens: number; total_tokens: number }[];
}

export interface SkillTokenStats {
  all_time: { input_tokens: number; output_tokens: number; total_tokens: number };
  by_skill: { skill_id: number; skill_name: string; input_tokens: number; output_tokens: number; total_tokens: number; invocation_count: number }[];
}

export const agentApi = {
  listSessions: () =>
    apiClient.get<PaginatedResponse<AgentSession>>("/agents/sessions/"),
  getSession: (id: number) =>
    apiClient.get<AgentSession>(`/agents/sessions/${id}/`),
  renameSession: (id: number, title: string) =>
    apiClient.patch<AgentSession>(`/agents/sessions/${id}/`, { title }),
  deleteSession: (id: number) =>
    apiClient.delete(`/agents/sessions/${id}/`),
  sendMessage: (message: string, session_id?: number) =>
    apiClient.post<void>("/agents/sessions/send/", { message, session_id }, {
      responseType: "stream",
    }),
  shareSession: (id: number, user_ids: number[]) =>
    apiClient.post<AgentSession>(`/agents/sessions/${id}/share/`, { user_ids }),
  exportSession: (id: number, format: "json" | "md" = "json") =>
    apiClient.get<Blob>(`/agents/sessions/${id}/export/`, {
      params: { format },
      responseType: "blob",
    }),
  listUsers: () =>
    apiClient.get<SessionParticipant[]>("/agents/users/"),
  getTokenStats: (opts?: { fresh?: boolean }) =>
    apiClient.get<TokenStats>("/agents/sessions/token-stats/", freshConfig(opts)),
};

export const schedulerApi = {
  listEvents: (params?: Record<string, string>) =>
    apiClient.get<CalendarEvent[]>("/scheduler/events/", { params }),
  createEvent: (data: Partial<CalendarEvent>) =>
    apiClient.post<CalendarEvent>("/scheduler/events/", data),
  updateEvent: (id: number, data: Partial<CalendarEvent>) =>
    apiClient.patch<CalendarEvent>(`/scheduler/events/${id}/`, data),
  deleteEvent: (id: number) => apiClient.delete(`/scheduler/events/${id}/`),
  /** Record whether the owner attended. `null` clears the record.
   *  Separate from updateEvent: `attended` is read-only on the serializer and is
   *  written by an owner-scoped action that skips the account-membership check. */
  setEventAttendance: (id: number, attended: boolean | null) =>
    apiClient.patch<CalendarEvent>(`/scheduler/events/${id}/attendance/`, { attended }),
  /** Edit an event the caller owns: title/description/location/times/type, plus the
   *  action-item link. Separate from `updateEvent` for the same reason
   *  `setEventAttendance` is: the generic PATCH runs RequireAccountMembershipMixin, which
   *  403s a user editing their *own* meeting when it is linked to an account they aren't
   *  a team member of — and Google-synced meetings get auto-linked to accounts. */
  updateEventDetails: (
    id: number,
    patch: Partial<Pick<CalendarEvent,
      "title" | "description" | "location" | "start_datetime" | "end_datetime" | "all_day"
      | "event_category" | "agentpm_airtable_id">>,
  ) => apiClient.patch<CalendarEvent>(`/scheduler/events/${id}/details/`, patch),

  listActionItems: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<ActionItem>>("/scheduler/action-items/", { params }),
  createActionItem: (data: Partial<ActionItem>) =>
    apiClient.post<ActionItem>("/scheduler/action-items/", data),
  updateActionItem: (id: number, data: Partial<ActionItem>) =>
    apiClient.patch<ActionItem>(`/scheduler/action-items/${id}/`, data),
  deleteActionItem: (id: number) => apiClient.delete(`/scheduler/action-items/${id}/`),

  listTasks: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<Task>>("/scheduler/tasks/", { params }),
  createTask: (data: Partial<Task>) =>
    apiClient.post<Task>("/scheduler/tasks/", data),
  updateTask: (id: number, data: Partial<Task>) =>
    apiClient.patch<Task>(`/scheduler/tasks/${id}/`, data),
  deleteTask: (id: number) => apiClient.delete(`/scheduler/tasks/${id}/`),

  listReminders: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<Reminder>>("/scheduler/reminders/", { params }),
  createReminder: (data: Omit<Partial<Reminder>, "id" | "created_by" | "created_by_username" | "created_at" | "updated_at">) =>
    apiClient.post<Reminder>("/scheduler/reminders/", data),
  updateReminder: (id: number, data: Partial<Reminder>) =>
    apiClient.patch<Reminder>(`/scheduler/reminders/${id}/`, data),
  deleteReminder: (id: number) =>
    apiClient.delete(`/scheduler/reminders/${id}/`),
  dismissReminder: (id: number) =>
    apiClient.post<Reminder>(`/scheduler/reminders/${id}/dismiss/`),
  snoozeReminder: (id: number) =>
    apiClient.post<Reminder>(`/scheduler/reminders/${id}/snooze/`),

  listMeetingNotes: (eventId: number) =>
    apiClient.get<PaginatedResponse<MeetingNote>>("/scheduler/meeting-notes/", { params: { event: eventId, page_size: 200 } }),
  /**
   * Batched counterpart to listMeetingNotes — fetches notes for many events in one
   * request. Callers group the flat result by `note.event`. Returns an empty envelope
   * without hitting the network when there are no IDs to ask about.
   */
  listMeetingNotesForEvents: (eventIds: number[]) => {
    if (eventIds.length === 0) return Promise.resolve(emptyPage<MeetingNote>());
    return apiClient.get<PaginatedResponse<MeetingNote>>("/scheduler/meeting-notes/", {
      params: { event: eventIds.join(","), page_size: 1000 },
    });
  },
  createMeetingNote: (data: { event: number; html: string; text: string; due_date?: string | null; position?: number }) =>
    apiClient.post<MeetingNote>("/scheduler/meeting-notes/", data),
  updateMeetingNote: (id: number, data: Partial<Pick<MeetingNote, "html" | "text" | "due_date" | "position">> & { references?: CommentReference[] }) =>
    apiClient.patch<MeetingNote>(`/scheduler/meeting-notes/${id}/`, data),
  deleteMeetingNote: (id: number) =>
    apiClient.delete(`/scheduler/meeting-notes/${id}/`),
};

export const teamApi = {
  /**
   * Pass `{ fresh: true }` from an event-driven refetch (e.g. after a
   * staff_view_override toggle) so it bypasses the short GET cache in
   * lib/requestCache.ts. Plain mount fetches should stay cacheable — three shell
   * components request this endpoint and StrictMode doubles each one.
   */
  getMyProfile: (opts?: { fresh?: boolean }) =>
    apiClient.get<UserProfile>("/team/profiles/me/", freshConfig(opts)),
  updateMyProfile: (data: Partial<UserProfile>) =>
    apiClient.patch<UserProfile>("/team/profiles/me/", data),
  savePushSubscription: (subscription: PushSubscriptionJSON) =>
    apiClient.post<{ push_subscription_active: boolean }>("/team/profiles/me/push-subscription/", subscription),
  deletePushSubscription: () =>
    apiClient.delete("/team/profiles/me/push-subscription/"),
  listMembers: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<TeamMember>>("/team/members/", { params }),
  listTags: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<Tag>>("/team/tags/", { params }),
  listTeams: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<{ id: number; name: string; slug: string; description: string; created_at: string }>>("/team/teams/", { params }),
  listMemberships: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<{ id: number; user: number; user_display: string; team: number; team_name: string; role: string; created_at: string }>>("/team/memberships/", { params }),
  getMember: (id: number) => apiClient.get<TeamMember>(`/team/members/${id}/`),
  createMember: (data: Partial<TeamMember>) =>
    apiClient.post<TeamMember>("/team/members/", data),
  updateMember: (id: number, data: Partial<TeamMember>) =>
    apiClient.patch<TeamMember>(`/team/members/${id}/`, data),
  deleteMember: (id: number) => apiClient.delete(`/team/members/${id}/`),
};

export const discoverApi = {
  listApplets: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<DiscoverApplet>>("/discover/applets/", { params }),
  getApplet: (id: number) => apiClient.get<DiscoverApplet>(`/discover/applets/${id}/`),
  createApplet: (data: Partial<DiscoverApplet>) =>
    apiClient.post<DiscoverApplet>("/discover/applets/", data),
  updateApplet: (id: number, data: Partial<DiscoverApplet>) =>
    apiClient.patch<DiscoverApplet>(`/discover/applets/${id}/`, data),
  deleteApplet: (id: number) => apiClient.delete(`/discover/applets/${id}/`),
};

export const accountsApi = {
  listAccounts: (params?: Record<string, string>, opts?: { fresh?: boolean }) =>
    apiClient.get<PaginatedResponse<Account>>("/accounts/accounts/", { params, ...freshConfig(opts) }),
  getAccount: (id: number) => apiClient.get<Account>(`/accounts/accounts/${id}/`),
  createAccount: (data: Partial<Account>) =>
    apiClient.post<Account>("/accounts/accounts/", data),
  updateAccount: (id: number, data: Partial<Account>) =>
    apiClient.patch<Account>(`/accounts/accounts/${id}/`, data),
  deleteAccount: (id: number) => apiClient.delete(`/accounts/accounts/${id}/`),
  listNotes: (accountId: number) =>
    apiClient.get<AccountNote[]>(`/accounts/accounts/${accountId}/notes/`),
  createNote: (accountId: number, content: string) =>
    apiClient.post<AccountNote>(`/accounts/accounts/${accountId}/notes/`, { content }),
  updateNote: (noteId: number, content: string) =>
    apiClient.patch<AccountNote>(`/accounts/notes/${noteId}/`, { content }),
  deleteNote: (noteId: number) => apiClient.delete(`/accounts/notes/${noteId}/`),
  listCalendarEvents: (accountId: number) =>
    apiClient.get<CalendarEvent[]>(`/accounts/accounts/${accountId}/calendar-events/`),
  listMeetings: (accountId: number) =>
    apiClient.get<CalendarEvent[]>(`/accounts/accounts/${accountId}/meetings/`),
  listAccountActionItems: (accountId: number) =>
    apiClient.get<ActionItem[]>(`/accounts/accounts/${accountId}/action-items/`),
  createAccountActionItem: (accountId: number, data: Partial<ActionItem>) =>
    apiClient.post<ActionItem>(`/accounts/accounts/${accountId}/action-items/`, data),
  listAccountReminders: (accountId: number) =>
    apiClient.get<Reminder[]>(`/accounts/accounts/${accountId}/reminders/`),
  createAccountReminder: (accountId: number, data: Partial<Reminder>) =>
    apiClient.post<Reminder>(`/accounts/accounts/${accountId}/reminders/`, data),
  addTeamMember: (accountId: number, memberId: number) =>
    apiClient.post<Account>(`/accounts/accounts/${accountId}/team-members/add/`, { member_id: memberId }),
  removeTeamMember: (accountId: number, memberId: number) =>
    apiClient.post<Account>(`/accounts/accounts/${accountId}/team-members/remove/`, { member_id: memberId }),
  listArtifacts: (accountId: number) =>
    apiClient.get<AccountArtifact[]>(`/accounts/accounts/${accountId}/artifacts/`),
  /**
   * Batched counterpart to listArtifacts — one request covering many accounts.
   * Returns a flat list (same element shape as listArtifacts); each artifact carries
   * its own `account`, so callers can group locally if they need to. Accounts the
   * caller can't see are omitted rather than erroring.
   */
  listArtifactsForAccounts: (accountIds: number[]) => {
    if (accountIds.length === 0) return Promise.resolve(syntheticResponse<AccountArtifact[]>([]));
    return apiClient.get<AccountArtifact[]>("/accounts/accounts/artifacts-batch/", {
      params: { ids: accountIds.join(",") },
    });
  },
  addArtifactLink: (accountId: number, name: string, url: string, iconKey?: string, secondaryUrl?: string) =>
    apiClient.post<AccountArtifact>(`/accounts/accounts/${accountId}/artifacts/`, { artifact_type: "link", name, url, icon_key: iconKey ?? "", secondary_url: secondaryUrl ?? "" }),
  uploadArtifactFile: (accountId: number, file: File) => {
    const fd = new FormData();
    fd.append("artifact_type", "file");
    fd.append("name", file.name);
    fd.append("file", file);
    return apiClient.post<AccountArtifact>(`/accounts/accounts/${accountId}/artifacts/`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteArtifact: (artifactId: number) =>
    apiClient.delete(`/accounts/artifacts/${artifactId}/`),
  createUserArtifact: (data: { name: string; url: string; icon_key?: string; secondary_url?: string; account?: number | null }) =>
    apiClient.post<AccountArtifact>("/accounts/artifacts/", { artifact_type: "link", ...data }),
  updateArtifact: (artifactId: number, data: { name?: string; url?: string; icon_key?: string; secondary_url?: string; account?: number | null }) =>
    apiClient.patch<AccountArtifact>(`/accounts/artifacts/${artifactId}/`, data),
  listQuickLinks: (accountId: number) =>
    apiClient.get<AccountQuickLink[]>(`/accounts/accounts/${accountId}/quick-links/`),
  createQuickLink: (accountId: number, name: string, url: string) =>
    apiClient.post<AccountQuickLink>(`/accounts/accounts/${accountId}/quick-links/`, { name, url }),
  updateQuickLink: (linkId: number, data: Partial<AccountQuickLink>) =>
    apiClient.patch<AccountQuickLink>(`/accounts/quick-links/${linkId}/`, data),
  deleteQuickLink: (linkId: number) =>
    apiClient.delete(`/accounts/quick-links/${linkId}/`),
  // Customer contacts
  listContacts: (accountId: number) =>
    apiClient.get<PaginatedResponse<CustomerContact>>(`/accounts/contacts/?account=${accountId}`),
  createContact: (accountId: number, data: Partial<CustomerContact>) =>
    apiClient.post<CustomerContact>(`/accounts/contacts/`, { ...data, account: accountId }),
  updateContact: (contactId: number, data: Partial<CustomerContact>) =>
    apiClient.patch<CustomerContact>(`/accounts/contacts/${contactId}/`, data),
  deleteContact: (contactId: number) =>
    apiClient.delete(`/accounts/contacts/${contactId}/`),
  listContactNotes: (contactId: number) =>
    apiClient.get<CustomerContactNote[]>(`/accounts/contacts/${contactId}/notes/`),
  addContactNote: (contactId: number, content: string) =>
    apiClient.post<CustomerContactNote>(`/accounts/contacts/${contactId}/notes/`, { content }),
  updateContactNote: (noteId: number, content: string) =>
    apiClient.patch<CustomerContactNote>(`/accounts/contact-notes/${noteId}/`, { content }),
  deleteContactNote: (noteId: number) =>
    apiClient.delete(`/accounts/contact-notes/${noteId}/`),
  getAdminAccount: (opts?: { fresh?: boolean }) =>
    apiClient.get<Account>("/accounts/admin-account/", freshConfig(opts)),
  listProjectsByAccount: (accountName: string) =>
    apiClient.get<PaginatedResponse<AccountProject>>("/accounts/projects/", { params: { account_name: accountName } }),
  createProject: (data: { account: number; name: string; description?: string; position?: number }) =>
    apiClient.post<AccountProject>("/accounts/projects/", data),
  updateProject: (id: number, data: { name?: string; description?: string; position?: number }) =>
    apiClient.patch<AccountProject>(`/accounts/projects/${id}/`, data),
  deleteProject: (id: number) =>
    apiClient.delete(`/accounts/projects/${id}/`),
};

export const accountFeedApi = {
  getFeedConfig: (accountId: number) =>
    apiClient.get<AccountFeedConfig>(`/account-feed/${accountId}/feed/`),
  updateFeedConfig: (accountId: number, data: Partial<AccountFeedConfig>) =>
    apiClient.put<AccountFeedConfig>(`/account-feed/${accountId}/feed/`, data),
  createCustomField: (accountId: number, data: { name: string; value: string; airtable_field_type?: string }) =>
    apiClient.post<AccountFeedCustomField>(`/account-feed/${accountId}/feed/custom-fields/`, data),
  updateCustomField: (accountId: number, fieldId: number, data: Partial<AccountFeedCustomField>) =>
    apiClient.patch<AccountFeedCustomField>(`/account-feed/${accountId}/feed/custom-fields/${fieldId}/`, data),
  deleteCustomField: (accountId: number, fieldId: number) =>
    apiClient.delete(`/account-feed/${accountId}/feed/custom-fields/${fieldId}/`),
};

export const salesforceApi = {
  status: () =>
    apiClient.get<SalesforceConnectionStatus>("/salesforce/status/"),
  listAccounts: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<SalesforceAccount>>("/salesforce/accounts/", { params }),
  listProjects: (params?: Record<string, string>) =>
    apiClient.get<{ results: SalesforceProject[] }>("/salesforce/projects/", { params }),
  listTasks: (params?: Record<string, string>) =>
    apiClient.get<{ results: SalesforceTask[] }>("/salesforce/tasks/", { params }),
  updateTaskStatus: (id: number, taskStatus: string) =>
    apiClient.patch<SalesforceTask>(`/salesforce/tasks/${id}/status/`, { status: taskStatus }),
  logTime: (data: {
    project_sf_id: string;
    task_sf_id?: string;
    date: string;
    duration_minutes: number;
    description?: string;
  }) => apiClient.post<SalesforceTimeEntry>("/salesforce/log-time/", data),
  postChatter: (record_id: string, body: string) =>
    apiClient.post("/salesforce/chatter/", { record_id, body }),
  triggerSync: () =>
    apiClient.post<{ accounts: number; projects: number; members: number; tasks: number }>("/salesforce/sync/"),
  listDayAssignments: (weekStart: string) =>
    apiClient.get<LogTimeDayAssignment[]>("/salesforce/log-time-assignments/", { params: { week_start: weekStart } }),
  addDayAssignment: (date: string, project_id: number) =>
    apiClient.post<LogTimeDayAssignment>("/salesforce/log-time-assignments/", { date, project_id }),
  removeDayAssignment: (date: string, project_id: number) =>
    apiClient.delete("/salesforce/log-time-assignments/", { data: { date, project_id } }),
};

export const airtableApi = {
  listAccounts: (params?: Record<string, string>) =>
    apiClient.get<{ results: AirtableAccount[] }>("/airtable/accounts/", { params }),
  updateAirtableAccount: (id: number, data: Partial<AirtableAccount>) =>
    apiClient.patch<AirtableAccount>(`/airtable/accounts/${id}/`, data),
  matchEvent: (data: {
    event_uid: string;
    title: string;
    description: string;
    attendee_emails: string[];
  }) => apiClient.post<EventMatchResult>("/airtable/match/", data),
  categorizeEvent: (data: {
    event_uid: string;
    account_id?: number | null;
    account_name?: string;
    categorization?: string;
  }) => apiClient.post<EventMatchResult>("/airtable/categorize/", data),
  getEventLink: (event_uid: string) =>
    apiClient.get<{ linked: boolean; airtable_account_id?: number; airtable_id?: string; account_name?: string }>(
      "/airtable/event-link/", { params: { event_uid } }
    ),
  batchEventLinks: (event_uids: string[]) =>
    apiClient.post<Record<string, { linked: boolean; airtable_account_id?: number; airtable_id?: string; account_name?: string }>>(
      "/airtable/event-links/batch/", { event_uids }
    ),
  listActionItems: (params?: Record<string, string>, opts?: { fresh?: boolean }) =>
    apiClient.get<AirtableActionItem[]>("/airtable/action-items/", { params, ...freshConfig(opts) }),
  listMeetings: (params?: Record<string, string>) =>
    apiClient.get<{ results: AirtableMeeting[] }>("/airtable/meetings/", { params }),
  getMeeting: (meetingId: number) =>
    apiClient.get<AirtableMeeting>(`/airtable/meetings/${meetingId}/`),
  updateMeetingGongNotes: (calendarEventId: number, gongNotes: string, references?: CommentReference[]) =>
    apiClient.patch<AirtableMeeting>(`/airtable/meetings/by-event/${calendarEventId}/gong-notes/`, { gong_notes: gongNotes, ...(references && { references }) }),
  updateMeetingGongNotesByPk: (meetingId: number, gongNotes: string, references?: CommentReference[]) =>
    apiClient.patch<AirtableMeeting>(`/airtable/meetings/${meetingId}/gong-notes/`, { gong_notes: gongNotes, ...(references && { references }) }),
  updateMeetingZoomNotes: (calendarEventId: number, zoomNotes: string, references?: CommentReference[]) =>
    apiClient.patch<AirtableMeeting>(`/airtable/meetings/by-event/${calendarEventId}/zoom-notes/`, { zoom_notes: zoomNotes, ...(references && { references }) }),
  updateMeetingZoomNotesByPk: (meetingId: number, zoomNotes: string, references?: CommentReference[]) =>
    apiClient.patch<AirtableMeeting>(`/airtable/meetings/${meetingId}/zoom-notes/`, { zoom_notes: zoomNotes, ...(references && { references }) }),
  createActionItem: (data: Partial<AirtableActionItem>) =>
    apiClient.post<AirtableActionItem>("/airtable/action-items/", data),
  updateActionItem: (id: number, data: Partial<AirtableActionItem>) =>
    apiClient.patch<AirtableActionItem>(`/airtable/action-items/${id}/`, data),
  deleteActionItem: (id: number) =>
    apiClient.delete(`/airtable/action-items/${id}/`),
  setActionItemReminder: (id: number, data: { due_at: string; title?: string; notify_in_app?: boolean }) =>
    apiClient.post<AirtableActionItem>(`/airtable/action-items/${id}/set-reminder/`, data),
  clearActionItemReminder: (id: number) =>
    apiClient.delete<AirtableActionItem>(`/airtable/action-items/${id}/clear-reminder/`),
  nextMeetingAt: () =>
    apiClient.get<{ next_meeting_at: string | null }>("/airtable/action-items/next-meeting-at/"),
  updateActionItemStatus: (airtableId: string, status: string) =>
    apiClient.patch<AirtableActionItem>(`/airtable/action-items/${airtableId}/status/`, { status }),
  updateActionItemFields: (airtableId: string, fields: Partial<AirtableActionItem>) =>
    apiClient.patch<AirtableActionItem>(`/airtable/action-items/${airtableId}/fields/`, fields),
  logTime: (data: { airtable_id: string; account_name: string; task: string; seconds: number }) =>
    apiClient.post<AirtableActionItem>("/airtable/time-logs/", data),
  triggerSync: () => apiClient.post<{ accounts: number; meetings: number; action_items: number; artifacts: number; action_item_attachments: number }>("/airtable/sync/"),
  listAttachments: (actionItemId: number) =>
    apiClient.get<ActionItemAttachment[]>(`/airtable/action-items/${actionItemId}/attachments/`),
  addAttachmentLink: (actionItemId: number, name: string, url: string) =>
    apiClient.post<ActionItemAttachment>(`/airtable/action-items/${actionItemId}/attachments/`, { artifact_type: "link", name, url }),
  uploadAttachmentFile: (actionItemId: number, file: File) => {
    const fd = new FormData();
    fd.append("artifact_type", "file");
    fd.append("name", file.name);
    fd.append("file", file);
    return apiClient.post<ActionItemAttachment>(`/airtable/action-items/${actionItemId}/attachments/`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteAttachment: (actionItemId: number, attachmentId: number) =>
    apiClient.delete(`/airtable/action-items/${actionItemId}/attachments/${attachmentId}/`),
  addDependency: (actionItemId: number, waitingOnId: number) =>
    apiClient.post<AirtableActionItem>(`/airtable/action-items/${actionItemId}/add-dependency/`, { waiting_on_id: waitingOnId }),
  removeDependency: (actionItemId: number, depItemId: number) =>
    apiClient.delete<AirtableActionItem>(`/airtable/action-items/${actionItemId}/remove-dependency/${depItemId}/`),
  getFieldOptions: () =>
    apiClient.get<{ status: string[]; priority: string[] }>("/airtable/action-items/field-options/"),
};

export const realtimeApi = {
  getSyncToken: () => apiClient.get<SyncToken>("/realtime/sync-token/"),
  listActivity: (params?: { event_type?: string; since?: string; page_size?: number }) =>
    apiClient.get<PaginatedResponse<AgentActivityEvent>>("/realtime/activity/", { params }),
  createActivity: (data: {
    event_type: string;
    title: string;
    detail?: string;
    metadata?: Record<string, unknown>;
    client_id: string;
    client_ts: number;
  }) => apiClient.post<AgentActivityEvent>("/realtime/activity/", data),
  listVoiceSessions: () =>
    apiClient.get<PaginatedResponse<VoiceSession>>("/realtime/voice-sessions/"),
};

export interface SkillFile {
  filename: string;
  name: string;
  code: string;
  first_line_description: string;
}

export const skillsApi = {
  list: () =>
    apiClient.get<PaginatedResponse<ClaudeSkill>>("/skills/skills/"),
  listInvocations: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<{ id: number; skill: number; skill_name: string; invoked_by: number | null; invoked_by_username: string | null; arguments: unknown; result: unknown; error: string; created_at: string }>>("/skills/invocations/", { params }),
  get: (id: number) =>
    apiClient.get<ClaudeSkill>(`/skills/skills/${id}/`),
  create: (data: { name: string; description: string; code: string; input_schema?: Record<string, unknown> }) =>
    apiClient.post<ClaudeSkill>("/skills/skills/", data),
  update: (id: number, data: Partial<Pick<ClaudeSkill, "name" | "description" | "command" | "roles" | "code" | "input_schema">>) =>
    apiClient.patch<ClaudeSkill>(`/skills/skills/${id}/`, data),
  delete: (id: number) =>
    apiClient.delete(`/skills/skills/${id}/`),
  review: (id: number) =>
    apiClient.post<ClaudeSkill>(`/skills/skills/${id}/review/`),
  enable: (id: number) =>
    apiClient.post<ClaudeSkill>(`/skills/skills/${id}/enable/`),
  disable: (id: number) =>
    apiClient.post<ClaudeSkill>(`/skills/skills/${id}/disable/`),
  listFiles: () =>
    apiClient.get<SkillFile[]>("/skills/skills/files/"),
  generateCode: (name: string, description: string) =>
    apiClient.post<{ code: string }>("/skills/skills/generate-code/", { name, description }),
  fixAndReview: (id: number) =>
    apiClient.post<ClaudeSkill>(`/skills/skills/${id}/fix-and-review/`),
  invoke: (id: number, arguments_: Record<string, unknown>) =>
    apiClient.post<{ result: unknown; duration_ms: number }>(`/skills/skills/${id}/invoke/`, { arguments: arguments_ }),
  getTokenStats: (opts?: { fresh?: boolean }) =>
    apiClient.get<SkillTokenStats>("/skills/skills/token-stats/", freshConfig(opts)),
};

export const agentSkillsApi = {
  list: () =>
    apiClient.get<PaginatedResponse<AgentSkill>>("/skills/agent-skills/"),
  get: (id: number) =>
    apiClient.get<AgentSkill>(`/skills/agent-skills/${id}/`),
  create: (data: Partial<AgentSkill>) =>
    apiClient.post<AgentSkill>("/skills/agent-skills/", data),
  update: (id: number, data: Partial<Pick<AgentSkill, "name" | "description" | "instructions" | "allowed_tools" | "scripts" | "references" | "visibility">>) =>
    apiClient.patch<AgentSkill>(`/skills/agent-skills/${id}/`, data),
  delete: (id: number) =>
    apiClient.delete(`/skills/agent-skills/${id}/`),
  generate: (description: string) =>
    apiClient.post<{ name: string; description: string; instructions: string; allowed_tools: string[]; needs_script: boolean; script: string }>("/skills/agent-skills/generate/", { description }),
  review: (id: number) =>
    apiClient.post<AgentSkill>(`/skills/agent-skills/${id}/review/`),
  pin: (id: number) =>
    apiClient.post<AgentSkill>(`/skills/agent-skills/${id}/pin/`),
  unpin: (id: number) =>
    apiClient.post<AgentSkill>(`/skills/agent-skills/${id}/unpin/`),
  run: (id: number, args?: Record<string, string>) =>
    apiClient.post<{ prompt: string }>(`/skills/agent-skills/${id}/run/`, { args: args ?? {} }),
  updateSkill: (id: number, data: Partial<Pick<AgentSkill, "name" | "description" | "instructions" | "allowed_tools" | "scripts" | "pinned_to_roles">>) =>
    apiClient.patch<AgentSkill>(`/skills/agent-skills/${id}/`, data),
};

export interface SearchResult {
  type: string;
  type_label: string;
  id: string | number;
  title: string;
  detail: string;
  account: string;
  meta: string;
  url: string;
  accent: string;
}

export const searchApi = {
  search: (q: string, page_context?: string) =>
    apiClient.get<{ results: SearchResult[] }>("/search/", { params: { q, page_context } }),
};

export const layoutsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<PaginatedResponse<PageLayout>>("/layouts/", { params }),
  get: (id: number) =>
    apiClient.get<PageLayout>(`/layouts/${id}/`),
  create: (data: { name: string; nodes: unknown[]; is_public?: boolean }) =>
    apiClient.post<PageLayout>("/layouts/", data),
  update: (id: number, data: { name?: string; nodes?: unknown[]; is_public?: boolean }) =>
    apiClient.patch<PageLayout>(`/layouts/${id}/`, data),
  delete: (id: number) =>
    apiClient.delete(`/layouts/${id}/`),
  fork: (id: number, name?: string) =>
    apiClient.post<PageLayout>(`/layouts/${id}/fork/`, { name }),
  heart: (id: number) =>
    apiClient.post<{ hearted: boolean; heart_count: number }>(`/layouts/${id}/heart/`),
  pin: (id: number) =>
    apiClient.post<{ pinned: boolean }>(`/layouts/${id}/pin/`),
  listPinned: () =>
    unwrapResults(apiClient.get<PageLayout[] | PaginatedResponse<PageLayout>>("/layouts/pinned/")),
};

export const workingSessionApi = {
  list: () =>
    unwrapResults(apiClient.get<WorkingSession[] | PaginatedResponse<WorkingSession>>(
      "/layouts/working-sessions/",
    )),
  create: (data: { name: string; canvas_nodes?: unknown[]; record_refs?: ExportItemSnapshot[] }) =>
    apiClient.post<WorkingSession>("/layouts/working-sessions/", data),
  update: (id: number, data: Partial<Pick<WorkingSession, "name" | "canvas_nodes" | "record_refs">>) =>
    apiClient.patch<WorkingSession>(`/layouts/working-sessions/${id}/`, data),
  destroy: (id: number) => apiClient.delete(`/layouts/working-sessions/${id}/`),
};

export const userPageNoteApi = {
  list: () =>
    unwrapResults(apiClient.get<UserPageNote[] | PaginatedResponse<UserPageNote>>(
      "/layouts/page-notes/",
    )),
  create: (data: { content: string; account_ref_label?: string }) =>
    apiClient.post<UserPageNote>("/layouts/page-notes/", data),
  update: (id: number, data: Partial<Pick<UserPageNote, "content" | "account_ref_label">>) =>
    apiClient.patch<UserPageNote>(`/layouts/page-notes/${id}/`, data),
  destroy: (id: number) => apiClient.delete(`/layouts/page-notes/${id}/`),
};

export const commentsApi = {
  listAll: () =>
    apiClient.get<PaginatedResponse<Comment>>("/comments/comments/"),
  list: (resourceType: CommentResourceType, resourceId: number) =>
    apiClient.get<PaginatedResponse<Comment>>("/comments/comments/", {
      params: { resource_type: resourceType, resource_id: resourceId },
    }),
  /**
   * Comment count + a short preview for many records of one type, in a single request.
   *
   * Record cards across the app show a comment badge and inline preview, so the
   * un-batched alternative is one request per visible card — which bursts past the
   * `user` throttle. Returns an empty envelope without hitting the network when
   * there are no IDs to ask about (same contract as listMeetingNotesForEvents).
   */
  summary: (resourceType: CommentResourceType, resourceIds: number[]) => {
    if (resourceIds.length === 0) {
      return Promise.resolve(syntheticResponse<CommentSummaryResponse>({ results: {} }));
    }
    return apiClient.get<CommentSummaryResponse>("/comments/comments/summary/", {
      params: { resource_type: resourceType, resource_ids: resourceIds.join(",") },
    });
  },
  create: (data: {
    resource_type: CommentResourceType;
    resource_id: number;
    resource_label?: string;
    content: string;
    parent?: number | null;
    references?: CommentReference[];
    mentions?: CommentMention[];
  }) => apiClient.post<Comment>("/comments/comments/", data),
  update: (id: number, content: string) =>
    apiClient.patch<Comment>(`/comments/comments/${id}/`, { content }),
  delete: (id: number) =>
    apiClient.delete(`/comments/comments/${id}/`),
};

export const feedbackApi = {
  list: () =>
    apiClient.get<PaginatedResponse<FeedbackItem>>("/feedback/feedback/"),
  create: (data: FormData) =>
    apiClient.post<FeedbackItem>("/feedback/feedback/", data, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  get: (id: number) =>
    apiClient.get<FeedbackItem>(`/feedback/feedback/${id}/`),
  updateStatus: (id: number, status: string) =>
    apiClient.patch<FeedbackItem>(`/feedback/feedback/${id}/`, { status }),
  listComments: (feedbackId: number) =>
    apiClient.get<PaginatedResponse<FeedbackCommentType>>("/feedback/comments/", {
      params: { feedback: feedbackId },
    }),
  addComment: (feedbackId: number, content: string) =>
    apiClient.post<FeedbackCommentType>("/feedback/comments/", { feedback: feedbackId, content }),
  updateComment: (commentId: number, content: string) =>
    apiClient.patch<FeedbackCommentType>(`/feedback/comments/${commentId}/`, { content }),
  deleteComment: (commentId: number) =>
    apiClient.delete(`/feedback/comments/${commentId}/`),
  delete: (id: number) =>
    apiClient.delete(`/feedback/feedback/${id}/`),
};

export interface GmailMessage {
  from: string;
  date: string;
  subject: string;
  body: string;
}

export interface GmailCalendarSlot {
  url: string;
  label: string;
}

/** Which provider a stored meeting summary came from. Gong is preferred for display. */
export type MeetingNotesSource = "gong" | "zoom";

export interface MeetingNotesUpdate {
  meeting_id: number;
  airtable_id: string;
  meeting_name: string;
  date: string | null;
  account_name: string | null;
  sources: MeetingNotesSource[];
  email_subjects?: Partial<Record<MeetingNotesSource, string>>;
  /** Providers whose recording link was saved even though they carried no summary. */
  linked_sources?: MeetingNotesSource[];
  /** True when this meeting existed only as a calendar event until the import ran. */
  created_meeting?: boolean;
}

export interface MeetingNotesSkip {
  meeting_id: number;
  meeting_name: string;
  reason:
    | "already_summarized"
    | "no_matching_email"
    | "summary_limit_reached"
    /** A recap email matched but carried only links — the summary lives in the vendor's app. */
    | "email_has_no_summary";
  sources_without_summary?: MeetingNotesSource[];
  linked_sources?: MeetingNotesSource[];
}

/** Report returned by POST /integrations/gmail/meeting-notes/. */
export interface MeetingNotesEmailReport {
  days: number;
  account: string;
  account_name: string;
  /** True when the scan was narrowed to one account rather than all of the user's. */
  scoped_to_account: boolean;
  scanned_emails: number;
  scanned_meetings: number;
  updated: MeetingNotesUpdate[];
  skipped: MeetingNotesSkip[];
  errors: Array<{ meeting_id: number; meeting_name: string; source?: string; detail: string }>;
  summaries_truncated: boolean;
  max_summaries: number;
  /** Meetings whose matched email was a notification with no summary in it. */
  no_summary_in_email: number;
  /** Recording links saved from emails that carried no summary. */
  recordings_linked: number;
  /** Calendar events considered in the second pass because they had no meeting row. */
  scanned_unlinked_events: number;
  /** Meeting records created for calendar events that had none. */
  meetings_created: number;
}

export interface GmailThread {
  id: string;
  subject: string;
  participants: string[];
  all_participants?: string[];
  responders?: string[];
  is_invitation?: boolean;
  message_count: number;
  last_date: string;
  snippet: string;
  messages: GmailMessage[];
  summary: string;
  status: string;
  status_color: "red" | "amber" | "green" | "blue" | "gray";
  next_action: string;
  calendar_slots?: GmailCalendarSlot[];
}

export const integrationsApi = {
  getStatus: () =>
    apiClient.get<{ connected: OAuthCredential[]; sync_states: unknown[] }>(
      "/integrations/status/"
    ),
  getScraperStatus: () =>
    apiClient.get<{ confluence: boolean; jira: boolean; zendesk: boolean; gong: boolean; notion: boolean }>(
      "/integrations/scraper-status/"
    ),
  testGmail: () =>
    apiClient.get<{ ok: boolean; email?: string; messages_total?: number; scopes?: string[]; gmail_scope_granted?: boolean; error?: string }>(
      "/integrations/gmail/test/"
    ),
  getGmailThreads: (params: { account_domain?: string; account_name?: string; q?: string }) =>
    apiClient.get<{ threads: GmailThread[] }>("/integrations/gmail/threads/", { params }),
  // Scans Gong / Zoom recap emails and fills in meetings that have no AI summary yet.
  // Never overwrites existing notes, so it is safe to call repeatedly.
  //
  // `account` (AirtableAccount PK or `rec*` id) scopes the scan to one account, which is
  // what the account detail page does; `account_name` is the fallback for accounts with
  // no Airtable link. Omit both to cover every account the user is on — what the profile
  // and role pages do.
  getMeetingNotesFromEmail: (body?: { days?: number; account?: string; account_name?: string }) =>
    apiClient.post<MeetingNotesEmailReport>("/integrations/gmail/meeting-notes/", body ?? {}),
  // NOTE: no backend route exists yet for this — the caller (ThreadCard, orphaned/unwired)
  // is not reachable from any current page, so this is a type-level stub only.
  summarizeThread: (data: { subject: string; messages: GmailMessage[]; all_participants: string[]; is_invitation: boolean }) =>
    apiClient.post<Pick<GmailThread, "summary" | "status" | "status_color" | "next_action">>("/integrations/gmail/summarize-thread/", data),
  startGoogleConnect: () =>
    apiClient.get<{ authorization_url: string; state: string }>(
      "/integrations/google/connect/"
    ),
  syncGoogleCalendar: () =>
    apiClient.post<{ detail: string; event_count: number }>("/integrations/google/sync/"),
  pushActionItemsToGoogle: (items: Array<{
    airtableId: string;
    start: string;
    end: string;
    task: string;
    accountName?: string;
    googleEventId?: string;
  }>) =>
    apiClient.post<{ results: Array<{ airtableId: string; start: string; googleEventId: string }> }>(
      "/integrations/google/push-action-items/",
      { items }
    ),
  startSlackConnect: () =>
    apiClient.get<{ authorization_url: string; state: string }>(
      "/integrations/slack/connect/"
    ),
  connectAirtable: () =>
    apiClient.post<{ detail: string }>("/integrations/airtable/connect/"),
  startSalesforceConnect: () =>
    apiClient.get<{ authorization_url: string }>("/integrations/salesforce/connect/"),
  startGitHubConnect: () =>
    apiClient.get<{ authorization_url: string }>("/integrations/github/connect/"),
  startGoogleDriveConnect: () =>
    apiClient.get<{ authorization_url: string }>("/integrations/google-drive/connect/"),
  startNotionConnect: () =>
    apiClient.get<{ authorization_url: string }>("/integrations/notion/connect/"),
  startMicrosoftConnect: () =>
    apiClient.get<{ authorization_url: string }>("/integrations/microsoft/connect/"),
  startGmailConnect: () =>
    apiClient.get<{ authorization_url: string }>("/integrations/gmail/connect/"),
  registerGmailWatch: () =>
    apiClient.post<{ detail: string }>("/integrations/gmail/watch/"),
  notifySlackMention: (slackHandle: string, message: string) =>
    apiClient.post<{ detail: string }>("/integrations/slack/notify-mention/", { slack_handle: slackHandle, message }),
  disconnect: (provider: string) =>
    apiClient.delete(`/integrations/oauth/${provider}/`),
};

import type { ActionItemStep, StepStatus } from "../types/action_items";
export type { ActionItemStep, StepStatus };

export const stepsApi = {
  list: (actionItemId: number) =>
    apiClient.get<ActionItemStep[]>("/airtable/steps/", { params: { action_item: actionItemId } }),
  create: (data: { action_item: number; title: string; order: number }) =>
    apiClient.post<ActionItemStep>("/airtable/steps/", data),
  update: (id: number, data: Partial<ActionItemStep>) =>
    apiClient.patch<ActionItemStep>(`/airtable/steps/${id}/`, data),
  delete: (id: number) =>
    apiClient.delete(`/airtable/steps/${id}/`),
  /** Set the whole checklist order atomically. `ids` is the new top-to-bottom sequence. */
  reorder: (actionItemId: number, ids: number[]) =>
    apiClient.post<ActionItemStep[]>("/airtable/steps/reorder/", { action_item: actionItemId, ids }),
};

import type { SyncReviewItem, SyncDeleteRequest } from "../types/sync_review";

export const syncReviewApi = {
  listItems: (params?: { status?: string }) =>
    apiClient.get<{ count: number; results: SyncReviewItem[] }>("/sync-review/items/", { params }),
  acceptItem: (id: number, accountId: number) =>
    apiClient.patch<SyncReviewItem>(`/sync-review/items/${id}/accept/`, { account_id: accountId }),
  rejectItem: (id: number) =>
    apiClient.patch<SyncReviewItem>(`/sync-review/items/${id}/reject/`),
  listDeleteRequests: (params?: { status?: string }) =>
    apiClient.get<{ count: number; results: SyncDeleteRequest[] }>("/sync-review/delete-requests/", { params }),
  resolveDeleteRequest: (id: number, decision: "approved" | "rejected") =>
    apiClient.patch<SyncDeleteRequest>(`/sync-review/delete-requests/${id}/resolve/`, { decision }),
};
