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
- **Shared package:** `twilio-agent-pm-shared` (aliased in vitest and vite configs)
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

# Backend tests
source "/Users/lizkane/Desktop/TWILIO - Agent PM/app/backend/.venv/bin/activate"
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
- **Scope is every meeting the user can see**, not the account being viewed. Visibility is
  the union of team-member accounts *and* meetings linked to calendar events the user owns
  — either clause alone drops real meetings (1:1s and internal calls have no account).
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

**Verified**
- 531/531 backend (68 new), 699/699 frontend (34 new).
- `tsc -p tsconfig.app.json` reports **zero** errors in any file touched here.
  `npm run build` is currently red on `CalendarPage.tsx` / `ActionItemsSidebar.tsx` — a
  concurrent session's in-flight `StepsPanel` insertion referencing an out-of-scope `item`.
- Dev DB migrated; backup at `/tmp/db.sqlite3.pre-meeting-notes`.

**Left open**
- `AccountMeetingNotesFeed` renders `meeting.gong_notes` only and has no source toggle. It
  still has zero consumers, so it was left alone.
- `MeetingDetail.tsx:2373` shows `match.gong_notes` with no Zoom fallback.

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
