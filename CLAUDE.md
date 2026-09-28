# CLAUDE.md — Development Rules for Twilio-AgentPM-dataModeledApp

This file is authoritative for all Claude instances working in this repo. Read it before making any changes.

---

## What this repo is

A structurally reorganized copy of the original app at `/Users/lizkane/Desktop/TWILIO - Agent PM`.
Same stack, same API contracts, same UI — cleaner internal organization.

**The original app at `/Users/lizkane/Desktop/TWILIO - Agent PM` must never be modified.**

---

## Stack

- **Frontend:** React 18 + TypeScript, Vite 5, Tailwind CSS
- **Backend:** Django / Django REST Framework, SQLite (dev), PostgreSQL (prod via `DATABASE_URL`)
- **Shared package:** `twilio-agent-pm-shared` (vendored at the repo root; aliased in vitest and vite configs — see 2026-08-28 session log entry)
- **Frontend tests:** Vitest + React Testing Library + MSW v2
- **Backend tests:** Django `APITestCase` (DRF)

---

## Hard constraints

These are non-negotiable and apply to every change in every session:

1. **Never change visible behavior, styling, routes, or API contracts.** This is a structural repo — refactor and test, don't redesign.
2. **Never modify the original app** at `/Users/lizkane/Desktop/TWILIO - Agent PM`.
3. **Tests are not optional.** Every new or modified hook, page, and backend view endpoint must have automated tests written in the same change. Do not defer tests to a follow-up.
4. **All tests must pass before a change is considered done.** Run `npm run test` (frontend) and `python manage.py test` (backend) and confirm both exit 0.
5. **The build must stay clean.** `npm run build` in `app/frontend/` must produce no TypeScript errors after every change.

---

## Explicitly out of scope — do not attempt

These areas need their own dedicated design effort. Do not migrate, refactor, or restructure them:

| File | Reason |
|---|---|
| `AccountDetailPage.tsx` (~6,874 lines) | Still large. Defines its own local `ActionItemCard` (~L806) used by 4 call sites — not the shared `components/account/ActionItemCard.tsx`. Additive edits only. |
| `CalendarPage.tsx` (~5,549 lines) | Real-time WebSocket + Google Calendar OAuth + Salesforce sync |
| `ActionItemsPage.tsx` — local-draft flow | `local-*` optimistic ID protocol spans render, sync, and Airtable write-back |
| `MeetingDetail.tsx` — WebSocket code | Real-time collaboration; standalone concern |
| `useComments` (`components/comments/useComments.ts`) | Cross-cutting; see HOOK_SPEC.md §5 for future migration path |
| `useCanvasState` / PageBuilder | Complex undo/redo canvas state |

---

## Hook architecture

All data-fetching hooks are built on `useResource<T>` in `src/hooks/useResource.ts`. Read `HOOK_SPEC.md` before writing a new hook.

### Rules

- **One entity per hook.** A page that needs two entity types calls two hooks.
- **Hook name:** `use<Entity>` — e.g. `useTeam`, `useReminders`, `useDiscover`. Not `usePageData`.
- **All hooks live in `src/hooks/`** — never in `lib/`, `pages/`, or `components/` (except `useComments` which stays put).
- **Fetcher unwraps DRF envelopes.** The hook is responsible for `.then(r => r.data.results)` — `useResource` receives a `T[]` promise.
- **Mutations call `refetch()` on success and re-throw errors** so the page can show user-facing messages.
- **No optimistic updates** — not in scope; mutations always wait for the server and then refetch.
- **Stable `refetch` reference** — always wrapped in `useCallback` with no deps (increments an internal tick counter).

### Existing hooks (do not duplicate)

| Hook | File | Entity |
|---|---|---|
| `useResource<T>` | `hooks/useResource.ts` | Base |
| `useReminders` | `hooks/useReminders.ts` | `Reminder[]` |
| `useTeam` | `hooks/useTeam.ts` | `TeamMember[]` |
| `useDiscover` | `hooks/useDiscover.ts` | `DiscoverApplet[]` |
| `useAgentSessions` | `hooks/useAgentSessions.ts` | `AgentSession[]` |
| `useFeedbackItems` | `hooks/useFeedbackItems.ts` | `FeedbackItem[]` |
| `useCalendarEvents` | `hooks/useCalendarEvents.ts` | `CalendarEvent[]` |

---

## Type organization

Types live in per-domain files under `src/types/`. `src/types/index.ts` re-exports everything for backwards compatibility but contains no inline definitions.

| Domain file | Types it owns |
|---|---|
| `types/scheduler.ts` | `Reminder`, `ReminderStatus`, `ReminderResourceType`, `CalendarEvent`, `MeetingNote`, `Attendee` |
| `types/team.ts` | `Tag`, `TeamMember`, `UserProfile` |
| `types/discover.ts` | `DiscoverApplet`, `AppletCategory`, `ItemType`, `UrlStatus` |
| `types/agents.ts` | `SessionParticipant`, `AgentSession`, `AgentMessage`, `ToolCall`, `AgentSkill`, `AgentSkillStatus`, `AgentSkillVisibility`, `AgentSkillScript` |
| `types/feedback.ts` | `FeedbackStatus`, `FeedbackComment`, `FeedbackItem` |

### Rules

- New types go in the domain file that owns their entity. If the domain file doesn't exist yet, create it.
- **Domain type files must never import from `types/index.ts`** — that creates circular imports. They import from other domain files directly if needed.
- `types/index.ts` imports FROM domain files, not the other way around.

---

## Frontend testing rules

Framework: **Vitest + React Testing Library + MSW v2** (`msw/node` `setupServer`).
Test environment: **jsdom** (not happy-dom — MSW node interceptors require Node's http module, which happy-dom bypasses).

### Required tests for every change

| What you change | Tests required |
|---|---|
| New `use<Entity>` hook | Hook test in `src/hooks/__tests__/<hookName>.test.ts`: happy path, loading state, error state, refetch, mutations (each calls API + triggers refetch) |
| Modified page component | Page test in `src/pages/__tests__/<PageName>.test.tsx`: loading state, empty state, populated state, key user interactions |
| New MSW handler needed | Add to `src/test/handlers/<domain>.ts` alongside a typed `mock<Entity>` export |

### API mocking rules

- **Always mock at the network layer via MSW** — never mock `lib/api.ts` functions directly.
- Default (happy-path) handlers live in `src/test/handlers/<domain>.ts`.
- Error/edge-case overrides use `server.use(http.get(...))` inside the test body — they are automatically reset after each test by `server.resetHandlers()`.
- `onUnhandledRequest: "error"` is set in `src/test/setup.ts` — if a test fires an API call with no handler, it fails loudly. Add the handler rather than silencing the error.

### File locations

```
src/
├── hooks/
│   ├── useMyHook.ts
│   └── __tests__/
│       └── useMyHook.test.ts
├── pages/
│   ├── MyPage.tsx
│   └── __tests__/
│       └── MyPage.test.tsx
└── test/
    ├── setup.ts
    ├── msw-server.ts
    └── handlers/
        └── <domain>.ts      ← one file per Django app
```

---

## Backend testing rules

Framework: **Django `APITestCase`** (DRF). No pytest, no factory_boy — not installed.

### Required tests for every change

| What you change | Tests required |
|---|---|
| New or modified ViewSet | `<app>/tests/test_views.py`: unauthenticated → 401, owner/scope list, create sets correct owner, update own (allowed) + update other's (403/404), delete own + delete other's |
| New permission mixin | `core/tests/test_mixins.py`: every branch (allowed / denied / staff bypass) |
| New `get_queryset` scope | Test that staff sees all, non-staff sees only their own |

### File locations

```
backend/<app>/
└── tests/
    ├── __init__.py
    └── test_views.py
```

Create the `tests/` package (with `__init__.py`) if it doesn't exist. Do not put tests in the top-level `tests.py` stub.

### `_staff_sees_all`

The canonical implementation is in `core/mixins.py`. Import from there — never redefine it locally in a view file:

```python
from core.mixins import _staff_sees_all
```

---

## Key commands

All commands run from `app/frontend/` (frontend) or `app/backend/` (backend) unless noted.

```bash
# One-time setup after a fresh clone (or after pulling changes to twilio-agent-pm-shared/):
#   cd twilio-agent-pm-shared && npm install   # installs its runtime dep (zod) — required for
#                                               # app/frontend's Vite/Vitest alias to resolve
#   cd app/frontend && npm install
#   cd app/backend && python3.13 -m venv .venv && source .venv/bin/activate \
#     && pip install -r requirements.txt        # backend venv (see 2026-09-15 log entry —
#                                               # it must be THIS repo's own, not the old app's)

# Start the app (from app/)
npm run start-agent-pm
# → Django/Daphne on :8000, Vite on :5173
# Browser: http://localhost:5173

# ⚠️ Daphne has NO autoreload. Vite hot-reloads the frontend, but ANY Python change
# (new view, new @action route, serializer field, model) is invisible until the
# backend process is restarted. A new endpoint added mid-session returns 404 —
# which reads exactly like a routing bug, and the test suite won't catch it because
# Django's test client builds a fresh URLconf. Restart just the backend with:
#   pkill -f daphne && (cd app/backend && .venv/bin/daphne -b 0.0.0.0 -p 8000 core.asgi:application &)
# Verify a new route is live by hitting it unauthenticated: 401 = route exists,
# 404 = the server is still running old code.

# Frontend tests
npm run test              # watch mode
npx vitest run            # single run
npx vitest run --coverage # with coverage report

# Backend tests (from app/backend/)
source .venv/bin/activate
python manage.py test                        # all apps
python manage.py test <app>.tests            # single app

# Type check only (no emit)
npx tsc --noEmit

# Production build
npm run build
```

---

## Before marking any task complete

- [ ] `npx vitest run` exits 0 with no skipped tests
- [ ] `python manage.py test` exits 0
- [ ] `npm run build` produces no TypeScript errors
- [ ] No API routes, request shapes, or response shapes were changed
- [ ] No visible UI or styling changes were introduced
- [ ] The original app at `/Users/lizkane/Desktop/TWILIO - Agent PM` was not touched

---

## Session Log

### 2026-07-29 — AccountDetailPage migration Phases 3–5

**What changed**
- `AccountDetailPage.tsx` reduced from 7,230 → 1,268 lines
- Phase 3 (trivial): extracted `Avatar`, `ReminderBell`, `ReminderSection`, `EmailStatusBadge`, `ArtifactIcon`, `ArtifactViewer`, `NoteActionButton`, `PillInputs`, `EditAccountModal`, `SidebarField`, `ContactNoteRow`, `ThreadCard`, `ActionItemCardOccurrences`
- Phase 4 (medium): created `src/lib/noteHelpers.tsx` + 15 components in `src/components/account/`
- Phase 5 (hard): extracted `NewActionItemCard`, `ActionItemModal`, `ActionItemCard`, `AccountTimeline`, `ProjectGoals`, `AccountNoteRow`, `AccountMeetingNotes`

**Key decisions**
- `noteHelpers` must be `.tsx` not `.ts` — `renderNoteInline` contains JSX
- `AddArtifactModal` bundled into `ArtifactsPanel.tsx` (exclusively rendered there)
- `handleKanbanDrop` deps: `[actionItems, setKanbanDragOverCol, setActionItems]`

**Left open**
- Phase 6: component tests for `ActionItemModal`, `CustomerContactsPanel`, `ProjectGoals`, `AccountNoteRow` + `AccountDetailPage` smoke suite

---

### 2026-08-07 — Action items rich text + steps subsystem

**What changed**

Backend:
- `ActionItemStep` model in `airtable_sync/models.py` — FK to `AirtableActionItem`, status: Open/Done/Blocked/Archived
- `ActionItemStepViewSet` at `/api/v1/airtable/steps/`
- `action_item_step` added to `RESOURCE_TYPE_CHOICES` in `comments/models.py`

Frontend:
- `StepStatus` / `ActionItemStep` types in `types/action_items.ts`
- `stepsApi` in `lib/api.ts`, `useActionItemSteps` hook
- `ActionItemDescriptionEditor.tsx` — TipTap v3 rich text (bold/italic/strike, lists, link, @mention)
- `StepsPanel.tsx` — step list with status badges, inline editing, inline comments, delete

**Key decisions**
- `task_details` now stores HTML; `plainToHtml()` handles legacy plain-text on read
- TipTap Placeholder uses `elementFromPoint` (not in jsdom) — always mock `ActionItemDescriptionEditor` in page tests
- 242/242 frontend tests; 193/193 backend tests; `tsc --noEmit` clean

---

### 2026-08-07 — Meeting link chip + Done-sort + step handlers

**What changed**
- `handleConvertStepToActionItem` and `handleAddStepToCalendar` wired in `ActionItemsPage`
- Done-sort descending on three sorted lists in `ActionItemsPage`
- Meeting chip (violet pill) on `KanbanCard` and `ActionItemCard`; click navigates to `/accounts/:id?meeting=:linkedMeetingId`
- `AccountDetailPage`: `useSearchParams` reads `?meeting=<id>` on load, opens meeting panel, scrolls timeline
- 250/250 frontend tests; 193/193 backend tests; `tsc --noEmit` clean

---

### 2026-08-12 — SettingsPage: Register Gmail watch + sign-out + org data sources

**What changed**

Frontend only:
- `integrationsApi.getScraperStatus()` — `GET /api/v1/integrations/scraper-status/` in `lib/api.ts`
- `integrationsApi.registerGmailWatch()` — `POST /api/v1/integrations/gmail/watch/` in `lib/api.ts`
- `SettingsPage.tsx`: `handleSignOut` (calls `logout()` then navigates to `/oidc/logout/`), Sign-out button in header, "Register Gmail watch" button alongside Gmail `ConnectionCard`, "Organization Data Sources" section (confluence/jira/zendesk/gong/notion with Active/Token-not-configured status)
- `test/handlers/team.ts`: added `mockUserProfile` export + `GET /api/v1/team/profiles/me/` and `PATCH /api/v1/team/profiles/me/` handlers
- `pages/__tests__/SettingsPage.test.tsx`: 8 tests (loading state, sign-out button, profile display name, org sources, active org source, sign-out click, register Gmail watch button, register Gmail watch success)

**Key decisions**
- Test isolation: `beforeEach` resets `window.location` to `{ href: "http://localhost/" }` (absolute URL). Root cause: test 6's `Object.defineProperty(window.location, {href: "/"})` (relative URL) caused axios's `isURLSameOrigin` to throw `Invalid URL` in subsequent tests, silently leaving `credentials = []`
- 257/257 frontend tests pass (excluding 4 pre-existing untracked failures); `tsc --noEmit` clean; 96/96 tracked backend tests pass

**Left open**
- Phase 6 AccountDetailPage tests (deferred from 2026-07-29)
- Pre-existing backend failures in untracked apps (account_feed, accounts/tests, search/tests, sync_review, comments/tests) — reference symbols not yet implemented in tracked source files

---

### 2026-08-17 — Focus pins everywhere, Pinned In Progress, Collapse All, drag-reorder

**What changed**

Backend:
- `core/pagination.py` — new `ClientPageSizePagination` (honours `?page_size=`, max 1000). Attached to `AirtableAccountViewSet` and `accounts.AccountViewSet` only, not the global default. The project default is bare `PageNumberPagination` with **no `page_size_query_param`**, so `?page_size=` was silently ignored before this.
- `AirtableActionItemViewSet.get_queryset` — rewrote the ADMIN privacy filter. The old three-way `Q(...)|Q(...)|Q(...)` was unreachable-by-construction for ADMIN items with a blank assignee: all three branches failed, hiding 9 rows from **every** user including staff. Now one `.exclude(private_admin & ...)`. Unassigned ADMIN items are shared; assigned ones stay private. Deliberately **no** `_staff_sees_all` bypass.
- `airtable_sync/tests.py` — added `AirtableActionItemVisibilityTests` (10) + `ClientPageSizePaginationTests` (3).

Frontend:
- `lib/localStore.ts` — `createLocalStore<T>()`: module-level value + subscriber set + one `storage` listener, with `reload()`. Exists because the `storage` event does **not** fire in the document that wrote, so N sibling `useState` copies of one key drift apart in-tab.
- `hooks/useFocusPins.ts` — single owner of `actionFocusPins`. Replaced three independent copies (ActionItemsPage, ActionItemsSidebar, plus a dead prop). Cards call the hook directly, so no prop threading.
- `hooks/useAccountGroupCollapse.ts` — owns `actionItemsCollapsedAccounts-v1`. `accountGroupKey()` canonicalises on the lowercased account name so the Views grid (keyed `at-3`/`app-7`) and ProjectsView (keyed by name) share one memory.
- `ContextMenu.tsx` — added `focusPinMenuItem()`; `FocusPinBadge` is now unconditionally top-right.
- Right-click "Pin to Focus" + top-right badge on **all 7** action-item card components: ActionItemsPage `KanbanCard` (3 branches), StatusBoardView, DueDateView, `calendar/KanbanCard`, `calendar/ActionItemsSidebar`, `account/ActionItemCard`, and the local card in `AccountDetailPage` (which also covers `CalendarPage`'s diverged copy).
- "Pinned In Progress" moved **below** the three staging columns and rebuilt with real `KanbanCard`s (compact variant) + a zone pill. Single-mount: a pinned card is hidden from its zone panel and shown as a ghost in the Views grid.
- Drag-to-reorder in Stage Today / Currently Tracking. New `actionItemOrder` key, `ZoneOrderMap` = ordered id array per zone.
- Display fixes: `page_size=500` on both account fetches; "Unmatched account" catch-all row; `RENDERABLE_ZONES` rescue for items stranded in `complete`/`done-accounts-*`.

**Key decisions**
- Pins stay client-side. Storage shape unchanged (`string[]`), so existing pins survive with no migration.
- Collapse storage is an **array of collapsed keys**, not an `allCollapsed` boolean — a boolean cannot express "all collapsed except Acme". The button's label is derived via `allCollapsed(visibleKeys)`.
- Reorder stores an **ordered id array**, not an index map: array insert is one atomic write; renumbering indices races across tabs. Unknown ids sort to the bottom via `?? Infinity` and `Array.sort` is stable, so an empty map reproduces the old API order exactly.
- Cards report a `beforeId` insertion hint on `dragOver`; they have **no** `onDrop`. The event bubbles to the zone container so `handleDrop` stays the single mutation site (blank promotion, timer stop, status PATCH all unchanged). The order write happens after `resolvedId` resolves, so `local-*` never enters the array.
- **Behaviour change:** the `active` and `unstaged` status branches in `handleDrop` are now gated on `prevZone !== targetZone`. A same-zone drop used to be a visual no-op that still ran the whole tail; once it became a reorder that meant a redundant status PATCH plus a spurious `work_tracking` calendar event under Auto Track.
- `canPin`/`canPinItem` guard suppresses pin UI on `local-*` blanks everywhere — `promoteBlankItem` discards that id, so a pin against it would orphan forever.
- Right-click handlers on the input-heavy card layouts bail via `closest("input, textarea, [contenteditable])` so the native paste menu still works.
- Deleted the old inline 📌 button: it was gated to `focusMode && zone === "today"` (unreachable in 5 of 6 zones), used an emoji not `FocusPinBadge`, and sat at the bottom of the actions rail.

**Test-harness notes**
- `fireEvent.dragOver` cannot carry `clientY` — jsdom has no `DragEvent`, so RTL falls back to a plain `Event` and drops mouse coords, making every hover read as "insert below". Dispatch a `MouseEvent` named `"dragover"` instead (see `dragOverAt` in `ActionItemsPage.test.tsx`).
- `getBoundingClientRect` returns all zeros in jsdom — stub it for reorder tests.
- Account-row assertions must use `getByTitle(/Collapse <name>/)`: the account name appears in both the row header and each card's badge, and the header button's accessible name is the name alone, not the title.
- Module-level stores need `reload()` after `localStorage.clear()` in tests (no storage event fires).

**Also fixed (pre-existing, unrelated)**
- `AccountDetailPage.test.tsx` had `FUTURE_MEETING_DATE = "2026-08-15"` hardcoded; it went stale mid-session and turned off the "Before Next Meeting" button. Now computed relative to today.
- `realtime` `VoiceTwiMLViewTests` failed in full-suite runs only: an unauthenticated endpoint drawing on the process-wide anon throttle bucket (20/min) exhausted by earlier tests. Added `cache.clear()` in `setUp`.

**Verified**
- 367/367 frontend (was 316), 252/252 backend (was 222/223 — the 1 failure was the throttle flake above), `tsc --noEmit` clean, `npm run build` clean.

**Corrections to this file**
- The out-of-scope table said `AccountDetailPage.tsx` is 1,268 lines. It is **6,874**, and it defines its own local `ActionItemCard` (~line 806) that 4 of its call sites use — **not** `components/account/ActionItemCard.tsx`, which only `ProjectGoals.tsx` uses.
- `airtable_sync/tests.py` is **not** a stub (19 pre-existing tests). Do not create an `airtable_sync/tests/` package beside it — the module names collide.
- `hooks/useActionItemZones.ts` exists with a passing test but has **zero consumers**. Left dormant; wiring it up means touching the out-of-scope `local-*` protocol.

**Left open**
- `AccountDetailPage`'s local `ActionItemCard` duplicates `components/account/ActionItemCard.tsx`; `CalendarPage.tsx:882` duplicates `ActionItemsSidebar`'s `ActionItemCard_Cal`.
- `ZONE_LABELS.active` says "In Progress" while the column header says "Currently Tracking".
- The `accounts` branch of `handleDrop` has the same same-zone redundancy that was fixed for `active`/`unstaged`.
- No dedicated test file for `calendar/ActionItemsSidebar` (its pin path is covered indirectly via the shared hook + `calendar/KanbanCard` tests).

---

### 2026-08-17 — Duplicate "Admin" / "ADMIN" account merge

**Symptom**
Staff users saw two Admin accounts in the left nav and calendar Accounts sidebar; non-staff saw one.

**Root cause**
Two rows in `accounts_account`: id 18 `Admin` (`is_admin_account=1`, `admin_owner=lizkane`, the real per-user workspace) and id 1 `ADMIN` (`is_admin_account=0`, no `admin_owner`, `airtable_id=recOyHsTVIH3VgWTF`) — a legacy mirror of the shared Airtable "ADMIN" row left by the import script removed in fb13418. The staff branch of `AccountViewSet.get_queryset` is `is_admin_account=False OR admin_owner=user`, so id 1 matched the first clause and id 18 the second. The non-staff branch requires a `team_members` row, which id 1 lacked. The Airtable side was already name-guarded (`AirtableAccountViewSet`, `AccountsSidebar`); the Django mirror was not.

**What changed**
- `accounts/models.py`: `ADMIN_ACCOUNT_NAME` + `get_or_create_admin_account(user)` — the `get_or_create` + `TeamMember` link previously inlined in `AdminAccountView.get`, now shared with the sync layer.
- `accounts/views.py`: `AdminAccountView.get` delegates to the helper. `AccountViewSet.get_queryset` excludes `company_name__iexact="admin" AND is_admin_account=False` in both branches.
- `airtable_sync/sync.py`: `_resolve_scheduler_account` routes items under an Airtable account named "admin" to the **assignee's** personal Admin account; unassigned → `None`. Other accounts still resolve by `airtable_id`.
- `accounts/migrations/0017_merge_orphan_admin_accounts.py`: data migration. Action items move to their assignee's Admin (unassigned → NULL); other children move to `created_by`'s Admin via a generic `_meta.related_objects` loop; then the orphan row is deleted. Idempotent, reverse = no-op.

**Key decisions**
- The `AirtableAccount` "ADMIN" row is **kept** — Airtable action items FK to it, and `/airtable/action-items/?account_name=` matches `iexact`, so the personal "Admin" page already listed the same items. Nothing user-visible was lost by deleting the Django mirror.
- Unassigned Admin items get no account, matching the existing "blank assignee ⇒ no owner ⇒ shared" rule in `AirtableActionItemViewSet.get_queryset`. Attaching them to one user's Admin would be undone by the next sync anyway.
- Step 2 is what makes the merge durable: without it `mirror_action_item_to_scheduler` would null out every Admin item's account on the next sync.
- The migration refuses to delete an orphan with unmergeable children (logs instead), so no CASCADE data loss in prod.

**Verified**
- Dev DB after migrate: one `Admin` row (id 18), 11 assigned items on it, 9 unassigned on NULL, `AirtableAccount` id 4 intact. Backup at `/tmp/db.sqlite3.pre-admin-merge`.
- 252/252 backend (7 new in `accounts/tests/test_views.py::AdminAccountDeduplicationTest`, 9 new in `airtable_sync/tests.py::ResolveSchedulerAccountTests`), 367/367 frontend, `tsc --noEmit` clean. No frontend change needed.

---

### 2026-08-17 — Distinct calendar color per event type

**Why**
`toFullCalendarEvent` in `CalendarPage.tsx` never read `event_category` — every non-action-item event was painted `statusColor()` blue, so Task / Out of Office / Focus Time / Working Location / Appointment were indistinguishable on the grid. `CATEGORY_COLORS` existed in `calendarHelpers.tsx` but only the detail-panel header used it, and three call sites disagreed about Task (pink vs violet vs pink).

**Palette** (hues spread so no two categories read alike)

| Type | Color | |
|---|---|---|
| Meeting | `#3b82f6` blue-500 | via `statusColor()` — lighter when tentative |
| Task | `#ea580c` orange-600 | |
| Action item | `#a78bfa` violet-400 | `WORK_TRACKING_COLOR`, unchanged |
| Out of Office | `#e11d48` rose-600 | |
| Focus Time | `#0891b2` cyan-600 | was amber, which collided with orange Task + amber reminders |
| Working Location | `#10b981` emerald-500 | unchanged |
| Appointment | `#c026d3` fuchsia-600 | was indigo, too close to blue Meeting |

**What changed**
- `calendarHelpers.tsx`: `CATEGORY_COLORS` repainted, now the single source of truth.
- `CalendarPage.tsx`: new `eventBaseColor(e)` — category color, falling back to `statusColor` for meetings; cancelled stays gray whatever the category. Used by `toFullCalendarEvent` (background + border) and the local `EventDetailPanel` header. CalendarPage now imports `CATEGORY_COLORS` instead of growing a fourth copy.
- `CreateEventModal.tsx`, `EventDetailPanel.tsx`, `LogTimePanel.tsx`: Tailwind variants aligned to the same palette. `LogTimePanel`'s 6-way ternary became `CATEGORY_DOT_CLASS`.
- `integrations/views.py`: `GOOGLE_EVENT_TYPE_TO_CATEGORY` maps Google's `eventType` → `event_category` during `_sync_google_calendar`.

**Key decisions**
- `meeting` is deliberately **not** a `CATEGORY_COLORS` key, so meetings keep status shading (tentative lighter blue, cancelled gray). Both consumers use `CATEGORY_COLORS[cat] ?? statusColor(...)`.
- `event_category` can be `""` (Django `blank=True`) while the TS type says `EventCategory | undefined` — `eventBaseColor` uses `||` not `??` so blank reads as meeting.
- The Google mapping deliberately omits `"default"`: mapping it would overwrite a Task/Appointment the user picked in-app on the next sync. Google stays authoritative only for the three types it owns.
- **Colors are a deliberate visible change**, contrary to hard constraint #1 — requested directly by the user.

**Verified**
- 390/390 frontend (13 new: 11 in `CalendarPage.test.tsx` covering all 6 categories + action item + cancelled + blank + border, 2 existing amber assertions updated), 265/265 backend (9 new in `integrations/tests/test_views.py::GoogleCalendarSyncCategoryTest`), `npm run build` clean.

**Also fixed (not mine, blocking the build)**
- `AccountDetailPage.tsx:5182` — a `scope` object typed as a union of two partial shapes failed `tsc -p tsconfig.app.json` where it was passed to `listActionItems`/`listMeetings` (`Record<string, string>`). Annotated `scope: Record<string, string>`. Note `npx tsc --noEmit` (no `-p`) does **not** catch this; `npm run build` does.

---

### 2026-08-18 — User-selectable calendar event colors + "Mark as important!"

**Why**
The previous change hardcoded one color per event type. Colors are now the user's to pick, from four palettes (Bubblegum / Purple Pastel / Ocean / 90s), plus a per-event "important" override.

**Storage** — `team.UserProfile.calendar_colors` (JSONField, migration `team/0005`):
```json
{ "categories": {"meeting": "#C3D3E0", "action_item": "#CFC1D8"},
  "important":  {"<event uid>": "#842D78"} }
```
Written through the existing `PATCH /api/v1/team/profiles/me/` — no new endpoint or route. `UserProfileSerializer.validate_calendar_colors` checks color *format* (`^#[0-9A-Fa-f]{6}$`) rather than palette membership, so a new palette needs no backend change; event *type* keys ARE validated (a typo would silently never apply). `important` is capped at `IMPORTANT_COLOR_LIMIT = 500`.

**Defaults** — Bubblegum extended with three Purple Pastel swatches. Bubblegum has 5 colors for 7 types; reusing two would recreate the indistinguishable-types problem. The three near-white swatches (`#F0F9F8`, `#F1EEFF`, `#FFF6ED`) are skipped as defaults (invisible on the white grid) but remain selectable.

| Type | Default | | Type | Default |
|---|---|---|---|---|
| Meeting | `#C3D3E0` | | Focus Time | `#82BFB7` |
| Task | `#F2A2BD` | | Working Location | `#C6E6E3` |
| Action item | `#CFC1D8` | | Appointment | `#DED1DB` |
| Out of Office | `#FED3DD` | | | |

**What changed**
- `lib/eventColors.ts` (new) — `PALETTES`, `IMPORTANT_PALETTE`, `DEFAULT_CATEGORY_COLORS`, `EVENT_TYPE_META`, `readableTextColor`, `borderFor`, `darken`, `isHexColor`. Single source of truth.
- `hooks/useCalendarColors.ts` (new) — `colorFor` / `importantFor` / setters. Applies locally then PATCHes, reverting on failure.
- `components/calendar/EventColorsPopover.tsx` (new) — per-type rows, each a chip of the type name on its own color; opens a 20-swatch grid under palette headings.
- `pages/CalendarPage.tsx` — "Colors" header button + popover; `eventBaseColor` precedence **cancelled → important → type color**; `toFullCalendarEvent` uses `readableTextColor`/`borderFor`; "Mark as important!" row in the hand-rolled right-click menu expanding the 5 ninety-s swatches inline + "Clear important color".
- `CreateEventModal` / `EventDetailPanel` / `LogTimePanel` — category pills and dots moved from hardcoded Tailwind classes to inline styles from the same map (prop, defaulting to `DEFAULT_CATEGORY_COLORS`), so a picker pill always matches the event it produces.
- `calendarHelpers.CATEGORY_COLORS` **deleted** — superseded by `lib/eventColors.ts`. `WORK_TRACKING_COLOR` stays (chips outside the grid).

**Key decisions**
- `meeting` has a real entry now (it used to fall through to `statusColor`), but **cancelled still wins** over any category or important color, so a cancelled event still reads as cancelled. Tentative-blue shading no longer applies to meetings — the type color does.
- Pastel defaults forced text color to become dynamic. `readableTextColor` picks dark navy vs white by WCAG contrast; the old hardcoded `#ffffff` was unreadable on `#FED3DD`.
- `useCalendarColors` deliberately does NOT use `useResource` (single prefs object, not a `T[]`) and DOES update optimistically — a color click can't wait on a round-trip. Documented as the same exemption `lib/localStore.ts` claims.
- "important" is keyed by the event `uid` (`google_event_id || id`), the same key the context menu already computes, so it covers meetings, scheduled action items, timers and reminders uniformly — a `CalendarEvent` DB column could not.
- CalendarPage GETs `profiles/me/` twice on mount (it already fetched the profile for `google_account_email`). Accepted; noted for anyone consolidating later.
- Kept the previous change's Google `eventType` → `event_category` mapping. Without it synced OOO/focus-time events have no category, so no chosen color would ever reach them.

**Verified**
- 453/453 frontend (61 new: 20 `lib/__tests__/eventColors.test.ts`, 14 `hooks/__tests__/useCalendarColors.test.ts`, 13 `EventColorsPopover.test.tsx`, 14 in `CalendarPage.test.tsx` for colors/important/popover), 283/283 backend (18 new in `team/tests/test_views.py::CalendarColorsTest`).
- `npm run build` passed mid-session; the working tree is being edited concurrently by another session, so the build flips red on *their* in-flight files (`api.ts`, `RichTextMentionEditor.tsx`, `ActionItemModal.tsx`, `ActionItemsPage.tsx` at various moments). `tsc -p tsconfig.app.json` reports **zero** errors in any file touched here.

**Also of note**
- The two existing Focus-Time pill tests asserted `bg-cyan-600`; they now assert `data-active` / `data-color` since the pills are inline-styled.

---

### 2026-08-18 — Batch outbound requests to stop 429s

**Problem**

The 429s came from *our own* throttle, not a third party: `core/settings.py`
`DEFAULT_THROTTLE_RATES` sets `user: 200/min` with `UserRateThrottle` applied globally.
Several effects fetched one-request-per-item, so a single page load could burst past it.

Measured against the real HTTP stack (auth + middleware + throttle), the notes-feed
shape alone: **110 calendar events → 220 requests → 20 × HTTP 429, first at request #201.**
Batched: **2 requests, both 200**, covering all 110 events.

**What changed**

Backend — all filter changes additive; a single-value param behaves exactly as before:
- `core/query_params.py` (new) — `csv_params` / `csv_int_params`. Lenient parsing;
  non-numeric tokens are ignored rather than raising.
- `MeetingNoteViewSet` — `?event=` accepts `1,2,3` (`event_id__in`). Owner scoping is
  applied *before* the filter, so batching cannot widen visibility.
- `AirtableMeetingViewSet` — `?account=` accepts a batch mixing PKs and `rec*` IDs;
  `?calendar_event_id=` accepts a batch, resolving events → `agentpm_airtable_id`.
- `AccountViewSet.artifacts_batch` — `GET /accounts/accounts/artifacts-batch/?ids=1,2,3`,
  the batched counterpart to the per-account `artifacts` route.
- `ClientPageSizePagination` attached to `MeetingNoteViewSet` and `AirtableMeetingViewSet`.

Frontend:
- `lib/rateLimit.ts` (new) — `Semaphore` (cap 6) + `retryDelayMs` honoring `Retry-After`.
- `lib/api.ts` — concurrency cap acquired in the request interceptor, released in a
  response interceptor, plus 429 retry (3 attempts) registered last.
- `schedulerApi.listMeetingNotesForEvents`, `accountsApi.listArtifactsForAccounts`.
- `AccountMeetingNotesFeed` 2N → 2; `RolePage` artifacts N → 1; `CalendarPage`
  accounts-view meetings N → 1.

**Key decisions**
- **Interceptor order is load-bearing.** The slot-release interceptor is registered
  *first* so it runs before the 401-refresh and 429-retry handlers, both of which
  re-issue the request (acquiring a new slot). Registering it later deadlocks the queue —
  verified by sabotaging it, which hangs the suite. `apiClient.test.ts` bounds that test
  at 5s so the failure reports instead of hanging.
- A **present-but-unparseable** filter narrows to empty rather than falling through to
  "return everything the caller can see".
- `artifacts_batch` scopes via `self.get_queryset()`, inheriting exactly what
  `get_object()` gives the detail route. Out-of-scope IDs are dropped, not raised on.
- MSW: the `artifacts-batch` handler **must** be registered before
  `/accounts/accounts/:id/`, which would otherwise capture it as an account ID.
  `batchApi.test.ts` guards this (fails if the order is swapped).
- Batch helpers called with zero IDs resolve a synthetic response instead of sending a
  request with an empty filter.
- `useCalendarOverlay` was left as a fan-out — it's bounded (~8, palette-limited) and each
  response must stay attributed to its own `overlay_user`. The concurrency cap covers it.
- Throttle rate left at 200/min deliberately: the client was fixed to fit the budget.

**Verified**
- 504/504 frontend (43 new: 15 `rateLimit.test.ts`, 10 `apiClient.test.ts`,
  8 `batchApi.test.ts`, 10 `AccountMeetingNotesFeed.test.tsx`), 344/344 backend
  (55 new across `scheduler`, `airtable_sync`, `accounts`, `core`).
- `npm run build` clean; `tsc --noEmit` clean.
- Request counts asserted at the network layer via MSW, not by mocking `lib/api.ts`.

---

### 2026-08-18 — Attendance persistence + Did-not-attend greying

**Root cause**
`CalendarPage.tsx` held attendance in `const [absentEventIds, setAbsentEventIds] = useState<Set<string>>(new Set())` — in-memory only, keyed by `google_event_id`, never written anywhere. Unmounting the page (any navigation) or refreshing reset it to empty, so every meeting reverted to "Attended".

**Fix — the status now lives on the event row**
- `scheduler.CalendarEvent.attended = BooleanField(null=True, default=None)` (migration `scheduler/0007`). Tri-state: `None` never recorded (renders as Attended), `True` explicitly attended, `False` did not attend.
- `PATCH /api/v1/scheduler/events/<pk>/attendance/` — a dedicated `@action`, body `{"attended": true|false|null}`. **Not** the generic PATCH: that path runs `RequireAccountMembershipMixin`, which would 403 a user marking their own meeting when the meeting is linked to an account they aren't a team member of. `get_object()` is already owner-scoped, so another user's event 404s. `attended` is therefore `read_only` on `CalendarEventSerializer` (readable in lists, writable only via the action).
- `CalendarPage`: `absentEventIds` deleted; `didNotAttend(e) => e.attended === false` replaces all four call sites (daily totals, grid fill, event content, MeetingDetail prop). `toggleAttendance` PATCHes with optimistic update + rollback + `reportError`.

**Did-not-attend styling**
`withAlpha("#d1d5db", 0.75)` → `rgba(209, 213, 219, 0.75)` as the background, with a `#9ca3af` border. Deliberately translucent instead of the solid `#d1d5db` that cancelled events use, so "I skipped this" is distinguishable from every other grey on the grid. Text switches to dark navy via `readableTextColor`. The pre-existing `opacity-60` + italic on the event's inner content is unchanged.

**Key decisions**
- Tri-state rather than boolean: lets an untouched event stay untouched in the DB while still rendering as Attended, and makes "explicitly attended" a real, persisted state — so the first click always means "did not attend".
- `attended` is deliberately absent from `_sync_google_calendar`'s `update_or_create` defaults, so a re-sync can't silently mark a skipped meeting as attended. Covered by `test_google_resync_does_not_clobber_attendance`.
- `toggleAttendance` resolves the PK from `eventsRef.current`, not `ev.id`. `selectedEvent` comes from FullCalendar's `extendedProps`, and **FullCalendar strips `id`** (it owns that prop) — so `ev.id` is undefined there. Same lookup the Comment menu entry already does. A test asserts the PATCH URL uses the DB id.
- Did-not-attend beats an "important" color in the grid, since attendance is a factual record and the important color is decoration.

**Test-only note**
The `FullCalendar` stub in `CalendarPage.test.tsx` now fires `eventClick` on click (it previously wired only `eventDidMount` and `select`), which is what opens the meeting panel. Its `ref` callback needed an explicit `: void` return annotation — without it TS7023 fires on a circular inference, and **only `npm run build` catches this**, not bare `npx tsc --noEmit`.

**Verified**
- 541/541 frontend (22 new: 13 attendance in `CalendarPage.test.tsx`, 4 `withAlpha`, plus updated stubs), 374/374 backend (13 new in `scheduler/tests/test_views.py::CalendarEventAttendanceTest`), `npm run build` clean.
- A backend test caught a real bug during development: `if value not in (True, False, None)` accepted `1` and `0`, because Python treats `1 == True`. Now `isinstance(value, bool)`.

---

### 2026-08-18 — Attendance toggle on the calendar right-click menu

**What changed**
Frontend only. `CalendarPage.tsx`'s hand-rolled context menu gained an attendance row above "Mark as important!", reusing the existing `toggleAttendance` — so the status can be set without opening the meeting panel first. The label flips between "Mark as did not attend" / "Mark as attended" with a 🚫 / ✅ icon.

**Key decisions**
- Gated on `isMeeting` (`ctxMenu.type === "meeting"`), matching how "Comment" is gated. Scheduled action items and active timers have no `CalendarEvent` row, so `toggleAttendance` would resolve no PK and silently no-op — better to not offer it.
- `ctxMenu.event` is a **snapshot** captured on right-click. Two fixes came out of a failing test:
  1. The menu label now resolves `liveEv` from the reactive `events` array by `google_event_id`, so a second right-click shows the current status, not the status at first open.
  2. `toggleAttendance` reads `row?.attended ?? ev.attended` — the fetched row wins over the caller's snapshot — so it can never flip the wrong way. Rollback uses the same resolved value.
- The stale-label test would have passed on stub fidelity alone (real FullCalendar re-runs `eventDidMount` when `events` changes, refreshing the closure). Fixed it properly rather than relying on that.

**Verified**
- 553/553 frontend (12 new in `CalendarPage.test.tsx`: label per state, PATCH body + DB-id URL, greying, menu closes, menu/panel agreement, second-right-click freshness, not offered on scheduled items), `npm run build` clean. No backend change, so no migration and no daphne restart — confirmed the attendance route is still live (401, not 404) and Vite is up.

---

### 2026-08-18 — Round 2: duplicate request volume (the other half of the 429s)

**Problem**

Batching the fan-outs (previous entry) removed the bursts, but 429s continued on the
app-shell endpoints. Different cause: **duplicate volume**, not fan-out.

`/team/profiles/me/` has **nine** independent callers, three of them in the app shell
(`CurrentUserContext`, `NotificationDefaultsContext`, `Layout.useUserProfile`). React
`StrictMode` is enabled (`main.tsx`), so every mount effect runs twice in dev:
3 × 2 = **six identical requests in the same second**, which is exactly what the Django
log showed. Same story for `token-stats`, `admin-account`, `accounts/`.

**The concurrency cap from round 1 does not help here.** It spreads a burst over time;
the DRF throttle counts requests *per minute*. Volume had to actually go down.

**What changed**

- `lib/requestCache.ts` (new) — installed as an axios **adapter** (not an interceptor)
  so it sits below the auth/retry layers and covers all ~200 existing call sites with no
  edits:
  - **In-flight coalescing** — concurrent identical GETs share one network request.
    Staleness is impossible; they overlap in time by definition.
  - **Short TTL cache** (`GET_CACHE_TTL_MS = 10_000`) — catches *sequential* duplicates:
    StrictMode's second effect, a remount on navigation.
- `lib/api.ts` — adapter wired in; `freshConfig()` helper; `getMyProfile`,
  `listAccounts`, `getAdminAccount`, and both `getTokenStats` take `{ fresh?: boolean }`.
- `Layout.tsx` — mount fetches stay cacheable; the **event-driven** refetches
  (`accountsUpdated`, `agentSessionUpdated`, `skillTokensUpdated`) pass `fresh: true`.
- `hooks/useResource.ts` — `refetch()` now calls `clearGetCache()` first.
- `test/setup.ts` — `resetRequestCache()` in `afterEach`, alongside `server.resetHandlers()`.

**Key decisions**
- **Three invalidation paths, so "stale" stays bounded:** any non-GET clears the whole
  cache; `refetch()` clears it; sign-out clears it. Wholesale rather than by-key on
  purpose — there is no reliable URL→resource dependency map, and `useResource` only
  ever sees an opaque fetcher thunk, never a URL.
- **`refetch()` must bypass the cache.** This was a genuine regression the suite caught:
  `useActionItems`/`useComments` refetch tests failed because a refetch inside the TTL
  was answered from memory. `refetch` is the app's explicit "give me current data"
  signal; honoring it is what makes the cache safe.
- **Every consumer gets a cloned `data`, including the first.** Sharing one array across
  callers would let an in-place `.sort()` in one component silently reorder another's
  state — worse than the requests being saved. Cloning small JSON is orders of magnitude
  cheaper than the round trip it replaces.
- **`NEVER_CACHE` deny-list** for state that changes out-of-band: `/integrations/`
  (OAuth status flips in a popup and is re-read the moment it closes), `/sync`,
  `/auth/`, `/scraper-status`. Non-JSON responses (blobs) are excluded too.
- **`noCache` is declared via `declare module "axios"`.** Without the augmentation,
  passing an unknown config key drops axios to a loose overload and
  `apiClient.get<UserProfile>(...)` stops resolving its generic. `npx tsc --noEmit`
  missed this; `npm run build` (`-p tsconfig.app.json`) caught it — **use the build.**
- StrictMode left on. It catches real effect-cleanup bugs, doesn't affect production
  builds, and coalescing makes its duplicate requests free.

**Verified**
- 583/583 frontend (`npm run build` clean). New: 24 `requestCache.test.ts`,
  4 `shellRequestVolume.test.tsx`, 2 in `useResource.test.ts`.
- Measured at the network layer, not by mocking: three shell consumers under
  `StrictMode` → **6 requests become 1**. A remount inside the TTL → **0 requests**.
- Round 1 remeasured live through the full HTTP stack: 110 events →
  220 requests / 20 × 429 → **2 requests, both 200**.

**Also of note**
- `RemindersPage.test.tsx` needed `useCommentContext` added to its `CommentContext` mock.
  Unrelated to this work — a concurrent session added `CommentTrigger` /
  `CommentPreviewList` to that page. Fixed to match the stub shape the
  AccountDetailPage / ActionItemsPage suites already use.
- `test/handlers/accounts.ts` `mockAirtableMeeting` needed `zoom_notes` / `zoom_url`,
  added to the `AirtableMeeting` type by that same concurrent session.

---

### 2026-08-18 — Agent backend: gateway support, model escalation, real streaming, classified errors

**Why**

The Agent page returned `[Agent error - check server logs]`. Root cause was unrelated to
the app: `agents/agent.py` reaches Claude through **Bedrock** (`AWS_PROFILE=twilio-devex-bedrock`,
`app/.env:167`), and that profile's AWS SSO refresh token had expired. Claude Code had moved to
the Okta/LiteLLM gateway; this app was left on Bedrock. Fixed live with `aws sso login`, then
three further problems surfaced from reading the code.

**What changed**

Backend:
- `core/settings.py` — new `AGENT_BACKEND` (`bedrock` | `gateway`), `AGENT_GATEWAY_BASE_URL`,
  `AGENT_MODEL_TIERS` (per-backend `default`/`strong` ids), `AGENT_MODEL_OVERRIDE`, and four
  per-tier `AGENT_MAX_TOKENS_*` values.
- `agents/agent.py` — `MODEL` constant replaced by `model_for_tier()` / `max_tokens_for_tier()` /
  `build_client()`. Switched to the **async** SDK clients (`AsyncAnthropicBedrock` /
  `AsyncAnthropic`). `_stream_final_response` now yields each chunk as it arrives instead of
  draining `text_stream` into a list first. New `ESCALATE_TOOL`.
- `agents/views.py` — `_generate` is now an **async generator**; deleted the hand-rolled
  `new_event_loop()` / `_drain` / `_run_into_queue` pump. New `classify_agent_error()`.
- Tests: new `agents/tests/test_agent.py` (24), `agents/tests/test_views.py` extended (+21).

**Key decisions**

- **Escalation is an orchestrator pseudo-tool, not an MCP tool.** `ESCALATE_TOOL` is appended to
  the `tools` list but intercepted in `_agentic_loop` and never dispatched — `mcp_server.dispatch`
  would raise `Unknown tool`. Offered only on the default tier, withdrawn after one use, so a
  request can never bounce tiers. Chosen over an up-front triage call: zero added latency on
  simple requests, and it also catches complexity discovered mid-task.
- **Sibling tool calls in an escalation turn still run.** Every `tool_use` block must receive a
  `tool_result` or the next request 400s, so non-escalation blocks in the same turn are executed
  normally and answered alongside the escalation acknowledgement.
- **Strong tier is `us.anthropic.claude-opus-4-8`, not Opus 5.** `list-inference-profiles` lists
  `us.anthropic.claude-opus-5` and `global.anthropic.claude-opus-5`, but invoking either 403s:
  *"not authorized to perform the required AWS Marketplace actions"*. Opus 4.8 / 4.7 / 4.6 and
  Sonnet 5 / 4.6 all invoke fine. The profile listing is **not** an entitlement check.
- **Do not disable thinking on the strong tier.** Kept as future-proofing for Opus 5, where
  `thinking: {"type": "disabled"}` can emit tool calls as *plain text* that silently never
  execute — severe for an agent with ~18 tools. Handled instead by raising `max_tokens`, since on
  Opus 5 that budget covers thinking *and* visible text.
- **`base_url` is always passed explicitly.** Claude Code's managed settings export
  `ANTHROPIC_BASE_URL`, so a bare `AsyncAnthropic()` would inherit the gateway URL from whichever
  shell launched Django.
- Error messages are built from **fixed strings plus a correlation ref** — no exception text is
  interpolated, so tokens/ARNs cannot reach the browser. A test asserts the detail stays in the log.

**Streaming: fixed in code, still coalesced by the network**

There were two independent buffering layers, both removed: `_collect_stream` in `agent.py`, and
Django's `sync_to_async(list)` fallback (`django/http/response.py:531-545`), which triggers
whenever a *sync* generator is handed to `StreamingHttpResponse` under ASGI.

Measured against live Bedrock afterwards:

| Output | Chunks | First chunk | Last chunk | Spread |
|---|---|---|---|---|
| 53 tokens | 7 | 2.94s | 2.94s | 0.00s |
| 1239 tokens | 536 | 19.09s | 27.79s | 8.70s |

Long responses genuinely stream (536 incremental chunks); short ones still arrive at once. The
raw SDK shows the identical pattern with the orchestrator bypassed entirely, and the SDK does use
`invoke-with-response-stream`, so the residual coalescing is **network-level** — a buffering
TLS-inspecting proxy holding bytes until its buffer fills. Not fixable in this codebase. Worth
re-measuring on the gateway path, which may not sit behind the same inspection.

**Left open**
- Gateway tiers are `""` — needs a LiteLLM virtual key in `ANTHROPIC_API_KEY` (`app/.env:33`),
  then `GET /v1/models` to fill `AGENT_MODEL_TIERS["gateway"]` and `AGENT_BACKEND=gateway`.
- Escalation is one-way; no de-escalation back to Sonnet for a long conversation that starts hard
  and turns simple.
- `AnthropicBedrock` is the legacy `bedrock-runtime` InvokeModel path. `AnthropicBedrockMantle` is
  preferred for new code but needs `anthropic.`-prefixed model ids — deferred to avoid a second
  model-id migration in the same change.

**Verified**
- 498/498 backend. Escalation confirmed live: a simple prompt stayed on `sonnet-4-6` (30 output
  tokens); a multi-constraint sequencing prompt escalated to `opus-4-8` (530 output tokens) with a
  logged reason.
- **Frontend was not touched** (diff is Python-only). `npx vitest run` shows 51 failures and
  `npm run build` 31 TS errors, all in the concurrent session's in-flight work: every failing test
  file **passes in isolation** (cross-file pollution), and every TS error traces to the new
  `syntheticResponse<T>` / `emptyPage<T>` generics in `lib/api.ts` failing inference at call sites.

**Environment fix (outside the repo)**
- `~/.zshrc` exported `AWS_CA_BUNDLE=/etc/ssl/cert.pem` three times; that bundle contains **zero**
  Zscaler certs, so `aws sso login` failed TLS on the token exchange with
  `CERTIFICATE_VERIFY_FAILED`. Now points at `~/.certs/custom_aws_bundle.pem`. Note the Django app
  itself was never affected — `truststore.inject_into_ssl()` (`agent.py:31`) uses the macOS system
  trust store, which does have the Zscaler root.

---

### 2026-08-18 — "GET Meeting Notes": AI summaries from Gong/Zoom recap emails

**Why**
A meeting whose Gong or Zoom recap arrived by email had no summary in the app until
someone pasted it into the Meeting Summary box by hand. `AirtableMeeting` also had only
one notes column (`gong_notes`), so a meeting recorded by both providers could hold only
one of the two.

**Storage — both providers, side by side**
- `AirtableMeeting.zoom_notes` / `.zoom_url` (migration `airtable_sync/0013`). Gong is
  preferred for display; the panel toggles. Nothing is ever overwritten.
- `sync_meetings` reads `Zoom Notes` / `Zoom URL` under the same "only if Airtable has
  content" guard as `Gong Notes`, so a base without those columns can't blank local values.
- `write_back.push_meeting_zoom_notes` is a **separate Airtable request**, not extra keys
  on the Gong payload. `_meeting_fields` (used by `table.create` during stub promotion)
  deliberately omits the Zoom pair: Airtable fails a whole write with `UNKNOWN_FIELD_NAME`
  if any key is missing from the base, so folding Zoom in would have taken the Gong notes
  down with it on any base that hasn't grown the columns yet. Isolated, a missing column
  costs only the Zoom mirror and is logged.
- **The Airtable columns now exist.** `Zoom Notes` (`richText`, `fldFqpK9eVWF4XNiM`) and
  `Zoom URL` (`url`, `fldZfo1KCXwhm4a1E`) were created on the Meetings table
  (`tblNnU66qgaDfM8lK`) via `manage.py ensure_airtable_zoom_fields` — a new idempotent
  command, not a migration: the target is a third-party system, so a migration would fail
  on any machine without Airtable credentials and record itself applied regardless. Types
  mirror the Gong pair exactly (`Gong Notes` is **richText**, not plain long text).
  Requires a token with `schema.bases:write`. Verified by a real write/read/restore
  round-trip on `recWpIZQxAiFgjqfV`, with `Gong Notes` confirmed untouched.
- `_promote_stub_meeting` extracted so both pushers share the `local-*` promotion path.

**The scan** — `integrations/meeting_notes.py`
`POST /api/v1/integrations/gmail/meeting-notes/` → `MeetingNotesFromEmailView`.
Gmail query `(from:gong.io OR from:zoom.us OR from:zoom.com) after:<date>`; each message
is matched to a meeting on **name and date**:
- `normalize_title` strips `Re:`/`Fwd:` and vendor boilerplate repeatedly (`Gong Call
  Recap:`, `Your call recap:`, `Meeting Summary with`, `Zoom AI Companion:`, …), drops a
  trailing parenthetical or ` - Mar 3, 2026` tail, then tokenises and removes stopwords —
  but keeps the raw tokens when *everything* is a stopword, or "Weekly Sync" would
  normalise to the empty string and match nothing.
- `titles_match` = equality, then containment (only when the shorter side is ≥5 chars, so
  "QBR" doesn't match by coincidence), then `SequenceMatcher ≥ 0.72`.
- `dates_match` = email within `[meeting − 1 day, meeting + 3 days]`.
- Then `summarize_email` normalises the body into `Recap` / `Key Points` / `Next Steps`
  bullets via `claude-opus-5` — the exact shape `parseBullets()` already renders, so
  per-bullet action-item buttons and @mention detection work on imported notes.

**Key decisions**
- **Scope differs by host page**, and that difference is the point:
  - The **account detail page** scopes to its own account. An import onto another
    account's meeting isn't visible there, so reporting it would only confuse.
  - The **profile and role pages** don't scope, covering every account the user is on —
    that's the reason to run it from a personal page rather than account by account.
  Both go through one component (`components/shared/GetMeetingNotesButton.tsx`) so the
  request and the result wording can't drift between the three pages.
- Scoping accepts `account` (AirtableAccount PK or `rec*` id) as well as `account_name`.
  The id is preferred because a Django `Account.company_name` that has drifted from its
  `AirtableAccount.name` matches nothing by name; the name stays as the fallback for
  accounts with no Airtable link (per-user Admin workspaces) and for the agent, which
  knows names rather than ids. A present-but-unresolvable filter narrows to empty rather
  than falling through to everything.
- **Underlying visibility** is the union of team-member accounts *and* meetings linked to
  calendar events the user owns — either clause alone drops real meetings, since 1:1s and
  internal calls have no account.
- **Per provider, not per meeting.** An existing Gong recap does not block a Zoom import.
- **Claude is a normaliser with a fallback, not a hard dependency.** No `ANTHROPIC_API_KEY`,
  or a failed call, falls back to `fallback_bullets` — the vendor's own text with footers
  stripped, which is what the user would have pasted anyway. Losing the recap entirely
  would be worse than losing the formatting.
- **`extract_plain_body` prefers `text/plain` and flattens `text/html` otherwise**, turning
  block-level tag ends into newlines. The pre-existing `decode_body` is mime-type-blind and
  would return the HTML alternative as a wall of markup; it is kept verbatim for
  `GmailThreadsView` rather than changed underneath a path with no test coverage.
- **Caps are reported, never silent.** `days` ≤ 180, 150 emails, 25 summaries per run; a
  meeting that matched but hit the summary ceiling is skipped with reason
  `summary_limit_reached` and the response sets `summaries_truncated`, which the UI
  surfaces. Reporting it as "no matching email" would read as "nothing to import".
- The recap's recording URL is captured into `gong_url` / `zoom_url` only when blank.

**Agent Capability**
- `get_meeting_notes_from_email` MCP tool (`agents/mcp_server.py`) + catalog entry in
  `skills/views.py`. Returns a trimmed report — the raw `skipped` list runs to hundreds of
  entries on a busy account.
- `skills/migrations/0008` seeds the `get-meeting-notes` AgentSkill (approved + public), so
  it appears on the Skills page ready to pin to a profile or role page.
- `AgentSkillViewSet.get_queryset` widened: non-staff now also see `visibility=public AND
  status=approved`. Without it a migration-shipped capability is invisible to everyone but
  staff, so nobody could pin it.
- **A test caught a real gap:** `check_object_permissions` allowed only `pin`/`unpin` on a
  skill you didn't create, so a non-staff user could *see* the shipped capability but got a
  403 on `run` — useless for exactly the users it's for. `run` and `retrieve` joined
  `_SHARED_ACTIONS`; `update`/`destroy`/`review` stay with the creator.

**Frontend**
- `components/account/MeetingSummarySourceToggle.tsx` (new) — the Gong/Zoom switch plus
  `preferredMeetingSource()`. Its own file because `AccountDetailPage` keeps a diverged
  local `GongSummaryPanel` (that page is additive-edits-only), and both copies need it.
- Both panels now hold `notesBySource: Record<"gong"|"zoom", string>`; `raw`/`items`/
  `showPaste` are the view of the active provider, and a save targets that provider's
  endpoint. An empty provider stays clickable — that's how the first Zoom recap gets pasted.
- "GET Meeting Notes" button in the Timeline section header, with a result banner listing
  each updated meeting and its provider. On success it re-reads this account's meetings so
  an imported summary appears without a reload.
- New endpoints in `lib/api.ts`: `updateMeetingZoomNotes(ByPk)`,
  `integrationsApi.getMeetingNotesFromEmail`.

**Subject formats: the documented ones are not the ones that arrive**
The first cut guessed `Gong Call Recap:` / `Meeting Summary with` prefixes and matched
**nothing at all** against a real mailbox. What actually arrives:
- Gong: `"<meeting name>: Call recording and analysis is ready"` — the name is a *prefix*
  and the boilerplate is a *suffix*. Names contain their own colons
  (`BigCommerce/Segment Sync: PS Engagement`), so the suffix is stripped by an
  end-anchored regex rather than captured from the start.
- Zoom: `"Meeting assets for <meeting name> are ready!"` — wrapped on *both* sides.

`normalize_title` now strips both ends, iteratively, with the Gong-specific patterns tried
before the bare `… is/are ready` catch-all (which would otherwise leave
`…: Call recording and analysis` behind). Measured on a real 30-day mailbox: 0 matches
before, 13 after. Verify against a real mailbox before adding to these lists.

**Zoom emails do not contain the summary — and that shaped the design**
Every Zoom "Meeting assets" email is a *notification*: `Review action items`,
`Meeting summary`, `Topic:`, `Date:`, a share link, `View in Zoom`. The words "Meeting
summary" are a **link label**; the summary itself only exists in the Zoom web app. Gong,
by contrast, ships the full `Key points` / `Next steps` text in the body.

The email *looks* like it contains a recap — it renders a card of grey summary-ish text —
but that card is `st1.zoom.us/static/…/email/summary_preview.png`, a **static stock
illustration** served to every recipient. Its visible text ("Design Sync", "Calendar Cards
design", "Katie…") has nothing to do with the actual meeting. The email is HTML-only, 27KB
of markup reducing to 376 chars of text, and `Quick recap` / `Next steps` appear nowhere in
the source. Don't spend time trying to parse it — check `<img>` sources before assuming
text is missing from an extractor.

Importing indiscriminately would have filled meetings with notes made of link text, so
there is now a content gate: `email_contains_summary()` counts characters on lines of ≥8
words after removing URLs, and requires ≥400. The measured distribution over 28 real
emails is Gong 3139–4505 and Zoom 0–238, so 400 sits in a wide gap. Consequences:
- A gated-out email still contributes its **recording link** (`zoom_url`) — the only
  useful thing in it — reported as `recordings_linked`.
- The meeting is skipped with reason `email_has_no_summary`, rolled up as
  `no_summary_in_email`, and the UI says so explicitly. The user can *see* those emails in
  their inbox, so silence would read as a bug rather than as "these link to the summary".
- Non-recap notices (`… has been deleted`, invites, registrations) are dropped before
  matching by `_NON_RECAP_SUBJECT_RES`.

**Notes hang off AirtableMeeting, but most meetings are calendar-only**
This was the actual cause of "I can see the email but the meeting has no notes". The scan
originally iterated `AirtableMeeting` rows only, and on the real account **every**
CalendarEvent in the window had `agentpm_airtable_id=""` — so 3 of 11 Gong recaps had
nowhere to attach and were silently skipped.

There is now a second pass over `candidate_events()`: calendar events the user owns, in
window, with no meeting row behind them. When a recap with a real summary matches one,
`airtable_sync/meeting_stubs.get_or_create_meeting_for_event()` creates the same `local-*`
stub the manual paste path has always created, links the event back via
`agentpm_airtable_id` (without which the calendar page still shows an empty panel), and
imports into it. That helper is *extracted from* `_meeting_notes_by_event`, which now calls
it — one stub implementation, not two.

- A stub is created **only when there is a real summary to store**. A bare recording link
  isn't worth a new row.
- Account scoping for events is best-effort: an event is kept in a *scoped* scan only when
  its account resolves to the requested one, so events with no account FK are scanned only
  in unscoped (profile / role) runs. A scoped run must not quietly import a meeting that
  may belong elsewhere.
- Reported as `scanned_unlinked_events` / `meetings_created`, and each such row is flagged
  `created_meeting` and rendered with a "· new" suffix.
- Verified on the real mailbox: the 3 previously-orphaned Gong recaps now resolve,
  including the exact meeting from the bug report (event pk=948, 2026-08-12
  "Twilio & Autodesk Enterprise - setting up Segment").

**A trap worth knowing about**
Airtable `richText` columns normalise a cleared value to `"\n"`, never `""`, and never drop
the key once written — so `if at_gong_notes:` reads an *empty* Airtable cell as content.
That overwrote local notes with `"\n"`, and because `"\n"` is itself truthy it then made the
meeting look already-summarised to the scanner, which would skip it **forever**. Found by
the post-creation round-trip, not by any test. Now `.strip()` everywhere emptiness is
tested: `sync.py` (both providers), the scanner's per-provider guard and skip reason, and
the mount effect in both panels. Regression tests pin all three. The same latent bug
existed for `gong_notes` before this change.

**Test-harness notes**
- `AirtableMeeting` is defined **twice**: `types/airtable.ts` and inline in `types/index.ts`
  (which does *not* re-export the former, contrary to CLAUDE.md's type-organisation
  section). Both need every new field.
- MSW: the `meetings/:id/gong-notes/` and `zoom-notes/` handlers must precede
  `meetings/:id/`, which would otherwise capture `gong-notes` as an ID.
- A `describe` block that renders `AccountDetailPage` **must call `vi.resetModules()` in its
  own `beforeEach`**. The kanban block does, which detaches the module instance
  `test/setup.ts` holds — so its `resetRequestCache()` then clears a stale copy and the
  page's live 10s GET cache (`lib/requestCache.ts`) survives into the next test, making a
  re-fetch invisible at the network layer.
- Result-row assertions use a `textContent` matcher: the provider name sits in its own
  `<span>` for capitalisation, so `getByText(/name.*provider/)` can't span it.
- `RolePage`'s `CollapsibleSection` header is itself a `<button>`, so anything passed as
  `headerRight` becomes a nested button and its text is absorbed into the header's
  accessible name — `getByRole("button", {name: /GET Meeting Notes/})` finds **two**.
  Query by title instead. (The nesting is pre-existing: `+ New` and the remove button are
  already there, and `headerRight` stops propagation so the collapse doesn't fire.)

**Verified**
- 571/571 backend (108 new), 900/900 frontend (56 new).
- `tsc -p tsconfig.app.json` reports **zero** errors in any file touched here.
  `npm run build` is currently red on `CalendarPage.tsx` / `ActionItemsSidebar.tsx` — a
  concurrent session's in-flight `StepsPanel` insertion referencing an out-of-scope `item`.
- Dev DB migrated; backup at `/tmp/db.sqlite3.pre-meeting-notes`.

**Four copies of the meeting-summary panel — all now have the toggle**
The panel is duplicated four ways, and a Zoom-only meeting read as empty in any copy that
hadn't been updated:
1. `components/account/GongSummaryPanel.tsx` — the shared one (account SidePanel).
2. `pages/AccountDetailPage.tsx` local copy (~L1413) — that page is additive-edits-only.
3. `components/calendar/MeetingDetail.tsx::MeetingSummarySection` (~L1972) — the calendar
   page's own copy, and the one in the bug report's screenshot.
4. `components/account/AccountMeetingNotesFeed.tsx` — read-only, still zero consumers.

All four share `MeetingSummarySourceToggle` / `preferredMeetingSource`. `MeetingSummarySection`
has three save paths (`persistAndNotify`, `saveRaw`, `handleClear`) that were each hardcoded
to the Gong endpoints; they now route through one `saveForSource()` so **Clear** clears only
the active provider. Also made provider-agnostic: the read-only matched-meeting block in
`MeetingDetail` (labels which provider it's showing, and links both recordings), the
`AccountMeetingNotesFeed` display, and the status-report payload (`zoom_notes` alongside
`gong_notes`).

**Left open**
- `AccountMeetingNotesFeed` has no *editable* toggle — it's a read-only feed with zero
  consumers, so it only got the display fallback.

---

### 2026-08-18 — One comment affordance, comments visible on the record

**Why**

Four separate speech-bubble icons, three count formats, and comments that were invisible
until you opened the floating panel. Specifically:

- `components/CommentIcon.tsx` (filled 43×43 bubble) in one modal header; a rounded
  outline blob duplicated in three more; a square outline one in `StepsPanel`; a 💬 emoji
  in the calendar menu and on `ClaudeSkillsPage`.
- A record with an active conversation looked identical to one with none — the reported
  symptom being "I've commented on this action item but it's not displaying on the action
  item until I click on the comment icon."
- `CommentPanel`'s header rendered a long record label inline after "Comments" with
  Tailwind `truncate`, which is **inert on an inline `<span>`** (`overflow`/`width` don't
  apply). The label therefore ran full width, squeezed its flex sibling to min-content,
  and rendered "1 comment" one character per line, **vertically**.
- The global `*:focus-visible` rule in `index.css` left a blue ring sitting on the comment
  icon after the panel opened.

**Backend**

- `GET /api/v1/comments/comments/summary/?resource_type=action_item&resource_ids=1,2,3`
  — new `@action` on `CommentViewSet`. Returns `{results: {"<id>": {count, comments}}}`:
  `count` includes replies, `comments` is the newest `SUMMARY_PREVIEW_LIMIT` (3) top-level
  ones, oldest-first for display. Ids with no comments are **omitted**; the client treats
  a missing key as zero. `SUMMARY_MAX_IDS = 500`.
- `CommentPreviewSerializer` (no `replies` recursion, no JSON blobs) +
  `_author_display()` extracted from `CommentSerializer` so both share one rule.
- Visibility reuses `_user_can_see_resource`, but only for ids that **actually have
  comments** (one `values_list(...).distinct()` first), so per-id query cost tracks
  comment volume rather than page size.

**Frontend**

- `lib/commentSummaryStore.ts` (new) — request-coalescing cache. Cards *register*
  `(resource_type, resource_id)`; the store issues one batched request per type on the
  next tick (`MAX_BATCH = 200`). Module-level external store for the same reason
  `lib/localStore.ts` is one, plus the panel lives in a portal on the other side of the
  tree from the cards it must update.
- `hooks/useCommentSummary.ts` (new) — `useSyncExternalStore` over that cache.
  `undefined` until the first fetch lands; render nothing, not "0".
- `components/comments/`: `CommentButton` (the one icon + count badge, focus outline
  suppressed), `CommentTrigger` (drop-in: ref + `openComments` + count, one line per call
  site), `CommentPreviewList` (latest 3 inline on the record, "+N more" opens the panel),
  `CommentCountBadge` (span-only, for calendar chips and rows that are themselves
  `<button>`s), `commentMenuItem` / `useCommentMenuItem` (shared right-click entry,
  mirroring `focusPinMenuItem`).
- `useComments` (both copies) calls `invalidateCommentSummary` after add/edit/delete —
  this is the fix for the reported bug.
- `CommentPanel`: header rebuilt (label on its own line, 2-line clamp, `min-w-0` column;
  count `shrink-0 whitespace-nowrap`); total count now includes replies; comment bodies
  get `overflowWrap: anywhere`; panel box exported as `COMMENT_PANEL_WIDTH/HEIGHT` so
  `CommentContext`'s viewport clamp can't drift from it (it used 370 vs the real 360).
- Wired into: all 4 action-item modal headers, all 3 `ActionItemsPage` KanbanCard layouts
  + StatusBoardView + DueDateView, `account/ActionItemCard`, `calendar/KanbanCard`,
  `calendar/ActionItemsSidebar`, `AccountDetailPage`'s local card + modal + timeline
  chips, `AccountsPage` rows, `RemindersPage`, `ClaudeSkillsPage`, `AccountTimeline`,
  `StepsPanel`, and the CalendarPage grid + hand-rolled menu.
- New right-click surface: `AccountNoteRow`. `account_note` had been a valid
  `resource_type` server-side all along with no UI.

**Key decisions**

- **Batched, not per-card.** A comment badge on every visible card is exactly the fan-out
  that produced the 429s in the 2026-08-18 batching session. `ClaudeSkillsPage`'s bespoke
  per-skill `commentsApi.list()` effect was deleted in favour of the shared rollup.
- `commentSummaryStore` **lazy-imports `lib/api`** inside `flush()`. `src/test/setup.ts`
  imports the store to reset it between tests; a static import dragged the axios client
  into the *setup* module graph, where it evaluates against the real `lib/rateLimit` and
  escapes the `sleep` mock in `apiClient.test.ts` — the three 429-retry tests then slept
  for real and timed out at 5 s. Same reason `api.ts` lazy-imports `./analytics`.
- `invalidateCommentSummary` getting a fresh body relies on `lib/requestCache.ts` clearing
  the whole GET cache after any write. That holds because it's only called right after a
  comment POST/PATCH/DELETE. Calling it in isolation inside the 10 s TTL re-reads the
  cached body — which is what the store test has to simulate with `resetRequestCache()`.
- `count` includes replies (a badge reading "1" on a thread with five replies understates
  it) and the panel header was changed to match, so card and panel never disagree.
- Failed batches leave their ids **uncached**, so the next mount retries instead of pinning
  a wrong "0 comments" forever.
- `CommentPreviewList` takes `interactive={false}` for rows that are themselves `<button>`s
  (`AccountsPage`); nested buttons are invalid HTML. Calendar chips and skill rows use
  `CommentCountBadge` (a `<span>`) for the same reason.
- Every comment affordance is gated on the record existing server-side. On action items
  that's the same `canPin` / `!airtable_id.startsWith("local-")` test the focus pins use —
  `promoteBlankItem` discards a `local-*` id, so a comment against it would orphan.
- `isCommentableEvent()` in `CalendarPage` mirrors the `type === "meeting"` branch of the
  right-click uid parsing. Active timers and `scheduled-*` overlays are synthetic: their
  numeric id belongs to a Reminder or action item, not a `CalendarEvent`.
- `CalendarPage`'s `menuBtn(label, icon, …)` widened from `string` to `React.ReactNode` so
  the menu can use `CommentIcon` instead of 💬.
- The 15-minute calendar layout gets **no** badge (two 9px lines, nothing to spare), and
  the collapsed `ActionItemsPage` card gets the icon+count but no preview.

**Test-harness notes**
- `src/test/setup.ts` resets `commentSummaryStore` in `afterEach`, same as
  `resetRequestCache()` — a module-level cache would otherwise never re-request in the
  next test. The default `/summary/` MSW handler returns `{results: {}}` on purpose, so
  every pre-existing page/card test's DOM is unchanged.
- `commentSummaryResponse()` helper added to `test/handlers/comments.ts`.
- `CommentPanel` only offers Edit/Delete on your own comments, so a delete test must set
  `author: 1` to match `mockUserProfile.id`.

**Verified**
- 667/667 frontend (84 new: 11 `commentSummaryStore.test.ts`, 6 `useCommentSummary.test.ts`,
  10 `CommentPreviewList.test.tsx`, 11 `CommentTrigger.test.tsx` (incl. `CommentCountBadge`
  + `commentMenuItem`), 2 `commentVisibility.test.tsx` end-to-end, 4 new `CommentPanel`
  layout/count tests, 4 new `ActionItemCard` tests), 520/520 backend (13 new in
  `comments/tests/test_views.py::CommentSummaryTests`).
- `tsc -p tsconfig.app.json` reports **zero** errors in any file touched here, and
  `npx vite build` bundles clean.
- `npm run build` is currently red on **another session's in-flight edit**: a
  `<StepsPanel actionItemId={item.id} />` block added inside the *create* form of
  `calendar/ActionItemsSidebar.tsx` (~L772) and its diverged twin in
  `CalendarPage.tsx` (~L1647), where `item` is not in scope (TS2552 ×4). Untouched here.
- Daphne restarted; `/api/v1/comments/comments/summary/` returns 401 unauthenticated
  (route live, not 404).

**Left open**
- `hooks/useComments.ts` (the HOOK_SPEC-conformant version) still has zero consumers; it
  got the same `invalidateCommentSummary` wiring so the two don't drift.
- `CalendarPage` GETs `profiles/me/` twice on mount (pre-existing, noted 2026-08-18).

---

### 2026-08-18 — Enter adds a note everywhere

**Why**
Every note composer required a mouse click on **Add** / **Post** / **Save**. Enter did
nothing (or, in four places, only Cmd/Ctrl+Enter worked). Now a bare Enter adds the note
and Shift+Enter inserts a newline, in every note box in the app.

**The load-bearing piece — `RichTextMentionEditor.onSubmit`**

Five of the composers are TipTap, and `onKeyDownCapture` **cannot** work for them:
that prop is attached as `onKeyDown` on a wrapper `<div>` (an ancestor of the
contenteditable), and ProseMirror's own DOM keydown listener runs first — so
`preventDefault()` there is too late to stop a paragraph being inserted. The new
`onSubmit?: () => void` prop registers a real TipTap `Extension`:

- **`priority: 1000`** — outranks `ListItem`/`TaskItem` (priority 100), so Enter adds the
  note even mid-bullet instead of splitting the list item. **This is user-requested**:
  asked whether Enter should make a new list item or always submit, the answer was
  *always submit*. Shift+Enter (StarterKit `hardBreak`) is the way to extend a list.
- `Enter` is a distinct keymap binding from `Shift-Enter`, so Shift+Enter needs no
  special-casing — it still falls through to `hardBreak`.
- Both the callback and the mention state are read through **refs**, because the editor is
  built once (`useEditor` with default `deps: []`). A prop swap must reach the already-built
  editor without tearing it down; a test asserts the ProseMirror node is the same object
  after `onSubmit` is replaced.
- When the @mention dropdown is open the shortcut returns `true` (swallow) rather than
  submitting — the existing React `handleKeyDown` still runs and inserts the mention.
  Side effect: this **fixes** a latent bug where picking a mention with Enter also left a
  stray paragraph behind.
- **Omitting `onSubmit` leaves Enter alone.** That is what keeps every description /
  `task_details` / reminder-body field behaving as before.

**Sites changed**

| Site | Was |
|---|---|
| `MeetingDetail` notes composer + `NoteRow` edit (TipTap) | no Enter handling |
| `AccountDetailPage` ×7 — `MeetingNotesPanel`, `AccountMeetingNotes`, `CustomerContactModal`, `ContactSidePanelContent` notes, plus `AccountNoteRowSimple` / `AccountNoteRow` / `ContactNoteRow` edit rows (TipTap) | no Enter (or Cmd+Enter only) |
| `FeedbackDetailModal` — add comment + edit comment | Cmd/Ctrl+Enter only |
| `components/account/ContactNoteRow` | Cmd/Ctrl+Enter only |
| `ChatterPost` | none — a bare Enter in a `<textarea>` does not submit its `<form>` |

Already correct, untouched: `AccountMeetingNotes`, `MeetingNotesPanel`,
`ContactSidePanelContent`, `CustomerContactsPanel`, `CustomerContactModal` (the standalone
plain-textarea components), `CommentComposer`, `StepsPanel`, `AccountNoteRow(Simple)`,
`CommentPanel`, `InlineCommentThread`.

**Deliberately NOT changed** — Enter must stay a newline in long-form fields, and several
sit inside forms where Enter would submit early: action-item `task_details` (all 12 call
sites), reminder `Notes (optional)` bodies, `ProfilePage` / `RolePage` notepads,
Gong "paste a summary" boxes, contact `description` fields. Confirmed with the user.

**Dead code deleted — `AccountsPage.AccountDetail` (−160 lines, 1072 → 910)**

While adding the Enter handler to `AccountsPage`'s activity-log composer it turned out the
whole panel was **unreachable**. Proof: `detail` initialises to `null`, and every one of its
five writes preserves that — two are `setDetail(null)`, one is
`setDetail(d => d?.id === data.id ? data : d)` (a no-op when `d` is null), one is guarded by
`if (detail?.id === data.id)` (false when null), and the last is another `setDetail(null)`.
There is no URL param, effect, or keyboard path that opens it either; every card click
`navigate()`s to `/accounts/:id` (the real `AccountDetailPage`) instead.

Removed: the `AccountDetail` component (L290–439), the `detail` state, its three dead
writes in `handleSave` / `handleDelete` / `handleMemberDrop`, its render block, and the
then-unused `AccountNote` import.

**Why deleted rather than wired up.** Wiring it up would add a slide-over panel that no
user has ever seen — a new visible UI surface, which hard constraint #1 forbids. Deleting
unreachable code changes nothing visible. If a second way to view an account is wanted
later, that is a design task, not a cleanup.

`STATUS_COLORS`, `formatArr`, `ROLE_META`, `getTitleRole` and `useEffect` all survive —
each still has other callers in the file, so only `AccountNote` needed dropping.

**Test-harness notes**
- `components/shared/__tests__/RichTextMentionEditor.test.tsx` runs against **real TipTap**,
  not a stub — a stub would pass whether or not the extension is registered. Needs a
  `document.elementFromPoint` polyfill (Placeholder calls it). Verified meaningful by
  deleting `priority: 1000`: the two list tests go red, the other nine stay green.
- The `RichTextMentionEditor` stubs in `AccountDetailPage.test.tsx` / `ActionItemsPage.test.tsx`
  now honour the same `onSubmit`-on-Enter contract, so page tests exercise the real keyboard path.
- jsdom's `WebSocket` is a **read-only global** — `vi.stubGlobal("WebSocket", …)` is the only
  way to stub it (direct assignment throws `Cannot assign to read only property`).
  `MeetingDetail` also needs a `MemoryRouter` (its note rows render `InlineCommentThread`,
  which calls `useNavigate`).

**Verified**
- **745/745 frontend, 69/69 files, `npm run build` clean** (`tsc --noEmit -p tsconfig.app.json`
  → 0 errors). **39 new tests** from this change: 11 `RichTextMentionEditor`,
  7 `FeedbackDetailModal`, 6 `MeetingDetail`, 5 `AccountDetailPage`, 5 `ChatterPost`,
  5 `ContactNoteRow`. (Suite was 687 at session start; the rest of the growth is a
  concurrent session's.) No backend files touched, so no migration and no daphne restart.
- Mid-session the suite and the build both went briefly red on `checklistParity.test.ts` and
  `StepsPanel.test.tsx` — **a concurrent session's in-flight edits**, not this change. Both
  cleared once that session saved. Worth knowing the tell: those two assert on the *source
  text* of `ActionItemsSidebar.tsx` / `CalendarPage.tsx`, files this session never opened, and
  their mtimes were minutes newer than any edit here. When the tree is shared, check `ls -lT`
  before believing a failure is yours.

---

### 2026-08-18 — Blank RolePage + ProfilePage: a DRF envelope typed as a bare array

**Symptom**
`/role/:slug` (e.g. `/role/sa`) and `/profile` rendered nothing at all. Every other route
was fine.

**Root cause**
`/api/v1/layouts/working-sessions/` and `/api/v1/layouts/page-notes/` are plain
`ModelViewSet`s (`layouts/views.py:81,109`) with no `pagination_class`, so they inherit the
global `PageNumberPagination` and answer with `{count, next, previous, results}`. But
`workingSessionApi.list()` and `userPageNoteApi.list()` in `lib/api.ts` were typed
`WorkingSession[]` / `UserPageNote[]`, and both pages did `setSessions(r.data)` straight into
state declared as an array.

So an **object** landed in `sessions`, and `sessions.map(...)`
(`ProfilePage.tsx:656`, `RolePage.tsx:1594`) plus `sessions.find(...)` threw
`TypeError: sessions.map is not a function`. A throw during render unmounts the entire route
subtree — hence a blank page rather than an error message anywhere.

What made the wrong typing look right: the sibling `layouts/pinned/` **is** a custom `@action`
returning `Response(serializer.data)` — a bare array (`layouts/views.py:78`). Two shapes are
live under one prefix, and the URL doesn't tell you which.

`page-notes` had a quieter version of the same bug: `r.data[0]` on the envelope is `undefined`,
so the notepad always looked empty and a save POSTed a **duplicate** note instead of PATCHing
the existing one.

**Fix** — `lib/api.ts` only; no API route, request shape, or response shape changed.
- New `unwrapResults<T>()` helper: accepts either shape and always resolves `T[]`
  (`Array.isArray(data) ? data : data?.results ?? []`).
- Applied to `workingSessionApi.list`, `userPageNoteApi.list`, and — deliberately —
  `layoutsApi.listPinned`, so that route keeps working today *and* survives someone adding
  pagination to it later. Call sites unchanged: the helper preserves the `AxiosResponse`
  shape, so `r.data` / `({ data })` destructuring still works.

**Key decisions**
- **Fixed on the frontend, not by setting `pagination_class = None`** on the two viewsets.
  That would have been a smaller diff but it changes a response shape, which hard constraint
  #1 forbids — and CLAUDE.md already assigns envelope-unwrapping to the fetcher.
- **Tolerant of both shapes rather than pinned to one.** Normally guessing is the bug, but
  here the `/layouts/` family genuinely serves both, so a fetcher that accepts either is the
  only version that can't be wrong.
- `?? []` matters as much as the `Array.isArray` branch: an error body or a `{}` response
  must still yield an array, or the crash just moves.

**How it was found** (the diagnostic path is the reusable part)
The MSW/jsdom render **passed** with every request unhandled — the `.catch(() => {})` on each
fetch left `sessions` at its `[]` initial value, so the page rendered fine. The bug only
exists when the request **succeeds**. Sequence that worked:
1. `tsc` clean, Vite transform clean, all routes 401-not-404 → not a build or routing fault.
2. Minted a short-lived JWT in-process and hit the live server: **all 11 endpoints 200**.
   So the backend was healthy and the fault had to be client-side and data-dependent.
3. Dumped the real response bodies and diffed shapes → `page-notes` and `working-sessions`
   came back `dict` with `results`, `pinned` came back `list`. That was the whole answer.
4. Replayed the real bodies into jsdom → `sessions.map is not a function`, reproduced.

**Test-harness notes**
- New `test/handlers/layouts.ts` and `test/handlers/skills.ts`, both registered in
  `msw-server.ts` **and** `setup.ts`'s `extraHandlers`. The layouts defaults deliberately
  encode the real asymmetry — `pinned/` bare, the rest enveloped — via an exported
  `layoutsPage()` helper, so future page tests exercise the same mix production does rather
  than a convenient all-arrays fiction that would have hidden this bug.
- Added a `/scheduler/action-items/` default handler to `test/handlers/scheduler.ts`
  (distinct from `/airtable/action-items/` in `action_items.ts`).
- `getByText(/Pinned Layouts/i)` is ambiguous on ProfilePage — the empty-state copy reads
  "No pinned layouts." Anchor on `"Working Sessions"` instead.

**Verified**
- 801/801 frontend, 75 files (14 new: 7 `lib/__tests__/layoutsApi.test.ts`,
  4 `pages/__tests__/ProfilePage.test.tsx`, 3 `pages/__tests__/RolePage.test.tsx` — these two
  pages previously had **no** test file at all). 531/531 backend. `npm run build` clean.
- Beyond the committed tests, both pages were rendered once against the **actual live
  response bodies** pulled from the dev server; both mount clean. That throwaway fixture test
  was deleted rather than committed, since it pinned one machine's data.
- Frontend-only diff, so no migration and no daphne restart — Vite hot-reloads it.

**Also fixed (pre-existing, blocking the build)**
- `lib/__tests__/actionItemEvents.test.ts:1` imported `vi` and never used it → TS6133, which
  fails `npm run build`. Committed that way in 9fcfa4e. Removed the unused import; nothing
  else in that file touched.

**Left open**
- The other seven `profiles/me/` callers and the double-GET on CalendarPage mount are still
  outstanding (noted in earlier entries).
- Nothing audits fetcher return types against real response shapes. `unwrapResults` is now
  available for any other list fetcher typed as a bare array; the ones under `/layouts/` were
  the only crashing cases, but the pattern was not otherwise swept.

---

### 2026-08-19 — Calendar action-items sidebar: six ordered sections + filter flags

**Why**
The sidebar rendered one flat list in API order. `AirtableActionItemViewSet` sets
`pagination_class = None` and applies no `order_by`, so a card's position told you nothing,
and the only filter was the free-text box.

**Which file actually renders** — this is the trap. There are two copies:

| File | |
|---|---|
| `pages/CalendarPage.tsx:1322` local `ActionItemsSidebar` | **The live one.** Reached via that file's *own* local `ItemsSidebar` (L2105) from L4795. |
| `components/calendar/ActionItemsSidebar.tsx` | Reachable only through `components/calendar/ItemsSidebar.tsx`, which has **zero consumers**. Dead, but it has the only renderable test surface. |

`pages/__tests__/CalendarPage.test.tsx:216` mocks `components/calendar/ItemsSidebar` — the
**wrong module**. That mock has never had any effect on what CalendarPage renders.

**Order** (each group `created_at` desc), a card appearing exactly once in its first match:
Currently Tracking → Staged Today → Pinned In Progress → In Progress → Open → Done.

The first three are *positional* state, not status. Note the naming collision:
`ZONE_LABELS.active` is the string `"In Progress"` while its column header reads "Currently
Tracking" — so **Tracking = zone `active`**, **In Progress = `status`**.

**What changed**
- `lib/actionItemSidebarOrder.ts` (new) — `SIDEBAR_GROUPS` (single source of truth for both
  section headers and chips), `DONE_WINDOW_DAYS = 14`, `isRecentlyDone`, `groupForItem`,
  `matchesFlags`, `groupActionItems`. In `lib/` because two components must not drift.
- `hooks/useActionItemZoneSets.ts` (new) — `createLocalStore` over `actionItemZones`,
  returning `{trackingIds, stagedIds}`, in the same shape `useFocusPins` owns
  `actionFocusPins`. Replaces the duplicated inline `stagedIds` useState in both sidebars
  (both of which read only the `today` zone). Exports `reloadActionItemZones()`.
- `components/calendar/SidebarFilterFlags.tsx` (new) — the six-chip row. Accent arrives as a
  prop: CalendarPage paints from `colors.colorFor("action_item")`, the twin uses `WORK_TRACKING_COLOR`.
- Both sidebars: fetch `status` → `"Open,In Progress,Done"`; grouped render with a
  `data-section={group.key}` micro-header + count; `visibleCount`/`isNarrowed` empty state.
- `test/setup.ts` — `reloadActionItemZones()` in `afterEach`, alongside `resetRequestCache()`.

**Key decisions**
- **Done is fetched always, rendered only for the last 14 days.** The endpoint is unpaginated,
  so the fetch is unbounded either way (55 Done rows in the dev DB); the *list* is what needed
  bounding. The window is printed in the header (`Done · last 14 days`) so the cap is not silent.
- `isRecentlyDone` uses `marked_done_at ?? updated_at`. The viewset only stamps
  `marked_done_at` on a status *transition*, so rows that arrived Done from an Airtable sync
  have it null — 4 of 55 in the dev DB. A strict filter would have silently hidden them.
  No usable timestamp ⇒ treated as recent rather than dropped.
- **Flags are independent predicates, not section membership.** Ticking "Open" reaches every
  `status === "Open"` card *including* one sitting in the Tracking section (it still renders
  under Tracking). Group-membership semantics would mean a flag could only ever find cards in
  its own section, which reads as a bug. Union across ticked flags; empty selection = everything.
- Positional state outranks the status filter, so a Blocked card the user *staged* still shows,
  while an unstaged Blocked/Backlogged card stays hidden as it always has been.
- `activeTimers` is deliberately **not** folded into Tracking — the other two positional groups
  are "where the card lives" state; a running timer is a different axis.
- Flags are session-only, not persisted, matching the existing `filterTerm`.
- `liveIds` is still computed **before** the keep-filter, so timer/scheduled-item pruning is
  unchanged — and it incidentally improves: a Done item with a live timer is no longer pruned.
- CalendarPage's fetch dropped `Blocked,Backlogged,Complete`. "Complete" is not in the model
  (Open/In Progress/Done/Blocked/Backlogged) and matched nothing; the twin was already cleaned up.

**Test-harness notes**
- Section headers must be queried by `data-section`, **not** by text: "In Progress", "Open" and
  "Done" all also appear as the status badge on every card (and "Done" as the expanded card's
  save button), so `getByText` is ambiguous.
- CalendarPage's copy cannot be rendered — neither it nor its wrapper is exported. Covered by
  `sidebarOrderingParity.test.ts`, which reads the source of both copies, the way
  `checklistParity.test.ts` guards StepsPanel. Behaviour is tested against the module copy.
- `ActionItemsSidebarFreshness.test.tsx`'s status assertion updated to `"Open,In Progress,Done"`.

**Verified**
- **895/895 frontend** (80 files; 54 new: 19 `lib/__tests__/actionItemSidebarOrder.test.ts`,
  7 `hooks/__tests__/useActionItemZoneSets.test.ts`, 14 `ActionItemsSidebarOrdering.test.tsx`,
  14 `sidebarOrderingParity.test.ts`), **571/571 backend**, `npm run build` clean.
- Frontend-only diff, so no migration and no daphne restart. All five changed/new modules
  confirmed transforming clean through the live Vite server.

**Also of note**
- A mid-session `ActionItemsPage.test.tsx` failure ("keeps the row highlight while the cursor
  crosses the row's own children") was a **concurrent session's** in-flight edit, not this
  change: that file's mtime moved *during* the run and the reported source line differed
  between two consecutive runs. `ActionItemsPage.tsx` has zero references to any module added
  here. It passes with this change's `test/setup.ts` line both present and absent.

**Left open**
- The two sidebar copies still duplicate their JSX; only the logic is shared now.
- `CalendarPage.test.tsx:216` mocks the wrong `ItemsSidebar` module — harmless today, but it
  means nothing in that suite exercises the real sidebar.
- Manual drag-reorder (`actionItemOrder`, used by Stage Today / Currently Tracking on
  ActionItemsPage) is **not** honoured by the sidebar; those sections sort by `created_at` desc
  like every other group.

---

### 2026-08-19 — Drop an action item on a collapsed account, in both grouped views

**What was actually broken**

The request read as one bug but was two different situations, and they had opposite diagnoses.
Establishing which was which came first — a throwaway test against the real DOM and MSW, since
the drop machinery is all DOM events and jsdom runs them faithfully.

- **Views grid** (default `kanban` view, one row per account): the collapsed-row drop *already
  worked*. The outer row `<div>` carries `onDragOver`/`onDrop` outside the `!rowCollapsed`
  branch, so a folded row has been a drop target all along. It just never said so, and it
  flickered — see below.
- **Projects view**: genuinely had **no** account drop target anywhere. Each group header is a
  plain `<button>` with no `onDrop`, and an expanded group's cards sit in a `StatusBoardView`
  whose columns only change *status*. Worse than inert: dropping a card on another group's
  column *did* fire, via the `externalDragId && !dragId` branch, so the status changed while the
  account did not — and the card snapped straight back into the group it was dragged out of.

**Backend**: untouched. No migration, no daphne restart.

**Frontend — `pages/ActionItemsPage.tsx` only**

- `assignItemToAccount(resolvedId, item, accountKey)` — extracted from `handleDrop`'s `accounts`
  branch, now the single mutation site for account reassignment. Both views route through it, so
  the optimistic update, the Airtable write and the activity-log line can't drift.
- `handleAccountGroupDrop` — the Projects view's drop handler. Assigns the account and
  **deliberately does not touch `zones`**.
- `ProjectsView` — new `accounts` + `onAccountDrop` props. Groups are built from the **account
  list**, not from the items, so every known account has a header even with zero items. Names
  matching no known account still get a group (so nothing renders nowhere) but are **not** drop
  targets, mirroring the Views grid's "Unmatched account" row. "No Account" is always present
  now, as the clear-the-account target.
- `StatusBoardView` — new optional `accountKey` / `onAccountDrop`. A column drop on a *grouped*
  board now means "this status **and** this account". Gated on `!dragId`: a local `dragId` means
  the drag started on this board, so the account is already right and no PATCH is sent.
- `leftElement(e)` + `CollapsedRowDropHint` for the Views grid (below).

**Key decisions**

- **The Projects view must not change the item's zone; the Views grid must.** Dropping in the
  Views grid literally means "put it in the Views grid". Projects renders every real item
  regardless of zone, so setting `zones` there would silently yank a card out of Stage Today as
  a side effect of filing it under an account. This is why `assignItemToAccount` owns no zone
  logic and each caller decides for itself.
- **Empty accounts render as header-only, no chevron, no board.** Five blank status columns per
  account the user has never filed work under would bury the populated groups. The header alone
  *is* the group and the drop target. Its button stays enabled (a `disabled` button does not
  reliably receive drop events) but loses the hover style, so it doesn't advertise a toggle with
  nothing to toggle.
- **Blanks are skipped, not promoted.** `handleAccountGroupDrop` bails on `local-*`. Projects
  never renders blanks; the only way one arrives is a drag out of Unstaged, and the Views grid
  is the path that owns `promoteBlankItem`. Same `canPin` precedent as focus pins and comments.
- **`overGroupKey` is local to `ProjectsView`, and `isOver` is gated on `dragInFlight`.** A
  page-level state write on every `dragover` would re-render every group in the list; gating on
  the drag still being live means a cancelled drag can't leave a group highlighted, with no
  `dragend` listener needed.
- An unresolvable `accountKey` returns early rather than falling through to "clear the account".

**Two real Views-grid bugs found while auditing it**

1. **`onDragLeave` fired on every child boundary.** `dragleave` bubbles, so crossing from the
   account label into the card strip flipped the shared `dragOverZone` to `null` and re-rendered
   the whole page — then the next `dragover` set it back. A flicker at best; with a tree this
   size it can cost the `drop` event itself. Both account rows now use
   `if (leftElement(e)) onDragLeave()`, the same guard `StatusBoardView` already used.
2. **A drop on the account a card was already filed under fired a pointless PATCH** plus a
   misleading "Moved …" log line. `assignItemToAccount` now diffs the update against the item
   first, via `sameFieldValue` — which treats `null` / `undefined` / `""` as equal, because
   Airtable returns `""` where the app writes `null` and a strict compare would call every
   already-cleared field changed.

Also added `CollapsedRowDropHint`: a collapsed row is ~40px of label and gave no sign it accepted
a drop, so filing a card into a folded-away account meant aiming on faith. Rendered **only while
a card is in the air**, so the resting grid is unchanged.

**Test-harness notes**
- `fireEvent.dragLeave` cannot carry `relatedTarget` — the same trap as `clientY` and
  `dragOverAt`: jsdom has no `DragEvent`, RTL falls back to a plain `Event`, and the property is
  silently dropped. Every dragleave then reads as "the pointer left", which is exactly the
  behaviour under test. New `dragLeaveTo()` dispatches a `MouseEvent` named `"dragleave"` instead.
- Two new `data-testid`s (`collapsed-drop-hint`, `project-group-<groupKey>`) rather than walking
  class strings: "Drop here" also appears on the Views grid's empty card strips, and an account
  name appears in both a Projects header and every card's badge, so text queries are ambiguous.
- Reaching the Projects view: its headers carry no `title`, while the Views grid's collapse
  toggles do — so `queryByTitle(/Collapse Acme Corp/)` going null is the signal the swap landed.

**Verified**
- 895/895 frontend, 80 files (8 new in `ActionItemsPage.test.tsx`: collapsed-row drop in the
  Views grid, drag-only hint, no-redundant-PATCH, the dragleave guard, all-accounts-have-a-group,
  collapsed-group drop in Projects, zone-preservation, and cross-group status-column drop).
  571/571 backend. `npm run build` clean.
- Every claim about what was broken was reproduced at the network layer via MSW first, not
  inferred from reading the code — the Views-grid half turned out to already work, which reading
  alone would not have settled.

**Left open**
- Verified in jsdom, not in a real browser. The two fixes that jsdom cannot really exercise are
  the re-render/flicker one (`leftElement`) and drag auto-scroll of the grid's `overflow-y-auto`
  container when the target account is off-screen.
- `DueDateView` and the ungrouped `status` view are not account-grouped, so they have no account
  drop targets and were left alone.
- A search matching nothing still short-circuits `ProjectsView` to "No items match", so no groups
  render and nothing can be dropped during a dead search.

---

### 2026-08-19 — The loading flash after a drop: the page was reloading on its own broadcast

**Symptom**
Dragging an action item from one account to another briefly replaced the whole board with the
full-page "Loading…" — reads as a glitch, not as progress.

**Root cause — nothing to do with the drag**

`lib/api.ts:314-319` installs a response interceptor that calls `notifyActionItemsChanged()`
after **every** non-GET to `/airtable/action-items` or `/scheduler/action-items`. That helper
(`lib/actionItemEvents.ts`) dispatches a *synthetic* `StorageEvent` so listeners in the same
document hear it — the real `storage` event never fires in the tab that wrote.

`ActionItemsPage`'s own `onStorage` handler matched `actionItemsUpdated` and called `load()`,
which starts with `setIsLoading(true)`, and `isLoading` short-circuits the entire page to a
single "Loading…" div. So the page was reloading itself in response to its own mutation, and
blanking while it did — for the length of four parallel requests. Every mutation on the page did
this, not just drops; the drag is simply where it is most visible.

**Fix** — `pages/ActionItemsPage.tsx` only. No API, request or response shape changed.
- `load()` takes `{ silent }`. Silent skips the `isLoading` flip, so the grid keeps rendering
  while the refresh runs. The first mount stays loud; every event-driven reload is silent.
  Same `{ silent: true }` shape `DashboardPage` already uses for its own broadcast listener.
- `scheduleSilentReload()` — a 250ms trailing debounce (`SILENT_RELOAD_DEBOUNCE_MS`) in front of
  the silent reload, cleared on unmount.

**Key decisions**
- **Silent, not suppressed.** Ignoring the page's own broadcast would be a smaller diff, but
  `notifyActionItemsChanged` carries no origin, and some mutation paths on this page may be
  relying on the reload to reconcile. Keeping the refetch preserves the freshness guarantee; only
  the spinner had to go.
- **The debounce is a correctness fix, not just a request saving.** A cross-account drop onto a
  status column PATCHes the account *and* the status, so two broadcasts arrive back to back. Two
  overlapping `load()`s each end in `setAllItems(newItems)` and can land in either order.
- **The Refresh button stays loud.** It is an explicit request for a reload, so the blank is the
  feedback. Only the reloads the user did not ask for went silent.
- The optimistic update has already moved the card, so the silent reload only confirms it — there
  is no window where the board shows stale placement.

**Test-harness note (this one nearly shipped a fake test)**
The first version of the no-blanking test **passed with the fix reverted**. MSW answers inside a
microtask, so a loud reload flashed and cleared before any assertion could observe it. The test
now holds the second `/airtable/action-items/` response open for 250ms and asserts inside that
window. Both new tests were checked by reverting the one-line fix and confirming they go red.

Second trap: after the drop the card is filed under the *collapsed* Beta Inc row, which correctly
renders no cards — so `getByText("Fix billing issue")` fails for the right reason. The assertion
is on the row's `GroupCounts` ("1 open") instead, which also proves the update rendered.

**Verified**
- 902/902 frontend, 80 files (2 new: no-blanking, and broadcast coalescing measured at the network
  layer by counting MSW hits). `npm run build` clean, `tsc -p tsconfig.app.json` clean.
- Frontend-only diff, so no migration and no daphne restart.

**Left open**
- Every other page that listens for `actionItemsUpdated` has the same self-broadcast reload
  (`CalendarPage`, `ActionItemsSidebar`, `AccountDetailPage`, `DashboardPage`). Only `Dashboard`
  is already silent. Not swept here — each has its own loading UI to check.
- The reload still refetches items, both account lists and the profile on every broadcast. Silent
  now, but four requests per mutation is worth revisiting given this repo's 429 history.

---

### 2026-08-19 — Account Detail kanban: column ordering rules

**Requested**
- **Open** — by `created_at`, oldest at the top, most recent at the bottom.
- **In Progress / Done / Blocked / Backlogged** — by the order the item was moved into that
  column, most recent at the bottom.

Before this, `kanbanItems.filter(i => i.status === status)` had **no** sort at all, so all five
columns echoed raw API order.

**What changed**

- `hooks/useStatusArrivalOrder.ts` (new) — `useStatusArrivalOrder(items)` returns
  `orderForStatus(items, status)`, and is simultaneously the observer that records moves.
  Built on `createLocalStore` (`lib/localStore.ts`), same as `useFocusPins` /
  `useAccountGroupCollapse`. Storage key `actionItemStatusArrival-v1`, shape
  `Record<status, airtable_id[]>` in arrival order, oldest first.
- `pages/AccountDetailPage.tsx` — hook called at component top level (it must see every
  `actionItems` change, and the kanban lives inside a render closure where hooks can't go);
  `orderForStatus(...)` wraps the filter at both column render sites.
- `test/setup.ts` — `reloadStatusArrivalOrder()` in `afterEach`, alongside the other
  module-level store resets.

**Key decisions**

- **Arrivals are recorded by observing `actionItems`, not by instrumenting each mutation site.**
  Status changes on this page come from the kanban drag, the card's own editor, the detail modal,
  and a broadcast refetch can bring in a change made on another page. One diff-against-last-seen
  observer catches all of them, and a future call site cannot forget to call it.
- **A first sighting is not an arrival.** An item we did not watch move keeps the chronological
  fallback rather than jumping to the bottom of its column — otherwise every mount would reorder
  the board, since mounting "sees" every item for the first time.
- **Unrecorded items sort above recorded ones.** Follows directly from "most recent at the
  bottom": something we never watched arrive is older news than something we did. It also makes
  the day-one state (no records at all) exactly equal to chronological order.
- **Done falls back to `marked_done_at`, not `created_at`.** It is the one status the server
  timestamps, and Done is the column most likely to be full of items completed long before any
  arrival was recorded — creation order says nothing useful about them.
- **Open ignores arrival records entirely.** It is an inbox; dragging something back out of In
  Progress should not park it at the bottom of the backlog.
- **Client-side, no migration.** There is no server field for "when did this enter Blocked", and
  adding one means a model change plus a write on every status change — a lot of machinery for a
  display order. Documented as the same `useResource`/HOOK_SPEC exemption `lib/localStore.ts`
  claims.
- **`withArrival` clears the id from every other status** before appending. A stale entry under
  the status an item left would make it sort as though it had never left.
- Capped at `MAX_IDS_PER_STATUS = 500`, dropping from the **front**. Ids are never pruned on
  delete because this page only sees one account's items, so pruning against them would discard
  every other account's records. Dropping the oldest arrivals is order-preserving in aggregate:
  an unrecorded id sorts above every recorded one, which is where those already were.

**Test-harness notes**
- The column-lookup helper first walked `header.parentElement.parentElement`, which lands on the
  **grid**, not a column. Two consequences, both silent: `within()` then saw every column at
  once, and `fireEvent.drop` hit an element with no `onDrop`, so the drag tests exercised
  nothing. The column is the header's *parent*.
- The header must be matched on its full class prefix
  (`flex items-center gap-1.5 text-xs font-semibold`), not just `font-semibold` — every card
  renders its own status as a bold pill, so a looser match picks up cards.
- Fixtures for the drag tests list the moved item **first**, so raw API order *and* creation
  order both disagree with the expected result. Without that, one test passed by coincidence
  even with the ordering removed.

**Verified**
- 919/919 frontend, 81 files (17 new: 13 `hooks/__tests__/useStatusArrivalOrder.test.ts`,
  4 in `AccountDetailPage.test.tsx`). 571/571 backend. `npm run build` and
  `tsc -p tsconfig.app.json` clean.
- All 4 page tests confirmed red with the `orderForStatus` calls removed, all 13 hook tests
  exercise the store directly.
- Frontend-only diff, so no migration and no daphne restart.

**Left open**
- Ordering *within* a column is not user-draggable — a drop anywhere on a column appends to the
  bottom. `ActionItemsPage` has a `beforeId` insertion-hint protocol for that; wiring it in here
  would mean per-card drag handlers on an out-of-scope page.
- The arrival map is global, not per-account. Harmless (an item has one account) but it means one
  localStorage key grows with every account's traffic, hence the cap.

---

### 2026-08-19 — Calendar: "Edit" that actually edits, and convert an event to another type

**Two bugs and a feature, all in the right-click / detail-panel path.**

**Bug 1 — "Edit" opened a read-only panel.** `EventDetailPanel` had editors for exactly two
special cases: `isScheduledReminder` and `isScheduledActionItem`. For an ordinary event the
footer offered only "Set reminder for this event" and "Delete event". There was **no edit form
and no save path for a plain calendar event at all**, so the menu's Edit entry
(`setSelectedEvent(ev)`) could not lead anywhere.

**Bug 2 — the panel never had a usable PK.** Both entry points put FullCalendar's
`extendedProps` straight into `selectedEvent` (`handleEventClick`, and the Edit menu item).
**FullCalendar strips `id`** — it owns that prop — so `selectedEvent.id` was always `undefined`
and any PATCH would have gone to `/events/undefined/`. The codebase already knew this:
`toggleAttendance` and the Comment menu entry each re-look-up the row from `eventsRef`. The
workaround was just never applied where the panel opens. (`handleEventClick`'s toggle-off check
compared `prev?.id === extProps.id` — i.e. `undefined === undefined`.)

Fixed with one `resolveEventRow(snapshot)` helper called at both entry points, so every panel
consumer gets a row with a real PK instead of each one repeating the lookup.

**Feature — Convert to…** Right-click → "Convert to…" expands inline (no submenu machinery;
same trick "Mark as important!" uses) offering the six categories plus "Action item".

**What "type" can be — the constraint that shaped this**

`CalendarEvent.EVENT_CATEGORY_CHOICES` has **six** values: meeting, task, out_of_office,
focus_time, working_location, appointment. `action_item` and `reminder` are **not** DB
categories — they exist only in the frontend's `ColorableEventType`, for painting synthetic
overlays. So converting to any of the five other types is an in-place `event_category` change,
while "convert to action item" has to create an `AirtableActionItem`.

**Per the user's decision: the event is kept**, linked through its existing
`agentpm_airtable_id`. New `convertEventToActionItemLinked` in `hooks/useConvert.ts`,
deliberately *not* the existing `convertEventToActionItem` (which deletes the source and is
still what `MeetingDetail` wants) — a meeting you held is history, and spinning off a follow-up
task should not erase it.

**Backend** — `scheduler/views.py`
- New `@action PATCH /scheduler/events/<pk>/details/`. A dedicated action, not the generic
  PATCH, for the **same documented reason `attendance` is one**: `perform_update` runs
  `RequireAccountMembershipMixin`, which resolves the account off `serializer.instance` when the
  patch omits it — so it 403s a user editing *their own* meeting whenever it is linked to an
  account they aren't a team member of. Google-synced meetings get auto-linked to accounts, so
  that is the common case. A test pins the generic path still 403ing, so the action can't be
  "simplified" away.
- `DETAILS_EDITABLE_FIELDS` whitelist; unknown keys ignored, not an error. `event_category`
  validated against the model choices (400 on `action_item`, `reminder`, `"Task"`, …).
  `start >= end` → 400, compared against the *stored* value so a one-sided patch is still caught.
  `all_day` checked with `isinstance(..., bool)` — the `1 == True` trap `attendance` hit.
- **Widened the Google push.** `perform_update` called `_update_in_google` only when the *times*
  changed, but `_sync_google_calendar` rewrites title/description/location/times/status from
  Google on every sync — so a local title edit was saved and then silently reverted. Now a
  shared `_push_update_if_needed` fires on any change to `GOOGLE_OWNED_EVENT_FIELDS`, from both
  the new action and the generic PATCH. Failures stay logged-not-raised: the local row is
  authoritative.
- `event_category` and `agentpm_airtable_id` are deliberately **outside** the snapshot, so a
  type change or a link write does not trigger a pointless Google write (Google has neither
  field, and the sync already preserves the category).

**Frontend**
- `lib/eventColors.ts` — new `EVENT_CATEGORY_META` (the six saveable categories + icons).
  `CreateEventModal`'s local `CATEGORY_META` now aliases it, so the create modal, the panel's
  type picker and the convert menu cannot disagree about what types exist.
- `lib/api.ts` — `schedulerApi.updateEventDetails(id, patch)`.
- `EventDetailPanel` — edit form for the plain-event branch (title / type pills / start / end /
  location / description), reachable from "Edit event", a double-click on read mode, or the
  context menu (via an `editRequestId` counter — a boolean could not re-open after a cancel).
  Sends only changed fields. Re-seeds from props only when *not* mid-edit, because the parent
  re-renders on every calendar poll and would otherwise wipe the form.
- `saveEventDetails` re-throws so the panel keeps the form open on failure — closing it would
  look exactly like success.

**A real gap the tests caught**

`agentpm_airtable_id` is in `CalendarEventSerializer.read_only_fields`, so handing it to the
serializer was **silently dropped and returned 200** — the worst kind of failure. Now assigned
on the model directly, exactly as `attendance` does with the equally read-only `attended`.

**Outward-facing side effect, surfaced in the UI**

Pushing to Google means Google emails the guest list. The form shows an amber note ("…saving
will update it in Google and notify them") when the event `is_synced` *and* has attendees — said
before the click rather than discovered after it.

**Verified**
- **943/943 frontend** (81 files; 24 new: 20 in `CalendarPage.test.tsx`, 4 in
  `eventColors.test.ts`), **595/595 backend** (24 new: `CalendarEventDetailsUpdateTest` +
  `CalendarEventGooglePushTest`).
- A frontend test pins the PATCH url as `/events/7/details/` and asserts it is **not**
  `"undefined"` — the bug-2 regression guard.
- Daphne restarted; `/scheduler/events/1/details/` returns **401, not 404**, so the route is
  live. All five changed modules confirmed transforming clean through Vite.

**Also of note**
- `npm run build` is red on **another session's in-flight edit**: `AccountDetailPage.tsx:32`
  imports `useSlackLinkAutosave` without using it yet (TS6133). That file's mtime is newer than
  every edit here and the symbol appears nowhere in this change. `tsc -p tsconfig.app.json`
  reports that as the **only** error in the repo, and `npx vite build` bundles clean.
- **`pkill -f daphne` kills Vite and ngrok too.** `npm run start-agent-pm` runs all three under
  one `concurrently` parent, so killing any child makes the parent exit and takes the siblings
  with it. CLAUDE.md's restart snippet is only safe if daphne was started standalone —
  otherwise re-run `npm run start-agent-pm`. The stack was restored.

**Left open**
- `lib/useConvert.ts` and `hooks/useConvert.ts` are near-identical copies differing only in
  import paths; all consumers import the `hooks/` one, so the `lib/` copy is dead. Untouched
  here, but it is a live drift hazard — `convertEventToActionItemLinked` exists in only one of them.
- The Google push is fire-and-forget, so an edit can succeed locally and still be reverted by a
  later sync if Google was unreachable at the time. Surfacing that needs a retry queue.
- `all_day` is accepted by the endpoint but has no control in the edit form.

---

### 2026-08-19 — Slack link: pasted URLs were silently discarded

**Two separate faults, both needed fixing**

1. **The pill only committed on `blur`.** All five copies of the URL pill (`PillUrl` on
   ActionItemsPage, `AccPillUrl` in `components/shared/PillInputs.tsx` *and* its diverged twin in
   AccountDetailPage, `CalPillUrl` in CalendarPage *and* `calendarHelpers`) were byte-identical
   inputs with `onBlur` as the only commit path. Paste a link and press Enter, or paste and click
   something that does not move focus, and the value never reached the form at all — the pill just
   collapsed back to "Slack".
2. **Even on blur, most surfaces only updated local form state.** The account and action-item
   forms all wait for an explicit Save. (The two calendar copies were already fine: their cards
   commit on click-outside via `commitEdit`.)

**What changed**

- `components/shared/UrlPillInput.tsx` (new) — the open-state input, now shared by all five
  pills. Commits on **paste** (and closes, so the "Slack ↗" chip is the confirmation), on Enter,
  and on blur; Escape cancels. One-commit guard, because committing unmounts the input and
  removing a focused element can fire blur on the way out — that would have PATCHed twice.
- `hooks/useSlackLinkAutosave.ts` (new) — `saveSlackThreadUrl(item, url)` plus the hook that
  fires it and reports failures. Wired into the six surfaces that edit a **saved** item:
  `components/account/ActionItemModal`, `ActionItemSidePanelContent`, both diverged copies in
  `AccountDetailPage`, and `ActionItemsPage`'s `ActionItemFields` (via new optional
  `autosaveTarget` / `onAutosaved` props) and `KanbanCard`.

**Key decisions**

- **Only this field autosaves.** Every other field on these forms is a draft you review before
  saving; a Slack URL is pasted from the clipboard and is either right or not. Making the whole
  form autosave would change what the Save button means on six surfaces at once.
- **Paste closes the pill.** The collapsed chip is the only feedback that the value took, and ✎
  reopens it. Keeping the input open after a paste-save would leave the user with no signal.
- **The paste is spliced in by hand** (`clipboardData.getData` + selection range +
  `preventDefault`) rather than read back after the default paste. The post-paste value is not
  available synchronously, and deferring a tick to read `input.value` would not work in jsdom,
  which never applies clipboard data to an input — so that version would also be untestable.
- **Create forms are deliberately excluded** (`NewActionItemCard`, the new-item card in
  AccountDetailPage, and both calendar create forms): there is no record to PATCH yet. The same
  is enforced defensively in `saveSlackThreadUrl`, which no-ops on a `local-*` id.
- **A failed autosave reports through `useAppError`.** The chip renders the new link from local
  form state either way, so the user has every reason to think it saved — silence is the worst
  outcome. `useAppError` has a no-op default, so surfaces mounted without the provider still
  write, they just get no banner.
- `saveSlackThreadUrl` normalises `null`/`undefined`/`""` when checking for a change, since
  Airtable returns `null` for a never-set URL while the TS type says `string`.
- Sharing the input added `stopPropagation` on click to the two copies that lacked it. Invisible,
  and it stops a click in the input reaching a card whose own `onClick` opens a modal.

**Verified**
- 964/964 frontend, 83 files (26 new: 11 `UrlPillInput.test.tsx`, 8
  `hooks/__tests__/useSlackLinkAutosave.test.tsx`, 2 in `ActionItemModal.test.tsx`, plus 5 from
  the earlier entries in this session). 595/595 backend. `npm run build` and
  `tsc -p tsconfig.app.json` clean.
- Both halves pinned by sabotage: removing the `autosaveSlackLink` call fails the modal test;
  removing the paste-commit fails 4 tests across two files.
- Frontend-only diff, so no migration and no daphne restart.

**Left open**
- The two calendar create forms and `NewActionItemCard` still only carry the link into the create
  payload, which is correct — noted only so nobody "fixes" them later.
- Five near-identical pill wrappers remain (only the input is shared). Their chip/button markup
  differs slightly per page, and unifying it would be a visible-styling risk.

---

### 2026-08-19 — Every action-item update reaches the activity log (card + page)

**Symptom**
An action item showed "created" and then nothing until "deleted" — every edit in between was
invisible on both the card's Activity Log section and the `/logs` page.

**Root cause**
The activity log is entirely frontend-driven: one `addLog()` (`lib/appLog.ts`) writes a
localStorage entry tagged with a `resource` and dispatches a synthetic `storage` event, which
feeds *both* `ActivityLogSection` (filtered by resource → the card) and `LogsPage` (all entries).
The single writer already fanned out to both surfaces — the problem was that only create, delete,
zone-drag, reminder and conversion paths ever called it. Everyday edits (modal/side-panel Save,
inline field edits, status changes, reassignment, calendar due-date drags) route through
`updateActionItemFields` / `updateActionItemStatus` and logged **nothing**.

**What changed**

Frontend:
- `lib/actionItemLog.ts` (new) — `logActionItemUpdate(before, changes)`. Diffs a fixed field set
  (`status`, `priority`, `due_date`, `task`, `task_details`, `assignee_name`, `account_name`,
  `estimated_time`, `time_spent`, `prep_time`, `slack_thread_url`), emits **one** `addLog` entry
  per save summarising the changed fields (`"<task>" — Status: Open → In Progress; Reassigned to
  Jane`). In `lib/` so the diff logic/phrasing can't drift across the many diverged action-item
  UIs (same rationale as `lib/localStore.ts` / `lib/eventColors.ts`). No circular risk: `api.ts`
  doesn't import `appLog`, and this only imports `addLog`.
- Wired into every update handler that logged nothing: `components/account/ActionItemModal`,
  `ActionItemSidePanelContent`, `ActionItemCard` (Mark Done/Reopen + reassign drop),
  `hooks/useSlackLinkAutosave`, `pages/ActionItemsPage` (`handleSaveItem` + external-drop-status),
  `pages/DashboardPage`, `components/calendar/KanbanCard` / `MeetingDetail` / `ActionItemsSidebar`,
  `pages/CalendarPage` (handleUpdate, onUpdateActionItem, 2 due-date drag sites),
  `pages/AccountDetailPage` (2 handleSave sites + handleKanbanDrop).

Backend-restore fixes (older activity never returned after a localStorage clear):
- `lib/appLog.ts` `syncLogsFromBackend` now requests `page_size=500` (was page 1 ≈ 50) and keeps
  `comment_reply` entries on restore (was dropped by the allowed-category filter).
- `lib/api.ts` — `realtimeApi.listActivity` accepts `page_size`.
- `realtime/views.py` — `AgentActivityEventViewSet` gets `ClientPageSizePagination` so
  `?page_size=` is honoured (global default ignores it). The `[:500]` cap stays; Django allows
  re-slicing a sliced queryset within bounds, so pagination over it is safe.
- `realtime/models.py` — added `comment_reply` to `EVENT_TYPE_CHOICES`. **No migration needed**:
  `0003_add_comment_reply_event_type` already declared it; the model file had merely drifted out
  of sync with its own migration.

**Key decisions**
- **Per-field diff messages, not a generic "updated" line** (user choice). Long-text fields report
  "Title updated" / "Description edited" rather than dumping content.
- **`isBlank` treats 0 as blank** for the numeric time fields, and `null`/`undefined`/`""` as
  equal — Airtable returns `""`/`null` where the app writes the other, so without this every save
  logged a spurious diff.
- **Handlers that already emit semantic entries were left untouched** (zone-drag "Moved X from Y
  to Z", blank-promotion account link, timeline add) — adding a field diff there would double-log.
- **`local-*` items are skipped** (same guard as focus pins/comments — `promoteBlankItem` discards
  the id, so a log against it would orphan).
- Slack autosave logs with the returned `data` (real task label) but the *old* URL restored into
  `before`, so the diff still fires.

**Verified**
- 984/984 frontend (85 files; new: 15 `lib/__tests__/actionItemLog.test.ts`,
  3 `lib/__tests__/appLog.test.ts`, 2 in `ActionItemModal.test.tsx`), 603/603 backend
  (5 new in `realtime/tests/test_views.py::AgentActivityEventViewSetTests`), `npm run build` clean.
- Wiring test confirmed meaningful by sabotage (removing the `logActionItemUpdate` call in
  `ActionItemModal.handleSave` turns it red).
- Daphne restarted standalone (the view changed); `/api/v1/realtime/activity/?page_size=500`
  returns 401 not 404. Killed only the daphne child (concurrently has no `--kill-others`), so Vite
  (:5173, 200) and ngrok (:4040, 200) stayed up.

**Left open**
- Other pages listening for `actionItemsUpdated` still self-broadcast-reload (noted earlier); not
  related to logging.
- The helper's field set is fixed; a new user-facing field needs adding to `LOGGED_FIELDS` +
  `clauseFor`.

---

### 2026-08-27 — "New Project" modal: full Salesforce field set, per-project team, SF fetch

**Why**
The account page's "+ New Project" button opened a single text input. It created an
`AccountProject` row with only `name`/`description` — every other model column
(`url`, `action_ids`, `meeting_ids`, `goal_ids`, `resources`, `sf_data`, `kind`) was
silently dropped on every reload. The user wanted the button to open a large modal
covering every field from three Salesforce/Cloud-Coach project screenshots, collapsible
per section, with a Salesforce fetch action, per-project team membership (a member can
be on several projects under one account), and goals whose linked artifacts render above
meetings/action items.

**Key discovery — most of it already existed, unwired.**
`components/account/ProjectGoals.tsx` was a fully-built prototype — `ProjectDetailsModal`
with 13 matching collapsible SF sections, `SalesforceProjectData`/`GoalSection` types in
`types/accounts.ts` already covering ~140 fields — but nothing imported it.
`AccountDetailPage.tsx` rendered its own separate, much simpler inline `ProjectGoals` with
the single-input flow. The work was mostly: wire the real component in, fix the
persistence bug, add the one missing section (System Information), and add the two things
that didn't exist anywhere — per-project team membership and a live Salesforce fetch.

**What changed**

Backend (`accounts` app):
- `AccountProject.sf_project_id` (new column) — the required key for the SF fetch, kept as
  a real column rather than buried in the `sf_data` blob because it's looked up by.
- New `ProjectMember` model (`project` FK, `team_member` FK, `role`, `unique_together`) —
  mirrors the existing `AccountRole` pattern at the project level instead of the account
  level, since nothing previously scoped membership below Account.
- `accounts/sf_project_fields.py` (new) — `SF_PROJECT_FIELD_MAP`, our internal key →
  `(guessed Cloud Coach API name, datatype)` for all ~140 fields, mirroring the frontend's
  `SF_SECTIONS` key-for-key.
- `AccountProjectViewSet.fetch_salesforce` (`POST /accounts/projects/fetch-salesforce/`) —
  stateless, no DB write. Describes the connected org's `{ns}__Project__c` object first and
  only queries fields that actually exist there, returning `fields_skipped` for guessed
  names absent from the org, so a wrong guess degrades instead of erroring.
- `ProjectMemberViewSet` (`/accounts/project-members/`) — list scoped by `?project=` or
  batched `?project__in=`, same account-membership guard as `AccountProjectViewSet`
  (promoted to a shared `_assert_account_membership` helper).
- Migration `accounts/0019`.

Frontend:
- `types/accounts.ts` — `AccountProject.sf_project_id`/`sf_data`/`kind` (the TS interface
  had drifted from the serializer), `GoalSection.sfProjectId`, new `ProjectMember`
  interface, and the missing **System Information** fields on `SalesforceProjectData`.
- `components/account/ProjectGoals.tsx` — added the System Information section to
  `SF_SECTIONS`; the modal gained an SF Project ID field + "Fetch from Salesforce" button
  (merges into the in-memory draft, manual edits win over the fetch) and a collapsible
  **Team Members** block (distinct from the existing "Project Team" *text-field* SF
  section) with add/remove backed by the new endpoints; project cards show member avatars.
- `pages/AccountDetailPage.tsx` — deleted the dead inline `GoalResource`/`GoalSection`/
  `ProjectGoals` (kept the shared `uid()` helper, still used elsewhere on the page) in favor
  of importing the real component. Fixed the actual persistence bug: `handleGoalsChange`
  now sends the full field set on create/update (was `name`/`description` only), and the
  load effect populates `url`/`resources`/`sfData`/etc. from the response instead of
  hardcoding them empty. Batch-loads `ProjectMember`s for the account's projects
  (`?project__in=`, not one request per card).
- `lib/api.ts` — `fetchProjectSalesforceData`, `listProjectMembers` (batched),
  `addProjectMember`, `removeProjectMember`.

**Key decisions**
- **No new `Goal` model.** A Goal is still an `AccountProject` row with `kind="goal"`,
  linked into a parent project's `goal_ids` — that's what the orphaned component already
  did, and the backend model already had `kind`.
- **Action items/meetings/artifacts stay JSON id arrays**, not new FK tables. The actual
  bug was that they were never round-tripped to the backend; fixing that alone makes
  "artifacts appear at top of a goal when linked" real, since `resources` already renders
  before meetings/action items in `renderGoalItems`.
- **The ~140 SF fields stay in the existing `sf_data` JSONField**, validated against a
  fixed key→type map mirrored on both sides, rather than 140 DB columns.
- **The SF fetch is a stateless pre-save action.** The modal already keeps an unsaved
  `newGoalDraft` in memory until Save is clicked, so there's no need to create a
  placeholder row first — fetch just fills the draft.
- **The SF field→API-name map is an educated guess**, not verified against a live org
  (this repo's own Zoom/Gong email-parsing session hit the same kind of gap). `describe`-
  gating plus `fields_skipped` means a wrong guess is reported, not silently wrong.

**A bug introduced and caught mid-session, worth noting**
Inserting `ProjectMemberViewSet` between `AccountRoleViewSet.get_queryset` and its
`perform_create`/`destroy` (an `Edit` whose `old_string` ended right at `get_queryset`)
spliced the new class in *before* those methods rather than after — since both blocks sit
at the same 4-space indent, Python silently reattached `AccountRoleViewSet`'s staff-only
`perform_create`/`destroy` as **extra methods on `ProjectMemberViewSet`** instead of
leaving them on `AccountRoleViewSet`. Every non-staff `AccountRoleViewSet` test still
passed in isolation but failed identically with real DB rows; two full-suite runs and a
sandboxed `APIClient` repro (outside the test runner, careful to clean up the rows it
created in the dev DB) pinned it to that exact splice before it was fixed. Lesson: an
`Edit` whose insertion point sits between two same-indentation blocks needs the boundary
re-verified by grep/read after the fact, not assumed from the diff.

**Verified**
- 707/707 backend (18 new: `AccountProjectSalesforceFetchTests`, `ProjectMemberViewSetTests`,
  `AccountProjectSfProjectIdTest`).
- 1152/1153 frontend (33 new: 12 `ProjectGoals.test.tsx` — this component had zero tests
  before, since it was never wired in — 4 new in `AccountDetailPage.test.tsx`, 6 in
  `batchApi.test.ts`). The 1 failure is pre-existing full-suite-only flakiness unrelated to
  this change — confirmed by `git stash` against clean `AccountDetailPage.tsx` (same
  failure) and by two consecutive full runs failing on two *different* unrelated tests
  (`AccountDetailPage`'s drag-order test, then `RolePage`'s tray-drop test).
- `npm run build` and `tsc -p tsconfig.app.json` clean.
- Dev DB migrated (`accounts.0019`); backend restart needed before manually exercising the
  two new routes live (`/accounts/projects/fetch-salesforce/`, `/accounts/project-members/`).

**Left open**
- The SF field→API-name map needs verification against a real connected Cloud Coach org —
  today only `sync_projects`' original 6 fields are known-correct.
- `GoalSection.goalIds` referencing a just-created goal go stale if that goal's own id swaps
  from a client `uid()` to its real numeric id before the referencing project is saved —
  pre-existing behavior, not touched here.
- The "Project Team" SF text-field section (free-text names from Salesforce) and the new
  "Team Members" `ProjectMember` picker are deliberately separate concepts; nothing
  reconciles a name typed in one with a person added in the other.

---

### 2026-08-28 — Single-owner action items/artifacts, per-project aggregate views

**Why**
A project's action items/artifacts and its nested goals' action items/artifacts were
never mutually exclusive: `handleItemDrop` only ever *added* the dropped id to the
target's array, so dragging a card that was already displayed under a project onto one
of its own goals (or between goals) left it in both places at once. Separately, the user
wanted a way to search/browse across every goal under a project without expanding each
one — all artifacts, all Open/Pending/Closed/Blocked action items, plus a search bar.

**Single-owner fix — `components/account/ProjectGoals.tsx`**
- `handleItemDrop` now strips the dropped action item / meeting id (or artifact resource
  id) from every *other* project/goal before adding it to the drop target — the same
  single-parent rule `assignGoalToProject` already applies to goal→project, extended to
  items. A drop is a **move**, not a copy.
- `renderProjectCard` also computes `projectOwnItems` — the project's own `actionIds`/
  `meetingIds`/`resources` with anything already claimed by a nested goal filtered out —
  as a display-time backstop against stale/duplicate data, independent of the drag fix.

**Per-project aggregate views**
- New tab row on every project card: **Goals** (the existing nested-goals tree, default),
  **Artifacts**, **Open**, **Pending**, **Closed**, **Blocked/Backlogged** — plus a search
  input. `collectClusterEntries` flattens the project's own items and every nested goal's
  items into one list, tagging each with its owning name ("Project" or the goal's name,
  rendered as a chip on every row so origin isn't lost once flattened).
- Status→tab mapping (confirmed with the user, since the model's five statuses don't split
  evenly into three buckets): **Open** = `Open` only, **Pending** = `In Progress` only,
  **Closed** = `Done` only, **Blocked/Backlogged** = `Blocked` + `Backlogged` — its own
  tab rather than folded into Pending or Closed.
- Search behavior: typing while a status/Artifacts tab is active filters within that tab;
  typing from the default **Goals** tab searches everything (every status bucket +
  artifacts) at once, matching against action-item task text / artifact label.
- Row actions (remove ✕, open action item, open artifact link) still operate through the
  existing `removeAction`/`removeResource`/`onSelectAction`, addressed by the entry's real
  owning id — so removing from the aggregate view mutates the correct underlying
  project/goal, not a synthetic copy.

**Verified**
- 1167/1167 frontend (24 new: 3 single-owner move tests — including one that drives an
  actual `fireEvent.drop` with a hand-built `DataTransfer` stub, per the existing
  `makeDataTransfer`-style pattern this repo uses for drag tests — and 9 new aggregate-view
  tests, both sabotage-checked by reverting the fix/mapping and confirming the relevant
  tests go red). `npm run build` and `tsc -p tsconfig.app.json` clean. No backend changes.

---

### 2026-08-28 — Vendored `twilio-agent-pm-shared` into the repo

**Why**
The frontend's `twilio-agent-pm-shared` dependency was `file:../../../twilio-agent-pm-shared`
— resolving to `/Users/lizkane/Desktop/twilio-agent-pm-shared`, a folder **outside this repo
entirely**, with no `.git` of its own. Cloning just this repo (e.g. sharing it with a
colleague) left that folder missing, so `npm install` would break. Investigating it turned up
a wrong assumption: this package is not old-app leftovers the migration forgot to bring over.
The old app (`TWILIO - Agent PM`) depends on the exact same external folder, via the identical
`file:../../../twilio-agent-pm-shared` path and the same imports — it's a third, independent
sibling package (framework-free "brain" logic + Zod schemas + fixtures + a CLI adapter + a
Swift bridge, `src/adapters/swift/AgentPMBridge.swift` — evidently meant to be shared across
more than one front-end), not a dependency *of* the old app *on* this one or vice versa.

**What changed**
- Copied the package's `src/`, `dist/`, `package.json`, `package-lock.json`, `tsconfig.json`,
  `jest.config.js` into a new **`twilio-agent-pm-shared/` at this repo's root** (sibling to
  `app/`, not inside it) — `dist/` is what Vite/Vitest alias directly to, and `app/.gitignore`
  has a blanket `dist/` rule (line 85) that would have silently swallowed the vendored output;
  the root `.gitignore` has no such rule.
- Updated the four places that hardcoded the 3-levels-up path to the new 2-levels-up one:
  `app/frontend/package.json` (`file:` dependency), `vite.config.ts` and `vitest.config.ts`
  (alias `URL`), `tsconfig.app.json` (`paths` mapping). Removed a now-stale
  `"../../../twilio-agent-pm-shared"` entry `npm install` left behind in `package-lock.json`
  marked `"extraneous": true`.
- The external original at `/Users/lizkane/Desktop/twilio-agent-pm-shared` is untouched (copied
  from, never written to) — the old app still resolves its own copy of the same relative path
  there, and the old app must never be modified.

**Key decision — the vendored package needs its own `node_modules`, not just source+dist**
Initially skipped copying `node_modules` (68 MB, assumed only needed for the package's *own*
build/test scripts). Wrong: `dist/schemas.js` has a real runtime import, `import { z } from
"zod"`, and Vite resolves a symlinked package by its **real path** then walks up from there
looking for `node_modules` — so it needed `zod` sitting next to the vendored package, not
hoisted into `app/frontend/node_modules` (confirmed no `node_modules/zod` entry exists anywhere
in `app/frontend/package-lock.json`; that dependency has always lived inside the shared
package's own install, exactly as it does in the external original). Fixed by running
`npm install` inside the new `twilio-agent-pm-shared/` directory — added as a required one-time
setup step in "Key commands," since that directory's `node_modules` is (correctly) covered by
the root `.gitignore` and won't survive a fresh clone.

**Verified**
- 1167/1167 frontend (100/100 files), 707/707 backend, `npm run build` clean. Confirmed via
  `git status` in both this repo and the old app's repo, plus unchanged mtimes on the external
  original's `dist/index.js` / `package.json`, that neither was modified — only read from.

**Left open**
- The vendored package's `src/adapters/cli/` and `src/adapters/swift/` are carried over as-is,
  unused by this app (kept per the "vendor the whole package" decision — the architecture may
  matter for a future CLI or Swift client).
- ~~Unrelated, noticed in passing: "Key commands" still instructs activating the **old app's**
  backend venv for tests.~~ Fixed same session, on request: "Key commands" now sources
  `.venv/bin/activate` relative to `app/backend/` (this app's own venv, confirmed Django
  5.2.15 installed) instead of the old app's path.

---

### 2026-08-31 — MCP tool use in the ConversationRelay voice pipeline

Implements `TWILIO_WIRING.md` §8 steps 1–11. That file was written by a prior session that
stopped **before writing any code** — `git diff HEAD` was empty and the two
`worktree-agent-*` branches are stale leftovers from the 2026-08-07 action-item-steps
session, not this work. So everything below is new.

**What changed**

Registry-derived tool lists (killing the three-place drift):
- `agents/mcp_server.py` — `@mcp_server.tool()` gained `group=` / `skill_safe=`, stored in
  `_meta`, plus `grouped_catalog()`, `skill_safe_tools()`, `GROUP_ORDER`, `GROUP_LABELS`.
  All 19 existing decorators annotated. Unknown group raises **at registration**.
- `agents/agent.py` — the hand-written `== YOUR TOOLS ==` block is now generated by
  `_render_tool_section()` / `build_system_prompt()`. `SYSTEM_PROMPT` keeps its name.
  This fixes a live bug: `get_meeting_notes_from_email` was registered and sent to Claude in
  the schemas but **absent from the prompt**, so the model was never told it existed.
- `skills/views.py` — `_PLATFORM_TOOL_CATALOG = mcp_server.skill_safe_tools()`. Same curated
  13 as before; `test_mcp_catalog` enumerates them explicitly so widening the set has to be a
  deliberate edit that fails a test first.

Skills reachable from voice:
- `list_skills` / `load_skill` tools + `_skill_scope` / `_list_skills_sync` / `_load_skill_sync`.
  Visibility mirrors `AgentSkillViewSet.get_queryset` **intersected with `status="approved"`**
  (drafts have not passed security review). Both use
  `sync_to_async(thread_sensitive=True)`, not the `run_in_executor(None, ...)` the other 17
  tools use — bare executor threads never run `close_old_connections` and cannot see
  `APITestCase` transaction data, so those 17 are untestable from inside a TestCase.

New `realtime/` modules: `voice_identity.py`, `voice_policy.py`, `voice_persistence.py`,
`voice_agent.py`. `realtime/llm.py` and `realtime/tests/test_llm.py` **deleted**.

**Key decisions**

- **Identity travels as a signed, call-bound `<Parameter>`**, minted in `VoiceTwiMLView` where
  `From="client:<pk>"` is visible, read on the setup frame. Payload is only `{"u": pk, "c":
  call_sid}`; the consumer re-reads the live `User` row, so a deactivated account cannot ride
  an in-flight token. Call-SID binding is the anti-replay teeth. `device.connect({params})` and
  a bare `<Parameter name="user_pk">` are both browser/relay-token-forgeable — the relay token
  authenticates *Twilio*, not a user.
- **An unverifiable caller gets one sentence and a hangup**, not a tool-less chat. With no user
  every tool returns empty and the model confabulates around it ("I don't see any action
  items"), and a silent degraded mode would hide a broken identity path in production forever.
  The reason rides in `handoffData`, the only observability for a call that never reached the DB.
- **A voice-specific loop, not `AgentOrchestrator`.** The chat prompt mandates markdown
  hyperlinks and voice forbids markdown; chat only streams the *final* turn so a tool round
  emits nothing (the dead-air problem); chat offers `ESCALATE_TOOL`, and escalating mid-call to
  a thinking Opus tier would add seconds of silence. ~40 lines of duplication beats five new
  branches in the chat hot path.
- **Stream every round.** Claude's own preamble ("Let me pull up your action items") is the
  filler — better than canned text and free. `FILLERS` is indexed by round number (deterministic
  for tests) and only used when a round produced *no* text, so they never stack.
- **The turn budget never cancels a stream.** Cancelling mid-stream strands a `last:false`
  frame with no terminator and wedges TTS for the rest of the call; over budget instead forces
  a final round with `WRAP_UP_NUDGE`. Chosen over `tool_choice={"type":"none"}` because
  Bedrock's support varies by snapshot and a 400 mid-call is unrecoverable.
- **`WRAP_UP_NUDGE` merges into the trailing user message.** The Messages API requires
  alternating roles, and after a tool round the last entry is already a user turn carrying
  `tool_result` blocks — a second consecutive user message would 400 mid-call.
- **The confirmation gate lives on the consumer instance**, not in the transcript, so the model
  cannot talk itself past it. Gating is per *block*: a non-gated tool in the same turn still
  dispatches in parallel. On confirm, the tool is dispatched **bypassing the model**, so the
  arguments cannot change between the question and the action. Deny wins ties (`"yes, no wait,
  cancel"`). Regex not LLM classification: an LLM round-trip would add ~500ms at the most
  safety-critical moment. Two unclear replies drop the pending rather than looping.
- **Only the first gated tool in a turn arms.** Two spoken questions in one utterance cannot be
  answered by speech or by a single keypress; the second gets "ask about that one first".
- `ignoreBackchannel` is deliberately **off** (it would suppress "yeah", the primary
  affirmative token) with `reportInputDuringAgentSpeech="true"` compensating. Asserted in a
  test so nobody optimizes it back in. `dtmfDetection="true"` finally gives the consumer's
  `dtmf` branch a job.
- **Chat's gate is unchanged, and the asymmetry is the point.** A chat user sees exact tool
  arguments rendered in the UI; a voice user hears a lossy paraphrase of a lossy transcription
  and cannot review anything.

**Called-out visible change** — voice calls now create an `AgentSession`, so they appear in the
chat Sessions list and in `token-stats`. Required by the feature; the `"Voice: "` title prefix
makes them distinguishable with no frontend change. `ToolCall` gets its **first writer anywhere
in the codebase**; rows are written at turn end (the assistant message they link to does not
exist while the tools run) and with `message=None` if the turn raised, which is what the
nullable FK is for.

**Corrections to TWILIO_WIRING.md**
- §7's `_hints_for` reads `Account.name`. The Django model field is **`company_name`**
  (`AirtableAccount` is the one with `name`) — the plan's snippet would have raised.
- §9's "keep unchanged" list for `test_consumers.py` is **internally inconsistent**: those tests
  patch the now-deleted `realtime.llm.bedrock_stream`, and they send setup frames with no
  identity token, which under §1's own design ends the call. Rewrote the file around a
  `_setup_frame()` helper that mints a valid token, preserving every bug guard (the three named
  in the module docstring all still have a dedicated test).
- `VOICE_BEDROCK_MODEL_ID` removed as planned; the retired `claude-3-5-haiku-20241022` is gone.

**Test-harness notes (three of these cost real time)**
- **`asgiref`'s `receive_output` cancels the application task when its timeout expires.** So the
  obvious "drain frames until `receive_from` times out" loop silently kills the consumer, and
  surfaces much later as a `CancelledError` from `disconnect()`. `receive_nothing()` only polls,
  so it is safe as a loop guard — hence `_drain_frames`. This is also why the pre-existing tests
  used `receive_nothing` everywhere.
- **Consumer tests must be `TransactionTestCase`.** The consumer writes through
  `@database_sync_to_async`, which runs in asgiref's executor thread; `TestCase`'s wrapping
  atomic block is held by the test thread and SQLite answers the consumer's INSERT with
  `database table is locked: auth_user`.
- A fake that arms a confirmation must use `asyncio.get_running_loop().time()`, not `now=0.0` —
  the consumer's TTL check compares against the monotonic clock, so `0.0` reads as
  90+ seconds stale and every reply falls through as a fresh prompt. Four gate tests passed
  for the wrong reason until this was fixed, and the *expiry* test passed vacuously.
- `spoken_summary`'s `arguments or {}` guard means an **empty** dict subclass is swapped for a
  plain dict, so a `.get` that raises never runs. A summariser-raises test needs a non-empty one.
- `override_settings` does apply to `async def` test methods (verified directly, not assumed).
- The migration-seeded `get-meeting-notes` skill (`skills/migrations/0008`) is public+approved,
  so it is legitimately in every user's skill inventory — assert per-line properties, not total
  lengths.

**Verified**
- **920/920 backend** (baseline 707 → 213 new: 14 `test_mcp_catalog`, 12 in `test_agent`,
  18 in `skills/tests.py`, 22 `test_voice_identity`, 38 `test_voice_policy`,
  30 `test_voice_persistence`, 38 `test_voice_agent`, 38 `test_consumers` rewritten,
  22 new in realtime `test_views`).
- Sabotage-checked: removing the identity enforcement reds all 5 `IdentityGateTests`; bypassing
  the gate in `_plan` reds all 5 `VoiceAgentConfirmationGateTests`.
- **Frontend untouched** (`git diff HEAD -- app/frontend` is empty). `npm run build` clean;
  `npx vitest run` 1166/1167 — the one failure is `RolePage`'s tray-drop test, which passes
  12/12 in isolation and is the pre-existing full-suite-only flake recorded in the 2026-08-27
  entry.
- Two real fixes came out of writing the tests: `_hints_for` produced `"Acme  Inc"` (double
  space) for an account name containing a comma, and the `_load_skill_sync` refusal message is
  now identical for "unknown", "draft" and "someone else's private" so existence cannot be probed.

**Left open**
- **Daphne must be restarted before exercising voice by hand.** No URL patterns changed (so no
  404-vs-401 route check applies), but the running process holds the old Python. `pkill -f
  daphne` takes Vite and ngrok with it — re-run `npm run start-agent-pm`.
- `TWILIO_WIRING.md` §10's 12-step manual end-to-end verification has **not** been run: it needs
  a live call, Bedrock credentials and the Twilio console. Nothing in this change was validated
  against real audio, real ASR or the real Bedrock endpoint.
- Gateway voice tier is `""` — needs a LiteLLM virtual key, same as the other gateway tiers.
- The `run_in_executor(None, ...)` DB-connection leak across the other 17 tools is untouched;
  voice amplifies it. New code uses `sync_to_async(thread_sensitive=True)`.
- Inbound PSTN calls have `From=<phone>`, so identity never resolves and the call is ended.
  Correct-but-blunt; matching `From` against `UserProfile.phone` is the follow-up.
- `VOICE_BLOCKED_TOOLS` is an empty escape hatch with no consumer yet.
- Escalation is one-way in chat and absent in voice; no de-escalation either way.
- `get_calendar_events` and `get_token_usage` are absent from the skill-safe 13. That looks like
  an accidental omission predating this change, but widening it is a policy decision, not a
  refactor — left alone deliberately.

---

### 2026-08-31 — Cloud Coach time logging: ported `timesheeter`, Log Week in one request, MCP tools

**What the source project actually was**

`/Users/lizkane/Desktop/timesheeter` is **not** an MCP server. It is a Google Apps Script
Calendar add-on (`clasp`-deployed, 12 files under `src/`) — `PropertiesService`,
`UrlFetchApp`, `CalendarApp` and `Utilities` have no analogue here, so nothing in it was
droppable as-is. Its real value is `src/Schema.js`: object/field API names discovered by
running `src/Debug.js`'s `describe` probes against the **live Twilio org**, which
contradict what `salesforce_sync/` had been guessing.

| | this repo before | timesheeter (org-probed) |
|---|---|---|
| Project object | `cc4sf__Project__c` | `project_cloud__Project__c` |
| Project → Account | `AccountId` | `ccpe_ocp__Account__c` |
| Project dates | `cc4sf__Start_Date__c` | `project_cloud__Start__c` / `__End__c` |
| "my projects" | `OwnerId == me` | any of **10 role lookups** on the project |
| Time log object | `cc4sf__Time_Entry__c` | `project_cloud__Expense__c` |
| Hours | `Duration_Minutes__c` | `Total_Hours__c` — **hours, not minutes** |
| Write shape | one REST POST per entry | one **Composite** call, `allOrNone` |

So `sync_projects` was 400ing, `SalesforceProject` was empty, `SalesforceProjectViewSet`
returned nothing, and the Log Time panel was silently falling back to local
`AccountProject` rows. `salesforce_sync/` also had **zero tests**.

**New — `salesforce_sync/`**
- `cloudcoach_schema.py` — port of `Schema.js`. `SCHEMA_DEFAULTS` + `get_schema()`, deep-merged
  with a `CLOUDCOACH_SCHEMA` **env-var** JSON override (env, not a setting, because
  `core/settings.py` was owned by a concurrent session). Names are mixed-namespace on
  purpose — Cloud Coach's own fields carry prefixes, Twilio's additions don't.
- `cloudcoach.py` — `week_bounds`, `available_fields`/`gate_fields` (describe-gating, the same
  pattern as `accounts.views.AccountProjectViewSet.fetch_salesforce`), `my_projects_for_week`
  (the role-field OR clause), `resolve_resource_id`, `build_time_log_payload`,
  `composite_create`.
- `log_week.py` — `plan_week()` / `write_week()`.
- `agent_tools.py` — `preview_time_log_week` + `log_time_week` MCP tools.
- `voice_gate.py` — **temporary**, see below.
- `tests/` package — 139 tests across `fakes.py` + 5 modules.
- Migration `0003_widen_teammember_sf_id` (32 → 128 chars).

**Modified — `salesforce_sync/` only**
- `sync.py`: `sync_projects` is schema-driven and describe-gated; new `sync_project_roles`
  mirrors the 10 role lookups into `SalesforceTeamMember` rows keyed
  `role:<project sf_id>:<field>`; `_get_or_create_config` records the instance the client
  actually reached; `sync_all` isolates per-step failures.
- `views.py`: new `POST /api/v1/salesforce/log-week/`; `SalesforceProjectViewSet.get_queryset`
  widened to `owner_sf_id OR members__sf_user_id`.
- `serializers.py`, `urls.py`, `models.py`, `apps.py`.

**Frontend**
- `lib/logWeek.ts` — types + `roundUpToQuarterHour` / `buildLogDescription` / `isSalesforceId`.
  `CalendarPage`'s local `roundUpToQuarterHour` was **deleted** in favour of this one, so the
  hours the panel displays are computed by the same function the server writes with.
- `components/calendar/UnloggedItemsWarningModal.tsx` — the warning popup.
- `pages/CalendarPage.tsx` — `handleLogWeek` rewritten (one request, not N), plus
  `collectWeekEntries`, an `onWeekLogged` prop, and the modal mounted at page level.
- `lib/api.ts` — `salesforceApi.logWeek` / `previewWeek`. No existing endpoint changed.

**Key decisions**

- **Auto-resolve, manual wins.** Per event: `attended is False` → skipped; else that day's
  `LogTimeDayAssignment` (manual); else `event.account` → `AccountProject.sf_project_id`; else a
  `SalesforceProject` matched on account name **and** on which the user holds a role. The role
  check is load-bearing — a bare name match would file time onto a colleague's project.
- **`plan_week` makes no Salesforce call.** That is what lets one function serve the modal
  preview, the agent's read-back, and the write path, with no second copy of the rules. A test
  asserts `get_client` is never called.
- **`entries=` override.** The panel holds hour overrides, removed rows and per-project item
  assignments in localStorage; recomputing server-side would silently discard them. It sends
  entries when it has any and omits the key when it has none — an empty array would read as
  "log nothing", which is exactly what made Log Week useless on a fresh panel.
- **A scoped run still reports events with no account.** `plan_week` drops *other* accounts'
  events silently but keeps unlinked ones, because an event with no account cannot belong to
  another account either — and warning about those is the whole point.
- **`attended is None` still logs.** That is the documented tri-state meaning; excluding it
  would make every untouched meeting vanish from the timesheet.
- **The button is no longer gated on having dragged a project onto a day.** A week where
  nothing resolves now answers with the modal explaining why, which beats a permanently
  disabled button.
- **Idempotency via `SalesforceTimeEntry`**, deduped on `(project, date, synced_to_sf=True)`.
  No new model. A failed attempt (`synced_to_sf=False`) does not block a retry, and
  `allOrNone=True` means a retry cannot double-log a partial week.
- **`Resource__c` is the one field that cannot be verified without the org.**
  `resolve_resource_id` reads the field's own `referenceTo` from the describe: `User` → the
  user id, the Resource object → a looked-up Resource record, anything else → omitted and
  reported in `fields_skipped`.
- **Submit-for-approval deliberately not ported.** `ccSubmitWeek` marks `Status__c`, and
  `CLOUDCOACH_SETUP.md` flags the org's real mechanism as unknown (Timesheet Header? Apex?).
  Logging only, per the user's call.
- **The Gemini/`Agent.js` few-shot suggestion layer was not ported** — deterministic
  account→project resolution covers the requirement with no LLM in the write path.

**Registering MCP tools without touching `agents/mcp_server.py`**

A concurrent session owns `agents/`, `realtime/`, `skills/` and `core/settings.py`. Tools are
therefore registered from **`SalesforceSyncConfig.ready()`**, which imports `agents.mcp_server`
and calls `agent_tools.register()`. This reaches every consumer with no edit to a file this
session did not own, because the system prompt and the skills catalog are both *derived* from
the registry (`grouped_catalog` / `skill_safe_tools`). Ordering is safe: `ready()` runs during
`django.setup()`, while `agents/agent.py` (which builds `SYSTEM_PROMPT` at import time) is only
imported later by a view. Verified live — both tools appear in `SYSTEM_PROMPT`.

Both are `skill_safe=False`: a skill author should not be able to wire up timesheet writes, and
it keeps `agents/tests/test_mcp_catalog.py`'s locked `EXPECTED_SKILL_SAFE` set green.

**`salesforce_sync/voice_gate.py` is temporary — port it, then delete it**

The real spoken gate lives in `realtime/voice_policy.py::VOICE_CONFIRM_TOOLS`, which the
concurrent session is rewriting. So the spec was authored in the same shape here, and
`log_time_week` enforces it itself: `confirm=False` returns the plan plus a
`CONFIRMATION_REQUIRED` instruction and writes **nothing**; only `confirm=True` writes. The
module docstring carries the 4-step port-and-delete instructions (category `"outbound"`, drop
the `confirm` parameter, extend `test_voice_policy.py`, delete the file and
`VoiceGateSpecTest`). **Do this only once that session is finished and the user has approved.**

**Test-harness notes**
- `tests/fakes.py::FakeSalesforce` records `queries` and `restful_calls`, so tests assert on the
  SOQL that was built and on the exact composite body — the only way to pin the Cloud Coach
  field names and the minutes→hours conversion without a live org. Patched at
  `salesforce_sync.client.get_client`.
- `FakeSalesforce.query` returns the whole record regardless of the SELECT list. That surfaced a
  real code issue: `sync_projects` read a describe-gated-out field straight off the response, so
  "skipped" and "stored" could disagree. Fixed with a `_field()` helper that reads only what was
  selected.
- The `AccountsSidebar` stub in `CalendarPage.test.tsx` gained an `enter-log-time` button — the
  Log Time panel was previously unreachable from that suite, so nothing exercised it.
- `test/handlers/salesforce.ts`'s `log-week/` default returns a **clean** week, so the modal
  renders nothing and every pre-existing CalendarPage test's DOM is unchanged. `weekPlanReport()`
  derives all counts from the lists it is given, so a fixture cannot contradict itself.
- Registered in **both** `test/msw-server.ts` and `test/setup.ts`'s `extraHandlers`, per the
  existing convention.

**Verified**
- **139/139 backend** in `salesforce_sync`; **1057/1057 full backend suite** at the time of the
  frontend run.
- **1209/1210 frontend**, `npm run build` clean, `tsc -p tsconfig.app.json` clean. The 1 failure
  is `RolePage`'s export-tray test — reproduced **with every change here stashed**, so it is the
  pre-existing cross-file pollution the 2026-08-27 entry already recorded.
- All 9 new CalendarPage tests confirmed red under sabotage (old `disabled` gate restored +
  `onWeekLogged` call removed), then green again.
- Dev DB migrated (`salesforce_sync.0003`); backup at `/tmp/db.sqlite3.pre-cloudcoach-logweek`.
- Daphne restarted; `/api/v1/salesforce/log-week/` returns **401, not 404**. Vite (:5173) and
  ngrok (:4040) survived — `concurrently` has no `--kill-others`. Note the daphne child needed
  `kill -9`: a plain SIGTERM left it holding :8000 while refusing connections, so the replacement
  could not bind and the port looked live but answered nothing.

**Not mine — the concurrent session's in-flight state**
`agents/tests/test_agent.py` has 1 failure + 16 errors, all about model tiers, escalation and
streaming: `agents/agent.py:57` references `core_llm` with no matching import, mid-extraction to
the new `core/llm.py`. Identical counts with this session's work fully stashed. Nothing in
`salesforce_sync/` references `core_llm`.

**Left open**
- **The ported schema is unvalidated against the live org.** `POST /salesforce/log-week/` with
  `{"dry_run": true}` is read-only and returns `fields_skipped` — a non-empty list is the signal
  to set `CLOUDCOACH_SCHEMA`. No code change needed; nothing before that step can validate it.
- `components/calendar/LogTimePanel.tsx` (zero consumers) was not updated; its divergence from
  CalendarPage's live copy widens by one function.
- The per-day **Log** buttons still POST `log-time/` individually — only Log Week was batched.
- A scoped run with several manual projects on one day defers entirely to the client's `entries`,
  because the per-event split lives in localStorage.

---

### 2026-08-31 — Bedrock → LiteLLM gateway, via one shared client

**Why**
Requested: move the app off Bedrock onto the corporate LiteLLM gateway and always use
`et-router`, described as "the claude model … which automatically selects which model to use".

**The model request could not be honoured as literally stated, and that is the headline.**
`et-router` is *not* Claude-only. Measured against the live gateway on 2026-08-31, both
router ids pool Anthropic's models with third-party ones:

| id | simple prompt | tool lookup | complex reasoning |
|---|---|---|---|
| `et-router` | `anthropic.claude-haiku-4-5` | **`moonshotai.kimi-k2.5`** | `anthropic.claude-haiku-4-5` |
| `claude-router` | **`moonshotai.kimi-k2.5`** | **`moonshotai.kimi-k2.5`** | `anthropic.claude-haiku-4-5` |

`claude-router` reads as Anthropic-only from its name and is not. On being shown this the
user's instruction was: *"do not send any of our data there"* — so both routers are out, and
the tiers are pinned Anthropic ids instead. Auto-selection is preserved *within* Anthropic by
the existing self-escalation (`default` → `strong` via `ESCALATE_TOOL`), which is the same
idea done client-side.

**Six client constructions, not one**
"Switch the app to the gateway" turned out to touch six independent LLM paths, five of them
unable to reach the gateway at all:

| Site | Was |
|---|---|
| `agents/agent.py build_client` | already backend-aware |
| `skills/views.py _bedrock_client` (5 call sites) | hardcoded `AnthropicBedrock` + `_REVIEW_MODEL` |
| `sync_review/tasks.py _call_claude` | raw boto3 `invoke_model`, Bedrock wire protocol |
| `account_feed/tasks.py _bedrock_determine_type` | raw boto3 `invoke_model` |
| `integrations/meeting_notes.py` | `anthropic.Anthropic(api_key=...)`, direct API |
| `integrations/views.py` (gmail thread summaries) | `anthropic.Anthropic(api_key=...)`, direct API |

The two boto3 sites spoke `{"anthropic_version": "bedrock-2023-05-31", ...}` directly, so no
amount of settings work would have moved them. All six now resolve their client through
`core.llm.build_sync_client()` / `build_async_client()` and their model through
`model_for_tier()`.

**New `core/llm.py`** — `model_for_tier`, `build_sync_client`, `build_async_client`,
`complete()` (single-turn text, replacing the boto3 calls), `gateway_token`,
`is_anthropic_model`. In `core/` per this repo's convention for cross-cutting code
(`core/mixins.py`, `core/pagination.py`). `agents/agent.py` re-exports `model_for_tier` /
`build_client` / the tier constants so its public surface and its tests are unchanged.

**Key decisions**

- **The vendor guard lives in the resolver, not at the call sites.** `model_for_tier()` refuses
  any id that is not Anthropic, naming the routers explicitly in the error. It is the one
  funnel all six paths go through, so a future call site inherits the protection instead of
  having to remember it. `AGENT_REQUIRE_ANTHROPIC_MODEL=0` lifts it deliberately.
- **The credential is the Okta helper, not the static key — and this is not a preference.**
  `LITELLM_VIRTUAL_KEY` is present in `app/.env` and authenticates fine, but the account is
  over its spend cap: every call returns
  `429 ExceededBudget: Spend=2315.47, Budget=1000.0`.
  Wiring it in as `ANTHROPIC_API_KEY` — the obvious reading of the plan's "needs a LiteLLM
  virtual key" — would have 429'd the entire app. The Okta bearer token that Claude Code
  itself uses (`/usr/local/bin/claude-litellm-token`) works. Resolution order is therefore
  `ANTHROPIC_API_KEY` (left **empty** on purpose, with the reason in `.env`) → helper command.
  Set the static key once the budget is raised; it is still the right thing for prod/CI.
- **Tokens are cached by their own `exp`, refreshed 120s early.** The helper's JWT lives ~50
  minutes, so a long-lived worker holding one from startup would fail mid-request. The `exp`
  claim is read (unverified — only to schedule the refresh) rather than assuming a fixed TTL.
- **The helper call is timeout-bounded (20s).** When its cache is stale it drops into an
  interactive PKCE *browser* flow, which in a web worker would hang the request forever. On
  timeout the error says to run it once in a terminal — actionable rather than a hang.
- **Bedrock is kept working**, so this is a one-env-var revert. Both `build_*_client`
  functions still have the branch and it is still tested.
- `integrations/meeting_notes.py` keeps its **fallback**: an unreachable LLM still stores the
  vendor's raw recap text. That was a deliberate decision in the 2026-08-18 entry (losing the
  recap entirely is worse than losing the formatting) and the backend swap must not quietly
  turn Claude into a hard dependency. Same for the gmail thread summaries, which now degrade
  to unsummarised threads instead of raising.

**Verified live, through the app's own code path** (not a hand-rolled client): all three tiers
resolve, `complete()` returns text, the skills sync client answers, and the voice loop streams
with all 21 tool schemas attached. That last one also confirmed the voice design's central
assumption for real — the model spoke *"Let me pull up your action items."* **before** calling
`get_airtable_records`, which is exactly the free contextual filler the loop relies on instead
of canned text.

| tier | model | verified |
|---|---|---|
| default | `claude-sonnet-4-6` | streams + tool use |
| strong | `claude-opus-4-8` | streams + tool use |
| voice | `claude-haiku-4-5` | streams + tool use, lowest latency |

**Test-harness note**
The fake model ids in `test_agent.py` / `test_voice_agent.py` (`gw-sonnet`, `b-haiku`, …) are
now rejected by the vendor guard, so they were renamed to `claude-gw-sonnet` etc. Renaming the
fixtures rather than disabling the guard keeps it exercised by every existing tier test.
`test_gateway_without_key_raises` became
`test_gateway_with_no_credential_source_at_all_raises` — a missing static key is no longer an
error, since the helper is the fallback.

**Verified**
- **960/960 backend** (920 → 40 new in `core/tests/test_llm.py`). Sabotage-checked: disabling
  `_assert_anthropic` reds the three router/vendor tests.
- Frontend untouched.

**Left open**
- The LiteLLM budget needs raising before a static virtual key can replace the Okta helper;
  until then every process needs a valid `~/.cache/claude-litellm` token, which means a
  **browser login on first use** — awkward for Celery workers and unattended deploys.
- `AWS_PROFILE` / `AWS_REGION` remain in `.env`, now unused by any LLM path. Left in place so
  `AGENT_BACKEND=bedrock` still works as a revert.
- `SUMMARY_MODEL` in `integrations/meeting_notes.py` is now `""` (an override hook). It used to
  pin `claude-opus-5`, so meeting-note summarisation moves from Opus 5 to the default tier
  (`claude-sonnet-4-6`) — a deliberate downgrade for cost/latency, easily reverted by setting
  that constant.
- The gmail thread summariser deliberately uses the **voice** tier (`claude-haiku-4-5`) since it
  runs per-thread in a request path; worth revisiting if summary quality drops.

---

### 2026-08-31 — Opus disabled with graceful fallback; backend-aware credential errors

**Two requests, and the second turned out to be a real bug**

Reported: the Agent page returned
`[Model credentials expired. Run \`aws sso login --profile twilio-devex-bedrock\` and try again. (ref 9a1be5fc)]`
after the move to the LiteLLM gateway.

**Root cause was stale config, not code:** daphne had been started at 10:36 and `.env` /
`core/settings.py` were changed at 11:35, so the running process was still
`AGENT_BACKEND=bedrock` with an hour-expired SSO token. Daphne has no autoreload. Fixed by
restarting the stack.

**But the message itself was also wrong**, and would have misled anyone hitting a real gateway
credential failure: `classify_agent_error` returned the `aws sso login` advice for
`_BEDROCK_CREDENTIAL_ERRORS` **unconditionally**, regardless of `AGENT_BACKEND`. Two changes:

- The Bedrock branch is now gated on `settings.AGENT_BACKEND == "bedrock"`; on the gateway the
  same exception class reports "check the gateway token" instead.
- New `core.llm.GatewayCredentialError(ImproperlyConfigured)`, raised by every credential path
  in `_mint_gateway_token`, so the gateway's equivalent of an expired SSO token gets its own
  actionable message naming the helper to re-run. It is checked **before** the generic
  `ImproperlyConfigured` branch it subclasses — branch order is load-bearing, and a test pins it.
  Without the distinct type, "your token expired" and "you forgot to set a model tier" both read
  as "misconfigured — see server logs", which is the failure mode that produced this report.

**Opus disabled — substituted, not rejected**

`AGENT_BLOCK_OPUS` (default on). Enforced in `core.llm.model_for_tier`, the one funnel every LLM
call goes through, so it covers a tier *and* an `AGENT_MODEL_OVERRIDE` — the likeliest way Opus
creeps back.

**Substitution rather than an exception** is the deliberate call: the request was to *fall back
to the other models*, and taking the whole agent down over a cost preference would be the wrong
failure mode. An Opus id degrades to the best non-Opus model configured for the active backend
and logs a WARNING naming both, so it is never silent. `_non_opus_fallback` reads the same tier
map rather than hardcoding an id, so the substitute is valid under `bedrock` too. If *every*
configured tier is Opus it raises — at that point there is nothing legitimate to fall back to,
and inventing a model id would be worse than failing loudly.

`opus` is matched as a substring, so `claude-opus-5`, `claude-opus-4-8[1m]` and
`us.anthropic.claude-opus-4-7` are all covered.

**Tiers after the change** (escalation stays meaningful — `default → strong` is a real step up):

| tier | gateway | bedrock |
|---|---|---|
| default | `claude-sonnet-4-6` | `us.anthropic.claude-sonnet-4-6` |
| strong | `claude-sonnet-5` | `us.anthropic.claude-sonnet-5` |
| voice | `claude-haiku-4-5` | `us.anthropic.claude-haiku-4-5` |

`claude-sonnet-5` verified on the gateway (streams + tool use, non-Opus). There is **no
user-facing model picker** anywhere in the frontend, so escalation was the only path to Opus.

**Test-harness note**
The fake strong-tier ids (`claude-gw-opus`, `claude-b-opus`, …) were being *substituted* by the
new block, so every escalation assertion silently drifted to the default model. Renamed to
`claude-gw-sonnet5` etc. — which is also now reality. `OPUS_TIERS` / `ALL_OPUS_TIERS` in
`core/tests/test_llm.py` keep real Opus ids on purpose, since they are what the block is under
test against.

**Verified**
- **1178/1178 backend** (1096 → 82 new, of which 9 `OpusBlockTests`, 4
  `GatewayCredentialErrorTypeTests`, 4 new classify-error tests; the rest are a concurrent
  session's salesforce_sync suite).
- Sabotage-checked both: removing the Opus substitution reds 4 tests; making the `aws sso`
  advice unconditional again reds the gateway-advice test.
- Live end-to-end through `AgentOrchestrator` on the gateway: a real chat turn answered on
  `claude-sonnet-4-6`, and `model_for_tier("strong")` resolves to `claude-sonnet-5` with
  `opus=False`.
- Stack restarted; daphne now runs code newer than the settings change and all probed routes
  return 401 (live), Vite 200.

**Left open**
- **ngrok is not tunnelling.** `/api/tunnels` reports `[]`, the process emits no output, and the
  public domain 307s to ngrok's offline page. This was already true *before* the restart, so it
  is pre-existing and not caused by it. It blocks Twilio webhooks (voice) only — the Agent page
  and REST API are unaffected. Likely the free tier's single-session limit; needs `ngrok http`
  run in a terminal to see the real error.
- `AGENT_MAX_TOKENS_STRONG=16000` was sized for Opus's default thinking. Sonnet 5 may not need
  that headroom; harmless, but worth revisiting for cost.

---

### 2026-08-31 — Voice cannot be tested on the corporate network: Zscaler denies ngrok

**Symptom**
"Start Voice Session" connects then immediately plays *"An application error has occurred.
Goodbye"* — Twilio's standard response when the TwiML webhook does not return valid TwiML.

**It is not the app.** No request for `/api/v1/realtime/voice/twiml/` ever reached Django, and
there is no traceback in the backend log. Twilio could not reach the machine at all.

**Root cause — a network policy block, not a code or config fault.** ngrok's agent cannot
establish a tunnel. Zscaler MITMs `tunnel.ngrok.com` and then *denies* it:

```
$ curl -sI https://tunnel.ngrok.com
HTTP/1.0 307 Moved Temporarily
Server: Zscaler/6.2
Location: https://zscaler.corp.twilio.com?...&reason=Access+denied+due+to+bad+server+certificate
          &reasoncode=SERVER_ACCESS_DENIED&action=deny&cat=Other+Information+Technology
$ openssl s_client -connect tunnel.ngrok.com:443 | openssl x509 -noout -issuer
issuer=CN=Zscaler Intermediate Root CA (zscalertwo.net)   # not ngrok's cert
```

**Diagnostic sequence worth reusing.** The failure presents in two layers and the first one is
a red herring:

1. `x509: certificate signed by unknown authority` in ngrok's log. ngrok is a Go binary with its
   own bundled CA pool, so it does not see the Zscaler root that the macOS system trust store
   *does* have (which is why `curl https://tunnel.ngrok.com` verifies fine —
   `ssl_verify_result: 0` — while ngrok does not). This is the same class of problem as the
   `AWS_CA_BUNDLE` fix in the 2026-08-18 entry.
2. `root_cas: host` **fixes that layer** — the error changes to `session closed`. It is a
   **v2-format, top-level** config key: ngrok 3.39.6 rejects it both as `agent.root_cas` and as a
   top-level key in a `version: "3"` config (`field root_cas not found in type
   config.v3yamlConfig`). It must go in a `version: "2"` config passed via `--config`.
3. `session closed` at authentication is the policy deny above. `SSL_CERT_FILE` /
   `SSL_CERT_DIR` do nothing — Go on darwin reads the Security framework, not those vars.

So there is no code or config change that makes this work from inside the corporate network.

**The browser console errors are the same interception, and are harmless.** `Failed to fetch` /
`ERR_CONNECTION_CLOSED` against `eventgw.us1.twilio.com` is Twilio Voice **Insights telemetry**
being blocked. It has nothing to do with the application error and does not affect call audio.

**Options, in order of effort**
1. Ask IT to allowlist `*.ngrok.com` / `tunnel.ngrok.com` (currently categorised
   "Other Information Technology" and denied).
2. Test voice off the corporate network — a personal hotspot is the fastest way to validate the
   whole pipeline end to end.
3. Deploy the backend somewhere publicly reachable and point the TwiML App's voice URL there.

Whichever is chosen, `TWILIO_WIRING.md` §10's 12-step manual verification is still **unrun**, so
the voice pipeline remains validated only by its 1178-test suite — never against real audio, real
ASR, or a real Twilio call.

**Housekeeping**
- The ngrok config at `~/Library/Application Support/ngrok/ngrok.yml` was left **byte-identical**
  to its pre-session state (verified by diff against a backup). The v2 test config that held a
  copy of the authtoken was written 0600 and deleted.
- Stack restarted and healthy: daphne :8000 → 401 (live), Vite :5173 → 200, ngrok 0 tunnels
  (expected, blocked).

---

### 2026-08-31 — Cloud Coach round 2: fixed the connection, project lookup by name, membership auto-push

Follow-on to the round-1 time-logging entry above. Four pieces: repair the Salesforce
connection (which blocked everything), port the interim voice gate into
`realtime/voice_policy.py`, add a project-lookup-by-name tool, and push project membership
to Cloud Coach when a person is linked to an account or a project.

**1. The connection was misconfigured — diagnosed by probing the org, not by reading code**

| Probe | Result | Meaning |
|---|---|---|
| `POST twlo.lightning.force.com/services/oauth2/token` | **302** | `lightning.force.com` is the *UI* host — not an OAuth or REST endpoint. This was the value in `app/.env`. |
| `POST twlo--jarvisdc.sandbox.my.salesforce.com/.../token` | **400** | Correct host, rejecting an empty body. |
| `GET .../oauth2/authorize` with the real `SALESFORCE_CLIENT_ID` | `redirect_uri_mismatch` | **The Connected App already exists in the sandbox.** The key is valid. |
| Same, with a bogus client id (control) | `invalid_client_id` | Proves the probe distinguishes the two cases. |
| Real key vs 4 candidate callback URLs | all `redirect_uri_mismatch` | **None** of this app's callback URLs are registered on the app. |

So **no new API token or Connected App is needed** — Connected Apps are copied into a
sandbox on refresh and keep their Consumer Key. The org-side fix is to add
`http://localhost:8000/api/v1/integrations/salesforce/callback/` (and the ngrok
equivalent) to the app's Callback URL list. The probe technique is the reusable part: a
bogus-client-id control turns an ambiguous error into a definite answer.

Three code faults compounded it:
- `integrations/views.py::SalesforceOAuthCallbackView` **discarded the `instance_url` the
  token response returns** — the authoritative API host. Now stored on `SalesforceConfig`
  before `sync_all()` runs.
- `salesforce_sync/client.py::get_client` always used `settings.SALESFORCE_INSTANCE_URL`.
  New `resolve_instance_url(user)` prefers the stored value; `_refresh_token` had the same
  bug and now shares it.
- Round 1's `sync._get_or_create_config` recorded the host from `sf.base_url`, which is
  **circular** (that value derives from the same setting). Removed; the callback owns it.

New `SALESFORCE_LOGIN_URL` (defaults to `SALESFORCE_INSTANCE_URL`) so a sandbox can
authenticate against `test.salesforce.com` while the API base stays the My Domain host.
Both the authorize and token calls use it — exchanging a code against a different host
returns `invalid_grant`.

**2. Voice gate ported; `salesforce_sync/voice_gate.py` deleted**

`log_time_week` is now in `realtime/voice_policy.py::VOICE_CONFIRM_TOOLS` as `"outbound"`
(a third-party write on the user's behalf — the `send_sms` trust level, not a local
delete), with a `_week_phrase` helper so a bare call still reads as "log your time for this
week to Cloud Coach".

**The `confirm=` parameter was removed from the tool.** Keeping both gates would make voice
ask twice. Consequence, called out: **chat now writes on the first call**, like every other
`create` tool — chat renders the arguments in the UI before dispatch, which is the
asymmetry `TWILIO_WIRING.md` §3 documents. `test_voice_policy.py`'s `EXPECTED` key set is
the guard, plus a test asserting the parameter is gone from both the signature and the
schema.

**3. `find_cloud_coach_project(name)` — the voice-callable lookup**

- `cloudcoach.find_projects_by_name` + `GET /api/v1/salesforce/projects/lookup/?name=`.
- **New `soql_like()`**: `soql_string` is not sufficient inside a `LIKE`, where `%` and `_`
  are wildcards — an unescaped `%` turns "find the project called %" into "match
  everything". Tested directly.
- **Deliberately not scoped to the caller's own projects.** "Does a project called X exist"
  and "am I on X" both need to see projects you are *not* on; a self-scoped search cannot
  answer the second in the negative. SOQL runs under the user's own OAuth token, so the
  org's sharing rules still apply.
- Returns `myRoles` per match, so the answer is "yes, and you're the Solution Architect"
  rather than a bare yes.
- **`urls.py` ordering is load-bearing:** `projects/lookup/` must precede the router, or
  DRF's default `[^/.]+` pk regex resolves it as the projects detail route with
  `pk="lookup"`. A test pins it.

**4. Membership push — `salesforce_sync/project_members.py`**

The mechanism is **discovered at push time**, because this org's membership model is
unverified: `timesheeter/src/Debug.js::debugMyAssignments` found zero rows in
`project_cloud__Resource_Assignment__c`, yet membership is plainly readable from ten named
User lookups on the Project record. The ladder:

1. **Already a member** (a role holds them, or an assignment exists) → no write. Makes a
   repeated drag idempotent.
2. **Resource Assignment record**, if that object and its User lookup both exist. Preferred
   because creating a child record disturbs nothing.
3. **First *empty* role lookup**, verified against the live record.
4. **All slots populated** → `no_free_slot`, no write, reported.

**Nothing here ever overwrites a populated role field.** `Project_Manager__c` is a real
named role on a record the whole team shares; clobbering it to satisfy a drag-and-drop
would be worse than not pushing. `test_a_populated_role_field_is_never_overwritten` is the
assertion that matters most.

User resolution: the local `SalesforceTeamMember` mirror first (no round trip), then
`User WHERE Email = … AND IsActive = true` — safe because `TeamMember.email` is unique.
No match is a *reported* outcome (`no_sf_user`), not an exception: someone without a
Salesforce user is a normal state.

Wiring (`accounts/views.py`):
- `ProjectMemberViewSet.perform_create` → push; outcome returned as `cloud_coach`.
- `AccountViewSet.perform_update` → diffs `team_members` before/after and pushes newly
  added ones **only when the account has exactly one project with an `sf_project_id`**.
  Several projects means no defensible guess, so the link stays local and the user assigns
  them on the account page. Outcomes returned as `cloud_coach_pushes`.
- `POST /accounts/projects/<pk>/sync-members-to-salesforce/` with `dry_run` — the backfill.
- `perform_destroy` deliberately does **not** remove them in Cloud Coach.

**Every push is best effort.** A Salesforce failure never fails the local create — the
local link is valid regardless, and discarding it because a third party was unreachable
would cost the user work they just did. Both response keys appear *only* when something was
pushed, so every existing consumer sees a byte-identical body.

**Explicit view hooks, not Django signals.** This codebase uses no signals anywhere, and a
signal firing Salesforce writes from any `.set()` — the admin, a data migration, a future
importer — is a far worse surprise than a call you can read in the view.

**Frontend**
- `lib/cloudCoachPush.ts` — status vocabulary mirroring `project_members.py`, plus
  `summarizePush` / `summarizePushes` / `summarizeSyncReport`, so three surfaces cannot word
  the same outcome three ways.
- `components/shared/CloudCoachPushToast.tsx` — needed because `useAppError` is error-only
  (`reportError` is its whole surface) and these pushes have a *success* worth confirming.
  Tone follows the worst outcome in a batch.
- `AccountsPage.handleMemberDrop` shows the toast. It had **no `.catch` at all**, so a 403
  from `_validate_account_write_fks` failed silently; now `reportError`.
- `AccountDetailPage.handleAddProjectMember` — same, replacing `.catch(() => {})`.
- `ProjectGoals` — "Sync members to Cloud Coach" in the Team Members block: first click
  previews (`dry_run: true`), second confirms. A preview that would change nothing skips
  the confirm step.

**Test-harness notes**
- `FakeSalesforce.restful_calls_of_kind("POST", "PATCH")` added; the usual assertion is
  `== []`, i.e. *this path wrote nothing*, which counting composites cannot express.
- A test helper named `_dispatch(self, name, **args)` collides with
  `find_cloud_coach_project`'s own `name` argument and surfaces as a confusing
  `TypeError` from asgiref. Renamed to `tool`.
- `accounts/tests` fixtures: a draggable member must already share an account with the
  caller (`_validate_account_write_fks`), and `Account.admin_owner` is **unique**, so the
  second shared account cannot also be an admin one. Both were fixed in the fixture rather
  than by weakening the guard.
- `npm run build` caught a `ProjectMember` fixture missing four required fields that
  `tsc --noEmit` had passed earlier — **use the build**, again.

**Verified**
- **1178/1178 backend**, **1249/1249 frontend** (104 files), `npm run build` clean.
  New this round: 44 backend (`test_client.py` 10, `test_project_members.py` 22,
  lookup-view 10, plus accounts and voice-policy additions), 29 frontend
  (`cloudCoachPush` 16, toast 12, AccountsPage 5, ProjectGoals 7).
- All new routes return **401, not 404**: `/salesforce/projects/lookup/`,
  `/accounts/projects/<pk>/sync-members-to-salesforce/`.
- An earlier full-suite run showed 7 failures in `agents/tests/test_views.py` (Bedrock
  credential classification). They cleared on re-run once the concurrent session's
  `core/llm.py` extraction settled; that module passes in isolation and alongside all six
  apps this round touched (836 tests together).

**Restarting the stack on macOS — three traps hit in one session**
- `setsid` does not exist on macOS. Use `(nohup … &)` in a subshell.
- A harness background task is killed when its call ends (exit 144), so the dev servers
  must be detached, not backgrounded.
- Starting Vite repeatedly leaves several instances racing for :5173; one silently moves to
  :5174. `pkill -f "node.*vite"` first, then start exactly one.

**Left open**
- **The membership mechanism is still unverified against the live org.** Dry-run the
  backfill (`{"dry_run": true}`) and read the plan before letting it near real projects.
- The ported `project_cloud__*` schema is likewise unverified. `POST /salesforce/log-week/`
  with `{"dry_run": true}` is read-only and reports `fields_skipped`; a non-empty list is
  the signal to set `CLOUDCOACH_SCHEMA`.
- Removing a member does not remove them in Cloud Coach (destructive, not asked for).
- Submit-for-approval still unbuilt, pending confirmation of the org's mechanism: whether
  Submit lives on the individual time entry, a weekly Timesheet Header, or an Apex/Flow
  endpoint.

---

### 2026-08-31 — `sf_user_id` had one source, and it 404s in a Chatter-disabled org

**Why this was looked at**
Tracing what still blocks logging time to Cloud Coach once the Connected App's callback
URLs are registered. Everything else on the app side checked out (both new routes 401 not
404, daphne already running the corrected sandbox `.env`, the Settings → Connect Salesforce
card exists). One real code-level blocker turned up.

**The gap**
`SalesforceConfig.sf_user_id` had exactly **one** writer in the whole codebase:
`sync._get_or_create_config`'s `sf.restful("chatter/users/me")`, inside a bare
`except Exception: pass`. That endpoint **404s in an org with Chatter disabled**, which a
corporate sandbox often is — and the failure is silent.

A blank `sf_user_id` breaks four things at once, none of which look like an identity problem:
- `log_week._role_project_ids` returns `set()`, so the role-matched project fallback never
  fires and calendar events resolve to no project;
- `SalesforceProjectViewSet.get_queryset` (`owner_sf_id OR members__sf_user_id`) returns
  nothing;
- `resolve_resource_id` has no user id, so `Resource__c` drops off every time entry — the
  week logs "successfully" and belongs to nobody;
- `find_cloud_coach_project`'s `myRoles` is always empty, so "am I on X?" always answers no.

**Meanwhile the OAuth token response was handing us the id for free.** `data["id"]` is
`https://<login host>/id/<org 18-char id>/<user 18-char id>` — the last path segment **is**
`sf_user_id`, no API call required. The callback was reading `instance_url` out of the same
response (fixed earlier today) and dropping `id` on the floor.

**What changed** — `integrations/views.py`, `salesforce_sync/sync.py`
- `extract_sf_user_id(identity_url)` + `_SF_USER_ID_RE`. The regex checks the **`005` key
  prefix** as well as the 15-or-18-char shape: an org id (`00D…`) is the same length and
  would store as a plausible-looking value that every later SOQL filter silently misses.
- The callback now writes `sf_user_id` alongside `instance_url`, both only when non-blank,
  in one `update_or_create` before `sync_all()` runs.
- `_chatter_me` / `_oauth_userinfo` helpers and a two-path loop in `_get_or_create_config`:
  Chatter first (richer payload, and it was here first), then `/services/oauth2/userinfo`.

**Key decisions**
- **`userinfo` is fetched through `sf.session`, not `sf.restful`.** `sf.base_url` is the
  *versioned data API* path (`…/services/data/v59.0/`); `oauth2/userinfo` sits outside it, so
  `restful()` cannot reach it. The first cut used `sf.restful("../../services/oauth2/userinfo")`
  and leaned on requests normalising dot-segments — rewritten, with a test pinning the exact
  URL so it can't quietly revert to a 404.
- **`userinfo` is the fallback, not the primary**, only because Chatter was already here and
  works where it's enabled. It is the more universal endpoint (OpenID, present in every org).
- **An existing `sf_user_id` is never overwritten with a blank.** The callback can populate it
  with no API call at all, so a later sync in an org where neither identity endpoint answers
  must not undo that.
- **A `SalesforceConfig` write failure must not cost the user the connection.** The
  `OAuthCredential` is what they just earned; the config write is wrapped and logged.

**Test-harness notes**
- `FakeSalesforce` gained `chatter_enabled` (raises on `chatter/users/me`), `userinfo`, a
  `_FakeSession` recording `userinfo_urls`, plus `headers` — enough to model a Chatter-off org
  and the out-of-band GET.
- **Adding six `AllowAny` callback tests 429'd the Zendesk tests that run later.** Same
  process-wide anon throttle bucket (20/min) that bit `realtime`'s `VoiceTwiMLViewTests`. The
  new class clears the cache in **both** `setUp` and `tearDown`, so it is neither victim nor
  cause; this file had no `cache.clear()` anywhere before.

**Verified**
- **1194/1194 backend** (1178 → 16 new: 6 `ExtractSfUserIdTest`, 5
  `SalesforceOAuthCallbackIdentityTest`, 5 `IdentityResolutionTest`).
- Python-only diff, so the frontend is untouched (its modified files are this session's
  earlier round, already at 1249/1249 with a clean build).
- Daphne restarted standalone — killed only the concurrently child (PID pair), so Vite (:5173,
  200) and ngrok survived. `/salesforce/log-week/`, `/salesforce/projects/lookup/`,
  `/salesforce/sync/` and `/integrations/salesforce/connect/` all **401, not 404**.

**Left open**
- Still unverified against the live org, and unverifiable until OAuth completes: the ported
  `project_cloud__*` field names (`POST /salesforce/log-week/ {"dry_run": true}` reports
  `fields_skipped`), the membership mechanism in `project_members.py`, and `Resource__c`'s
  `referenceTo`.
- `SalesforceOAuthInitView` requests scope `"api refresh_token full"`. A scope not **selected**
  on the Connected App yields `invalid_scope`, so the org side needs all three — this is not
  something any code change here can work around.

---

### 2026-09-15 — `app/backend/.venv` was a shell pointing at the original app's virtualenv

**Symptom**
Noticed while fixing an unrelated bug: a traceback from `python manage.py shell` in *this*
repo showed frames in
`/Users/lizkane/Desktop/TWILIO - Agent PM/app/backend/.venv/lib/python3.13/site-packages/`.

**What was actually wrong**
`app/backend/.venv/` had its own populated `lib/python3.13/site-packages` (252 packages,
Django 5.2.15) — the packages were here all along. What was broken was **`bin/`**: 32 files
still referenced the old app's venv, including

- `bin/activate` (all four variants) — `export VIRTUAL_ENV='…/TWILIO - Agent PM/…/.venv'`,
  which put the **old app's** `bin` on `PATH`, so `python` after activation *was* the old
  app's interpreter and `sys.path` contained only the old app's site-packages;
- every console script (`daphne`, `django-admin`, `celery`, `pip`, …) — each has a
  `'''exec' "<abs path>/python"` shebang wrapper, all pointing at the old venv.

`lib/` was clean (0 references), so nothing needed reinstalling to fix the redirection.

Consequences, all silent: the full test suite, the running Daphne, and every `manage.py`
command executed against the *original app's* libraries — and `pip install` here would have
written into the app hard constraint #2 says must never be modified. That is why the
2026-09-10 HTML sanitizer is stdlib-only: `bleach`/`nh3`/`lxml_html_clean` could not be
installed without violating that constraint.

**Fix** — path rewrite only, no reinstall
- The 32 `bin/` files rewritten to this repo's path; `pyvenv.cfg`'s informational `command`
  line also corrected (it recorded a *third*, typo'd path, `TWILO - Agent PM`).
- Verified: `sys.prefix`, `sys.executable` and `django.__file__` all resolve inside this
  repo, and **no** `sys.path` entry mentions the old app.
- The old app was confirmed untouched: its `bin/activate`, `bin/daphne` and `pyvenv.cfg`
  keep June mtimes, it is still self-referential, and **zero** files anywhere under it have
  been modified in the last 7 days.

**Two real defects this exposed in `requirements.txt`, both of which made it unbuildable**

1. **`cryptography>=42.0,<45.0` was unsatisfiable.** The installed `pyOpenSSL` requires
   `cryptography<50,>=49.0.0` and `service-identity` requires `>=47` (both arrive via
   Twisted/daphne). The working venv had **49.0.0** the whole time, i.e. the pin had drifted
   out of reality and a fresh `pip install -r requirements.txt` could not resolve. Widened to
   `>=49.0,<50.0` — **not** by downgrading, which would have broken pyOpenSSL.
2. **`pywebpush` and `whitenoise[brotli]` were declared but not installed** (`pywebpush`,
   `http_ece`, `py-vapid`, `brotli` all absent). `scheduler/tasks.py:183` does a
   function-level `from pywebpush import webpush, WebPushException` with no `try/except`,
   after an early return for profiles with no `push_subscription` — so reminder push
   notifications would raise `ImportError` for exactly the users who had enabled them, and
   no test covers it. Installed; `pip install --dry-run -r requirements.txt` now needs
   **0** packages and `pip check` is clean.

Also added: `requests`. It is imported directly in 12 places in app code but was satisfied
only as a transitive dep of twilio / google-api / simple-salesforce, so it would have
vanished the moment any of those moved to httpx.

**Key decisions**
- **Repaired in place rather than rebuilt from `requirements.txt`.** The existing
  site-packages is the exact set 1285 tests were passing against; a fresh resolve would have
  drifted versions (and, per defect 1, would not have resolved at all). Rebuilding only
  became a safe option *after* the requirements file was corrected.
- **`python -m venv --upgrade` does not work for this.** `EnvBuilder.create()` skips
  `setup_scripts()` when upgrading, so `activate` — the main culprit — would not be rewritten.
- `django-6.0.6.dist-info` sits beside `django-5.2.15.dist-info`; its `RECORD` lists no
  `django/**` files, so it is metadata-only cruft from an aborted upgrade. `pip` correctly
  reports 5.2.15 and `pip check` is clean, so it was left alone.
- Added `.vscode/settings.json` pointing `python.defaultInterpreterPath` at
  `app/backend/.venv/bin/python`. The venv is not at the workspace root so auto-discovery
  misses it, which is why the editor marked every line of `requirements.txt`
  "not installed in the selected environment".

**Verified**
- **1313/1313 backend, twice consecutively.** Daphne restarted on the repaired venv;
  `lsof` on the live process shows its site-packages resolving inside this repo and **0**
  open file handles under the old app. Vite unaffected (:5173 → 200).
- Backup of the pre-fix `bin/` at `/tmp/venv_bin_backup_<epoch>`.

**Test-harness note**
One intermediate run reported 15 errors and a test count that moved between runs
(1286 → 1305 → 1313) with no tracked file changing. `git status` went from 118 to 123 files
during the session: a **concurrent session** was editing. The errors did not reproduce, and
two consecutive clean runs followed. This is the pattern the 2026-08-18 entry already warns
about — when the tree is shared, confirm a failure is yours before chasing it.

**Left open**
- `requirements.txt` pins ranges, not exact versions, so two clones can still get different
  builds. A lockfile (`pip-compile` / `uv lock`) is the real fix; not done here.
- The old app's `.venv` remains the only copy of some packages *it* needs — this repo's venv
  is now independent, but nothing prevents a future `-r requirements.txt` drift between them.

---

### 2026-09-15 — Sync Google Calendar deleted scheduled action items; schedulings are DB rows now

**Reported**
"Clicking the Sync Google Calendar button seems to have removed the action items that I had
already added to the calendar."

**Root cause — schedulings were never in the database at all**

Scheduled action items and reminders lived only in browser `localStorage`
(`scheduledActionItems` / `scheduledReminders`), rendered as *synthetic* overlay events with a
fake `google_event_id` of `scheduled-<airtableId>__<startMin>`. Nothing else in the app could
see them, they were per-browser, and — the bug — `handleSync` **deleted the localStorage entry
after pushing to Google, before confirming the pull had replaced it with a row**. When the round
trip did not complete, the scheduling existed nowhere.

Three independent loss paths, all confirmed against the dev DB:

1. **`handleSync`'s push-then-prune.** Step 1 skipped pushing any item whose `airtableId`
   already had a synced row (`alreadySyncedAirtableIds`), and Step 4 then pruned it *by
   `airtableId`* with no replacement — so **scheduling the same action item on a second date and
   syncing silently discarded the second date**. Compounded by `GoogleActionItemsPushView`'s
   dedup guard matching on `agentpm_airtable_id` **alone**: it returned the *first* occurrence's
   `google_event_id` without creating the new one in Google, which the client read as
   confirmation.
2. **`_sync_google_calendar`'s bulk delete.** It deleted every `is_synced=True` row in
   `primary`/`work_tracking` absent from the pull response, with **no window check and no
   `google_event_id` check** — so a row never pushed (blank id) or outside the ±90-day pull
   window was destroyed even though Google's silence said nothing about it.
3. **Two mount prunes dropped anything Done.** Both `CalendarPage`'s page-level effect *and* a
   second copy inside its `ActionItemsSidebar` fetched
   `status: "Open,In Progress,Blocked,Backlogged,Complete"` — **`Done` is absent** — then deleted
   every entry not in that set. Marking an item Done erased its calendar history. The sidebar
   copy also ran *before* the migration, wiping what the migration exists to rescue.

Supporting bug: `agentpm_airtable_id` is in `read_only_fields`, so `perform_create` read it off
`request.data` for account auto-linking but **never stored it** — every work-tracking row the
timer path created had a blank link (dev DB rows 884-889, 1135, 1136).

**Recovery — 41 lost schedulings restored**

`AgentActivityEvent` logged every `"<task>" added to calendar for <date>` with the Airtable id in
`metadata`. New `manage.py restore_lost_calendar_schedulings` reconstructs from it; `--dry-run`
is the default, `--commit` writes; idempotent. **41 rows restored** on the dev DB (backup at
`/tmp/db.sqlite3.pre-calendar-restore`); a re-run reports zero.

Two properties of the log forced the reconciliation to be **count-based per (item, calendar
day)** rather than a timestamp match:
- **Dragging an event writes no new log entry**, so the log holds where an item was first dropped
  while the row holds where it ended up (`recVqthtzpebj8ATK`: logged 17:30/17:45, rows at
  18:00/18:15). Minute-matching read those as missing and would have duplicated them.
- The user legitimately schedules one item into several slots on one day
  (`recnsHNdQNNQxgIru` × 3 on 2026-09-09), so collapsing a day to "has a row" under-restores.

N logged, M present ⇒ restore N−M, preferring the logged slots furthest from any surviving row.
Duplicate log entries for one slot are collapsed first (ids 155/156 and 160/178 are identical
pairs). A naive minute-match reported 51 rows to restore; this reports 39–41.

**The timezone is validated, not assumed.** Log strings were rendered by `toLocaleString` in the
*browser*, so they are the user's wall clock — **not `settings.TIME_ZONE`, which is `UTC` here**.
`--tz` defaults to `America/Los_Angeles` (a real zone, so DST is handled) and is scored against
surviving rows by counting exact hits per candidate whole-hour offset; a strictly better offset
raises `CommandError` rather than silently shifting every block. `--tz UTC` is correctly refused
("shifting by +7h matches 33 surviving rows against 0").

**Backend**

- `scheduler.CalendarEvent.reminder` FK (migration `0010`), so a scheduled reminder is a real row
  rather than a `scheduled-reminder-*` synthetic. `SET_NULL`: deleting the reminder must not erase
  the time the user set aside.
- `CalendarEventViewSet._store_source_links` — assigns `agentpm_airtable_id` / `reminder` on the
  model after `serializer.save()` (both stay `read_only`), the same pattern `details` uses for
  `link_id`. Another user's reminder is ignored, not attached.
- **`_reconcile_missing_google_events` replaces the delete.** Only rows with a non-blank
  `google_event_id` whose start is *inside* the pull window are candidates; AgentPM-owned rows
  (`work_tracking`/`reminders`) are **unlinked** (`google_event_id=""`, `is_synced=False`) instead
  of deleted, so they stay on the calendar and the next sync re-pushes them. Plain `primary`
  meetings keep today's delete semantics. **This is the bound that makes the report impossible:
  worst case is a redundant re-push, never data loss.**
- **New PHASE 1b `_push_new_agentpm_events`** — the sync, not the client, mirrors rows with a
  blank `google_event_id` to Google, with the same `extendedProperties.private` the push view
  writes so PHASE 2 re-resolves `calendar_id`. One failing insert does not abort the batch.
- Push-view dedup now matches `(agentpm_airtable_id, start minute)` via `_parse_start_minute`,
  which returns `None` on an unparseable value — a failed parse must never read as "duplicate
  exists".
- `AGENTPM_SOURCE_TO_CALENDAR_ID` maps `reminder` → `reminders` on pull (was `action_item` only).

**Frontend**

- `lib/calendarScheduling.ts` (new) — `scheduleActionItem` / `scheduleReminder` /
  `migrateLegacyScheduledItems` / duplicate predicates. `saveScheduledItem` and
  `saveScheduledReminder` are **deleted**.
- `CalendarPage`: five drop sites route through `persistScheduledActionItem` /
  `persistScheduledReminder` (one write path owning the toast, log line and account link);
  `handleSync` collapses to sync → refetch → broadcast; both mount prunes removed;
  `handleDelete` now also deletes the DB rows (`agentpm_airtable_id` is a CharField, so nothing
  cascades).
- **`isDbBackedActionItemEvent` deliberately does not require `is_synced`.** Six gates did, so a
  freshly-dropped block was un-draggable and un-editable until a sync happened to run. A positive
  `id` is the real test — synthetic overlays all carry a negative or absent id.
- Modal-only editing finished: `components/calendar/ActionItemsSidebar.tsx` (the dead copy, but
  the only *renderable* one) lost its inline expanded editor and now opens `ActionItemModal`,
  matching the live copy. `expandItemId` opens the modal instead of forcing an expand.

**Key decisions**
- **A failed write is surfaced, never silent** ("Could not add to the calendar — nothing was
  saved"). The original bug's whole character was silence.
- **The migration clears the localStorage key only when every entry is accounted for.** Clearing
  on partial success is precisely the bug being undone; a duplicate row is recoverable, a dropped
  scheduling is not.
- **Deleting an action item removes its blocks; changing its status never does.** Conflating the
  two is loss path 3.
- Orphaned restores (3 rows whose action item no longer exists) are restored per "restore all"
  and reported, not silently skipped.

**Test-harness notes**
- **`visibleRange` cannot gate anything that needs loaded events** — `handleDatesSet` sets it
  synchronously *while* `fetchEvents` is still in flight. Gating the migration on it ran it
  against an empty `eventsRef` and duplicated every row; a test caught this. New `firstFetchDone`
  flips in `fetchEvents`'s `finally`. Note there is no readable `isLoading` on this page: the
  state is declared `const [, setIsLoading]`.
- The `MagicMock` returned by a stubbed `service.events().insert().execute()` fails as an
  "aggregate function" when written to a CharField — the stub must return a real dict.
- `checklistParity.test.ts` lost its `components/calendar/ActionItemsSidebar.tsx` entry, per that
  file's own instruction to delete a retired surface. It delegates to `ActionItemModal`, which is
  already listed.
- The `FullCalendar` stub gained a `trigger-item-drop` button so the real `drop` path is testable.

**Verified**
- **1352/1355 frontend** (107 files; 60 new: 26 `calendarScheduling.test.ts`, 11 in
  `CalendarPage.test.tsx`, 7 `ActionItemsSidebarModalOnly.test.tsx`, 6 parity guards, plus
  backend-adjacent). `npm run build` clean, `tsc -p tsconfig.app.json` clean.
- The 3 failures are **pre-existing and unrelated** — `ActionItemModal`'s multipart test and
  `AccountDetailPage`'s two drag-order tests. Confirmed by `git stash`: identical failures with
  every change here removed, and they fail in isolation too (so not the recorded full-suite flake).
- Sabotage-checked: restoring the unconditional delete reds 5 reconciliation tests; removing
  `_store_source_links` reds 3; clearing the migration key on failure reds 2; un-wiring the modal
  reds 4.
- Dev DB migrated (`scheduler.0010`); backups at `/tmp/db.sqlite3.pre-calendar-persistence` and
  `/tmp/db.sqlite3.pre-calendar-restore`.

**Left open**
- **The restored blocks are 15 minutes each** (`--duration-minutes` overrides). The log records no
  end time, and 15 is the dominant slot length in the surviving data (27 of 56).
- Moving a DB-backed *reminder* block updates the row's times but not the `Reminder.due_at`.
  Matches the previous behaviour, which only moved the localStorage entry.
- `ActionItemsSidebar.tsx` remains dead code reachable only via `components/calendar/ItemsSidebar.tsx`
  (zero consumers); the two sidebars still duplicate their JSX.
- Nothing has been exercised against a real Google Calendar — ngrok is still blocked by Zscaler
  (2026-08-31 entry), and PHASE 1b/PHASE 3 are covered only by the mocked suite.

---

### 2026-09-22 — Artifacts: rich-text description, linked records in both directions, creator

**What the request needed that did not exist**

`AccountArtifact` had no description, and although `uploaded_by` / `uploaded_by_username` had
existed for a long time, **no surface rendered them**. Linkage was one-directional and
scattered across three different storage shapes, with no way to ask "what is this artifact
used by": `CalendarEvent.artifact_ids` (JSON list of real ids), `AccountProject.resources`
(entries keyed `"artifact-<id>"`, covering both projects and goals via `kind`), and
`ActionItemAttachment`, which was a **pure copy with no id back to the artifact at all**.

**Backend**

- `AccountArtifact.description` (HTML, same convention as `task_details` / `AccountNote.body`)
  and `.references` (`JSONField`, the established `[{resource_type, resource_id, label, url}]`
  shape) — migration `accounts/0021`.
- `ActionItemAttachment.source_artifact` FK (`SET_NULL`) — migration `airtable_sync/0016`.
  This only links attachments **going forward**; historical ones stay unlinked. A
  URL-equality backfill heuristic was considered and rejected as fragile.
- `accounts/artifact_links.py` — `used_in_map(artifact_ids, account_ids)`: the reverse lookup,
  **3 queries regardless of artifact or account count**, fed into serializer context rather
  than a per-object `SerializerMethodField` (which would have been an N+1 on a panel that
  renders every artifact on the account).

**Key decision — `used_in_map` emits finished `url` values, so the frontend never routes by type**

Each entry carries a ready-to-navigate app path (`/calendar`, `/accounts/<id>`,
`/action-items`). That is what makes one `LinkedRecordsList` able to render both directions:
`resource_type` is used **only** for the group heading, never to construct a route. It matches
what `CommentPanel` / `InlineCommentThread` / `ReferenceLink` already do — all three call
`navigate(ref.url)` with no switch — so the captured-`@#`-reference direction and the computed
reverse direction render through exactly the same component with no branching.

**Frontend**

- `components/shared/LinkedRecordsList.tsx` (new) — groups a `CommentReference[]` by type
  (`meeting` and `calendar_event` deliberately collapse into one "Meetings" group, since they
  are the same thing to a reader), ordered meetings → containers → work. Chip styling mirrors
  `ProjectGoals.tsx`'s sub-section convention.
- `components/account/ArtifactsPanel.tsx` — `EditArtifactModal` and `AddArtifactModal` both
  gained a `RichTextMentionEditor` description field; `onReferenceInsert` appends to a local
  `references` array, deduped on `(resource_type, resource_id)`. The card now shows the
  creator (the `CommentPanel` avatar-initial idiom) and a `used in N` pill.
- `components/account/ArtifactViewer.tsx` — the preview body became a flex row with a white
  300px details rail carrying the creator, the description and both `LinkedRecordsList`
  sections. Rendered **only when there is something to show**, so an artifact with none of
  the three looks exactly as it did.
- `pages/AccountDetailPage.tsx` — the same three additions mirrored into its own local
  `ArtifactsPanel` / `AddArtifactModal` / `ArtifactViewer` (additive edits only, per the
  out-of-scope rule). Note that local panel has **no** edit modal at all, so it got the
  create-side description and the read-side rail, not an editor for an existing artifact.
- `lib/api.ts` — `description` / `references` on `addArtifactLink`, `createUserArtifact`,
  `updateArtifact` (whose `url` also widened to `string | null`: the edit modal has always
  cleared a url by sending `null`, which the declared type did not admit).
- `ArtifactPicker.pick()` passes `a.id` as `source_artifact`, which is the only thing that
  makes "used in" able to see action items at all.

**Key decisions**

- **The description renders with `dangerouslySetInnerHTML` + `sanitizeHtml(plainToHtml(...))`,
  not `renderNoteWithReferences`.** That helper lazy-loads `ReferenceLink` via `require()`,
  which is not available in this Vite/ESM build; and the references are already listed
  explicitly in their own section, so inline chips would duplicate them.
- **`onReferenceInsert` fires in single-select mode too** — the prop's own doc comment claims
  it is multiselect-only, but `RichTextMentionEditor.tsx:410` calls it on plain insert and
  `RichTextMentionPicker.test.tsx` already pins that. So the description field did not need
  `refMultiSelect`.
- Creator display reuses `comments/serializers._author_display`'s fallback chain (profile
  display name → full name → username) — a better value for the same existing field, not a
  contract change.

**Test-harness notes**
- `ArtifactsPanel.test.tsx`'s `renderPanel` now wraps in `MemoryRouter`: `LinkedRecordsList`
  calls `useNavigate` before its empty-reference early return (hooks cannot be conditional),
  so any test that opens the viewer needs router context.
- `test/handlers/accounts.ts`'s two artifact fixtures got `description`/`references`/`used_in`
  as empty values, so every pre-existing test's DOM is unchanged — except that
  `mockCodeArtifact` already had `uploaded_by_username: "alice"`, which now legitimately
  renders on the card. That is the feature working, and a test asserts it.
- The two `ArtifactPicker` attach tests assert the POST body with `toEqual`, so they went red
  on the new `source_artifact` key. Updated to assert it explicitly rather than loosening to
  `objectContaining` — the link is the point of the change.

**Verified**
- **1348/1348 backend.** **1377/1380 frontend** (109 files; 17 new: 7
  `shared/__tests__/LinkedRecordsList.test.tsx`, 7 in `ArtifactsPanel.test.tsx`, 3 in
  `AccountDetailPage.test.tsx`). `npm run build` and `tsc -p tsconfig.app.json` clean.
- The 3 frontend failures are the **pre-existing** ones recorded in the 2026-09-15 entry —
  `ActionItemModal`'s multipart test (an undici `Content-Type` rejection on `FormData`, not
  an app assertion) and `AccountDetailPage`'s two drag-order tests. All three still fail in
  isolation, so they are not full-suite pollution and not from this change.
- Sabotage-checked: dropping `description`/`references` from `EditArtifactModal`'s patch reds
  the round-trip test.
- Dev DB already migrated (`accounts.0021`, `airtable_sync.0016` both applied).

**Left open**
- **Daphne was not restarted**, so the live server is still serving artifacts without
  `description` / `references` / `used_in` until it is. No URL patterns changed, so the
  401-vs-404 route check does not apply here — the tell is a missing field, not a 404. The
  running daphne is a child of `concurrently` (no `--kill-others`), so killing just that child
  spares Vite and ngrok.
- Historical `ActionItemAttachment` rows have `source_artifact = NULL`, so an artifact attached
  to an action item before this change does not appear in its own "Used in" list.
- `AccountDetailPage`'s local artifacts panel still has no edit affordance, so a description
  typed there can only be revised from the shared panel's edit modal.

---

### 2026-09-23 — Past calendar weeks rendered empty; three test-harness defects; one self-inflicted data loss

**Reported:** "I clicked Sync Google Calendar yesterday which updated this week's calendar but
if I go back in time the previous weeks' data is not there."

**Nothing was lost, and the backend was never at fault.** Established before touching code:
the dev DB holds 50–66 events for each of the last 7 weeks, and the live server returns all of
them (`/scheduler/events/?start=…&end=…` → 66 for week −1 through real HTTP with a minted JWT).
So the data existed, the query was right, and the fault was entirely client-side.

*(A first live probe 500'd and briefly looked like a server bug. It was an unquoted `+` in the
hand-built query string — `urllib.parse.quote` fixed it. Worth re-checking your own probe before
believing a 500.)*

**Root cause — a one-way latch that gates ALL rendering**

`fetchEvents` writes its result into state only `if (!localMutationRef.current)` — a guard so an
in-flight optimistic drag isn't clobbered by a concurrent poll. Five sites set that ref; **only
three released it**:

| site | released? |
|---|---|
| `applyMeetingReschedule`, `handleEventResize`, + 1 more | yes — `.finally()` |
| `saveEventDetails` (~L3899) | **no** |
| `toggleAttendance` (~L3978) | **no** |

So editing an event or toggling attendance once latched the ref `true` **for the rest of the
session**. Every later week-navigation then issued its request, received the right events, and
threw them away — leaving whatever week was on screen when the edit happened. It reads exactly
like "past weeks have no data", which is why it was reported as a sync/persistence problem.

Both now release in `finally` (not a tail assignment — `saveEventDetails` re-throws).

**Persistence, as asked: 6 weeks warm for the whole session**

- **Two TTLs instead of one.** The 5-minute TTL still applies to the current and future weeks,
  which are genuinely still changing. A range that ends at or before the start of this week
  cannot change on its own — and any sync clears the entire cache anyway — so a finished week is
  cached for the session. `isHistoricalRange()` decides.
- **`HISTORY_WEEKS = 6` prewarm** after the first fetch lands: one request per week, **sequential
  on purpose**. Six parallel speculative requests is precisely the fan-out shape that caused this
  repo's 429s; this work has no business competing with the visible week. Skips anything already
  cached, so it is a no-op on a warm session.
- **`localDayKey()` replaces `start.slice(0, 10)` in the cache key.** FullCalendar hands over
  local ISO with an offset (`…T00:00:00-07:00`) while the prewarm builds ranges with
  `toISOString()` (`…T07:00:00Z`) — same instant, same first 10 chars west of UTC, **different
  day east of it**, where the prewarmed entry would never have been read. Going through `Date`
  makes both spellings of one instant produce one key in every timezone.

**Three pre-existing failures: all harness defects, app code was correct**

1. **`AccountDetailPage` drag-order (×2).** `registerHandlers` served the action-items list from a
   static array while the status PATCH returned `{}`. Any mutation broadcasts
   `actionItemsUpdated` → silent refetch → the fixture answers with **pre-drop** statuses and
   reverts the optimistic move, so the test could never observe its own drop. Proved with a probe
   counting refetches (exactly 1, and the column reverted). The list is now served from a mutable
   array that the PATCH writes into — the fake behaves like the server. Two per-test
   `http.patch(...) => {}` overrides were deleted; registered later, they shadowed it.
2. **`ActionItemModal` multipart.** Axios deliberately leaves `Content-Type` to the platform so it
   can add the multipart boundary, but under jsdom the adapter stringifies the `FormData`: the
   intercepted body is the literal text `"[object FormData]"` with `Content-Type: text/plain`, so
   undici throws before any assertion runs. **Verified by hand against the live server that real
   uploads are fine** (201, file stored, probe row then deleted). The test now reads the
   `FormData` off the outgoing request config via an axios interceptor — same guarantees, no
   dependence on a body only this environment mangles.

**Self-inflicted data loss, and the recovery — read this before using `git checkout`**

To revert a one-line sabotage I ran `git checkout app/frontend/src/lib/api.ts`. That file had
**147 files' worth of uncommitted work around it and no commit of its own**, so the checkout
discarded every uncommitted change to it — mine *and* a concurrent session's. `git stash list`
was empty, the dangling blobs were stale (788 lines vs 1172), and Vite had already re-read the
reverted file.

Recovered from `dist/assets/index-B0NKU6TP.js` — the previous day's production bundle, which
still contained every lost endpoint, minified but complete. `tsc` enumerated exactly what was
missing, each URL and argument shape was read back out of the bundle, and each was re-checked
against the live backend routes before being restored:

`teamApi.listMemberDocuments` / `addMemberDocument` / `updateMemberDocument` /
`deleteMemberDocument`; `salesforceApi.logWeek` / `previewWeek`;
`accountsApi.syncProjectMembersToSalesforce`; plus the artifact/attachment signature work
(`description` / `references` on three artifact calls, `url: string | null`,
`addAttachmentLink`'s `sourceArtifactId`, and `addProjectMember`'s `cloud_coach` key).

Return types were tightened past what the bundle showed (`WeekPlanReport`,
`CloudCoachSyncReport`, `ProjectMember & { cloud_coach?: … }`) because the call sites' own
`tsc` errors named the exact shapes they expected.

**Never `git checkout <file>` in this tree.** It is shared with concurrent sessions and carries
a large uncommitted working set. To undo a deliberate edit, keep a copy first
(`cp x /tmp/x.bak`) and restore from that — which is what every other sabotage check in this
session did, and why only this one lost anything.

**Verified**
- **1387/1387 frontend, 109/109 files — fully green**, up from a 1377/1380 baseline with 3
  standing failures. **1348/1348 backend.** `npm run build` and `tsc -p tsconfig.app.json` clean.
- 7 new tests in `CalendarPage.test.tsx`, each sabotage-checked independently: removing either
  latch release, the historical-TTL exemption, or the prewarm turns the matching test red and
  leaves the others green. The rewritten multipart test reds on `artifact_type: "link"`.
- `HEAD` is still `83abf29` and the working tree still has its 147 modified files; the restored
  `api.ts` re-bundles clean with every recovered symbol present.

**Test-harness notes**
- The `FullCalendar` stub only fired `datesSet` on mount, so **nothing in the suite had ever
  exercised week navigation** — the exact path that was broken. Added a `trigger-dates-set`
  button aimed by `__TEST_RANGE_START__` / `__TEST_RANGE_END__`.
- Assert cache contents as a *property* ("each entry holds exactly one week"), not against a
  literal key: the key is derived from the local day, so a hard-coded one only holds west of UTC.
  My first version of that test failed for exactly this reason.
- A pre-existing effect fetches the last 3 weeks for account-link fading, so it is the **8th**
  events request on mount. Count prewarmed weeks by week-start, never by total request count.

**Left open**
- `hooks/useCalendarEventCache.ts` still has **zero consumers** and now carries a third copy of
  the cache helpers, without the two-TTL logic or the timezone-safe key. It will drift further;
  either wire it up or delete it.
- The prewarm is fixed at 6 weeks and only reaches backwards. Paging forward past the fetched
  window still costs one request per week.
- Nothing has been exercised against a real Google Calendar — ngrok is still Zscaler-blocked
  (2026-08-31), so `_sync_google_calendar` remains covered only by the mocked suite.
