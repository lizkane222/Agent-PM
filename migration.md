# Codebase Migration Audit

Answers to the 12 pre-migration questions. Goal: understand the current shape of the codebase before reorganizing CRUD / data logic.

---

## File Tree / Structure

### 1. Current file tree summary — confusing or inconsistent parts

**Frontend (`app/frontend/src/`)**

```
src/
├── App.tsx                    # root router + auth gate + context nesting
├── main.tsx
├── types/index.ts             # single 773-line type monolith
├── svg.d.ts
├── pages/                     # 17 route-level components (~30,000 lines total)
│   ├── AccountDetailPage.tsx  ← 7,230 lines (the problem child)
│   ├── CalendarPage.tsx       ← 5,549 lines
│   ├── ActionItemsPage.tsx    ← 4,212 lines
│   ├── ClaudeSkillsPage.tsx   ← 2,942 lines
│   ├── RolePage.tsx           ← 2,411 lines
│   ├── ChatPage.tsx           ← 1,720 lines
│   ├── TeamPage.tsx           ← 1,192 lines
│   ├── AccountsPage.tsx       ← 1,066 lines
│   └── ...8 others < 870 lines each
├── components/
│   ├── (top-level shared: Layout, GlobalSearch, ExportBar, etc.)
│   ├── calendar/              # sub-components for CalendarPage
│   ├── comments/              # generic comment system + useComments hook
│   ├── feedback/              # feedback modal UI
│   └── pagebuilder/           # ~18 drag-drop canvas components
├── context/                   # 4 React Contexts
├── hooks/                     # only 2 hooks here
├── lib/
│   ├── api.ts                 # all typed API namespaces
│   ├── analytics.ts / auth.ts / sync.ts / appLog.ts / titleRoles.ts
│   ├── useConvert.ts          ← hook living in lib/, not hooks/
│   └── useLogGlow.ts          ← hook living in lib/, not hooks/
└── assets/
    └── Lucidchart Assets/     # 70+ SVGs in a folder with a space in the name
```

**Backend (`app/backend/`)**

Each Django app follows the standard `models.py / views.py / serializers.py / urls.py` pattern consistently. The only navigational friction:

- Two separate sync apps (`airtable_sync/` and `salesforce_sync/`) both contain `sync.py` and `write_back.py` — easy to open the wrong one.
- `core/mixins.py` contains shared auth/permission mixins that are invisible from the app that needs them unless you know to look there.

**Flagged issues:**

| Issue | Location |
|---|---|
| 7,230-line page that also contains ~30 sub-components | `pages/AccountDetailPage.tsx` |
| Hooks scattered across `lib/` and `components/` subdirs, not in `hooks/` | `lib/useConvert.ts`, `lib/useLogGlow.ts`, `components/comments/useComments.ts`, `components/pagebuilder/useCanvasState.ts` |
| Single type file for the entire app | `types/index.ts` (773 lines) |
| `EditPreviewPage.tsx` is a 5-line passthrough wrapper | `pages/EditPreviewPage.tsx` |
| Folder name contains a space | `assets/Lucidchart Assets/` |

---

### 2. Existing page vs. data code separation

**Partially separated, but only at the HTTP layer.**

`lib/api.ts` is a genuine data-access layer: it exports typed, domain-namespaced objects (`accountsApi`, `airtableApi`, `schedulerApi`, `teamApi`, `commentsApi`, etc.) that every page imports from. No page talks to `axios` directly.

However, everything *above* that layer — `useEffect` fetch chains, loading state, error state, refetch triggers — lives inline in page components. The split is:

```
lib/api.ts         → typed HTTP calls (consistent ✓)
page components    → fetch orchestration, loading/error state, list management (all inline ✗)
```

One exception: `comments/` has a `useComments.ts` hook that extracts the fetch/state layer. `FeedbackContext` also encapsulates its own data fetch. Everything else is inline.

---

### 3. Feature-folder vs. technical-layer convention

**Backend:** technical-layer *within* feature folders (Django apps). Top-level organization is by domain (`accounts/`, `scheduler/`, `airtable_sync/`, etc.), each containing its own `models.py / views.py / serializers.py / urls.py`. Consistent.

**Frontend:** hybrid, inconsistently applied.

- Top level is technical layer: `pages/`, `components/`, `context/`, `hooks/`, `lib/`.
- Inside `components/`, some features have subfolders (`calendar/`, `comments/`, `feedback/`, `pagebuilder/`), but `accounts/` does not — all account-related sub-components live directly inside `AccountDetailPage.tsx`.
- There is no `components/accounts/`, `components/action-items/`, or `components/team/` folder even though those features have enough sub-component complexity to warrant it.

---

## CRUD / Data Logic

### 4. Where CRUD logic lives per record type

| Record type | CRUD location | Pattern |
|---|---|---|
| Account, AccountNote, AccountArtifact, AccountQuickLink | `AccountsPage.tsx`, `AccountDetailPage.tsx` | Inline `useEffect` + `accountsApi.*` |
| CustomerContact, CustomerContactNote | `AccountDetailPage.tsx` | Inline |
| AirtableActionItem, ActionItemAttachment | `ActionItemsPage.tsx` | Inline + optimistic local IDs |
| CalendarEvent | `CalendarPage.tsx` | Inline + Google sync |
| MeetingNote | `components/calendar/MeetingDetail.tsx` | Inline + WebSocket |
| Reminder | `RemindersPage.tsx` | Inline |
| AgentSession, AgentMessage | `ChatPage.tsx` | Inline |
| ClaudeSkill, AgentSkill, SkillInvocation | `ClaudeSkillsPage.tsx` | Inline |
| TeamMember, UserProfile | `TeamPage.tsx`, `ProfilePage.tsx` | Inline |
| Comment | `components/comments/useComments.ts` | **Extracted hook** (only one) |
| FeedbackItem | `FeedbackContext.tsx` | **Extracted context** |
| DiscoverApplet | `DiscoverPage.tsx` | Inline |
| PageLayout, WorkingSession, UserPageNote | `components/pagebuilder/PageBuilder.tsx` | Inline |
| SalesforceProject, SalesforceTask | `CalendarPage.tsx` | Inline |
| OAuthCredential | `SettingsPage.tsx`, `AccountDetailPage.tsx` | Inline |

**Summary:** Not consistent. Comments and Feedback are the outliers (extracted); everything else is inline in page components.

---

### 5. Shared / duplicated fetch boilerplate

Yes — nearly every entity re-implements this pattern verbatim:

```ts
const [items, setItems] = useState<T[]>([]);
const [loading, setLoading] = useState(true);
useEffect(() => {
  setLoading(true);
  someApi.list(params)
    .then(({ data }) => { setItems(data.results); setLoading(false); })
    .catch(() => setLoading(false));
}, [dep]);
```

This pattern appears in ~12 different page components. A `useResource<T>(fetcher, deps)` hook — or React Query — could collapse it to a single abstraction.

The `useActionItemFieldOptions` hook in `hooks/` shows the team already knows how to do this: it adds a module-level cache to avoid redundant network calls. That pattern should be generalized.

---

### 6. Record types with unusual CRUD needs

| Record type | Unusual need |
|---|---|
| `AirtableActionItem` | Optimistic local IDs (`local-*` prefix), batch "stage items" flow, bidirectional Airtable write-back. Items exist in a local-only state before being confirmed. |
| `MeetingNote` | Real-time collaborative editing via WebSocket (`/ws/meeting-notes/:event_id/`). Two editors can be live simultaneously. |
| `VoiceSession` + transcripts | Real-time voice transcription streamed via WebSocket (`/ws/voice-transcript/:callSid/`). |
| `AccountArtifact` | File upload (multipart form data, not JSON). |
| `PageLayout` | Complex nested JSON blob representing a drag-drop canvas — stored and diff'd as a whole object, not field-by-field. |
| `CalendarEvent` | Read from Google Calendar via OAuth sync; some fields are read-only from the UI perspective. |
| `SalesforceProject`, `SalesforceTask` | Synced from Salesforce OAuth. Read-mostly with selective local annotation. |
| `AgentMessage` | Streaming AI token-by-token responses; messages grow in-place as streaming progresses. |

---

## State & Hooks

### 7. State management approach and conventions

**No external state library.** All state is plain React `useState` + `useEffect` + Context.

**Four shared Contexts:**

| Context | What it holds | Consumers |
|---|---|---|
| `CurrentUserContext` | Logged-in `UserProfile` (fetched once on app load) | 8+ pages/components |
| `ExportContext` | Cross-page "export basket" (selected items → push to chat) | AccountsPage, ActionItemsPage, RemindersPage, Layout, GlobalSearch, PageBuilder |
| `FeedbackContext` | Modal open/closed state + FeedbackItem submission | Layout (trigger), FeedbackModal (submit) |
| `NotificationDefaultsContext` | Per-user reminder notification preferences | RemindersPage, SettingsPage |

**Hooks inventory:**

| Hook | Location | What it does |
|---|---|---|
| `useActionItemFieldOptions` | `hooks/` | Fetches Airtable field options with module-level cache |
| `useScheduledOccurrences` | `hooks/` | Computes recurring event occurrences |
| `useComments` | `components/comments/` | CRUD + state for generic comments on any resource |
| `useCanvasState` | `components/pagebuilder/` | Drag-drop canvas undo/redo state |
| `useConvert` | `lib/` | Converts AirtableActionItem → CalendarEvent / ActionItem / Reminder |
| `useLogGlow` | `lib/` | Triggers a visual "glow" animation on log entries |

**Naming convention:** `use<Entity><Action>` or `use<Entity>` — loosely followed, not enforced. The hooks living in `lib/` vs `hooks/` break the convention.

---

### 8. CRUD state shared across multiple unrelated pages

| Shared state | Where | Pages / components that depend on it |
|---|---|---|
| `CurrentUserContext.profile` | `CurrentUserContext.tsx` | AccountDetailPage, CalendarPage, ClaudeSkillsPage, TeamPage, DiscoverPage, RolePage, AdminDataPage, CommentPanel, InlineCommentThread, MeetingDetail, PageBuilder |
| Export basket | `ExportContext.tsx` | AccountsPage, ActionItemsPage, RemindersPage, Layout, ExportBar, GlobalSearch, PageBuilder |
| Notification defaults | `NotificationDefaultsContext.tsx` | RemindersPage ↔ SettingsPage (both read/write) |
| Comment panel | `CommentContext.tsx` + `useComments` | Layout (trigger), CommentPanel, InlineCommentThread |
| Feedback modal | `FeedbackContext.tsx` | Layout (trigger), FeedbackModal |

These are already cleanly isolated in Contexts; they would survive a reorg intact as long as the provider tree in `App.tsx` is not disturbed.

---

## Coupling & Risk

### 9. Pages that depend on multiple record types simultaneously

| Page | Record types fetched | Coupling level |
|---|---|---|
| `AccountDetailPage.tsx` | Account, AccountNote, AccountArtifact, AccountQuickLink, CustomerContact, AirtableActionItem, ActionItemAttachment, CalendarEvent, MeetingNote, Reminder, TeamMember, OAuthCredential, SearchResults, Tag | **Extreme** — 7,230 lines, ~14 entity types |
| `CalendarPage.tsx` | CalendarEvent, MeetingNote, AirtableActionItem, Account, TeamMember, OAuthCredential, SalesforceProject, SalesforceTask | **High** — 5,549 lines, 8 entity types |
| `ActionItemsPage.tsx` | AirtableActionItem, ActionItemAttachment, Account, CalendarEvent, TeamMember, SearchResults | **High** — 4,212 lines, 6 entity types |
| `RolePage.tsx` | TeamMember, Account, CalendarEvent, AirtableActionItem, Reminder, Segment workspace | **Medium-high** |
| `DashboardPage.tsx` | AirtableActionItem, CalendarEvent | **Low** — read-only snapshot |
| `LogsPage.tsx` | AgentSession, AgentSkill, FeedbackItem, CalendarEvent | **Low** — read-only log viewer |

The three large pages are fundamentally aggregation views — they are *supposed* to show data from many domains. The risk is not coupling per se, but the fact that all the fetch logic, rendering logic, and sub-component definitions are co-located in a single file.

---

### 10. Auth/permission logic embedded in data-fetching code

**Backend:** Yes, and it's worth understanding before moving anything.

Every ViewSet uses `permission_classes = [IsAuthenticated]`. Row-level scoping lives in `get_queryset()` methods via the `_staff_sees_all(request.user)` helper (duplicated in `airtable_sync/views.py`, `accounts/views.py`, `team/views.py`). Example pattern:

```python
def get_queryset(self):
    if _staff_sees_all(self.request.user):
        return AirtableAccount.objects.all()
    return AirtableAccount.objects.filter(team_members__user=self.request.user)
```

`core/mixins.py` centralizes two object-level auth patterns:

- `RequireAccountMembershipMixin` — checks caller is a team member on the account before write
- `RequireCalendarEventOwnershipMixin` — checks caller owns or is on the account for the event

If views are reorganized (e.g., merging the two sync apps, extracting service layers), the `_staff_sees_all` duplication and the queryset-level filtering would need to move with the view, not the model.

**Frontend:** No auth logic in data-fetching code. JWT attach + token refresh is handled entirely in `apiClient.interceptors` in `lib/api.ts`. Safe to move.

---

### 11. Test coverage

**There are no tests.**

All `tests.py` files in the backend apps are empty (0 lines). No `.test.ts` or `.test.tsx` files exist in the frontend. If CRUD logic moves without behavior changing, nothing will catch a regression automatically. Any reorganization needs manual smoke-testing of the affected flows, ideally against a staging environment.

---

### 12. Scope sanity check — what to exclude from the first pass

**Exclude from pass 1:**

| File/area | Reason |
|---|---|
| `AccountDetailPage.tsx` (7,230 lines) | Depends on ~14 record types. Contains ~30 inlined sub-components. No tests. This is the riskiest single file in the app and should be its own dedicated effort after baseline patterns are established. |
| `CalendarPage.tsx` (5,549 lines) | Real-time WebSocket + Google Calendar sync + Salesforce sync. Multiple external state sources make extraction particularly fragile. |
| `ActionItemsPage.tsx` (4,212 lines) — specifically the local-draft flow | The `local-*` optimistic ID pattern is a custom stateful protocol that lives across rendering, sync, and the Airtable write-back layer. It doesn't fit a standard CRUD pattern and deserves its own refactor design. |
| `MeetingDetail.tsx` WebSocket code | Real-time collab logic is standalone; touches neither the page tree nor a clean service boundary. Low ROI to move. |

**Good first-pass candidates (lower risk, clearer boundaries):**

| File/area | Why |
|---|---|
| `RemindersPage.tsx` (569 lines) | Single-domain, no real-time, clear `schedulerApi` boundary. |
| `TeamPage.tsx` (1,192 lines) | Single-domain mostly, `teamApi` only. |
| `DiscoverPage.tsx` (753 lines) | Self-contained, `discoverApi` + `teamApi`. |
| `LogsPage.tsx` (648 lines) | Read-only views for 4 domains; no writes. |
| Backend service layer extraction | Backend is already well-organized; centralizing the duplicated `_staff_sees_all` helper is low-risk and high-value. |

**General recommendation:** Start by standardizing the data layer (introduce a `useResource` / React Query pattern) on a small page (`RemindersPage` is ideal), validate the pattern feels right, then roll it to medium pages before touching the three large ones.
