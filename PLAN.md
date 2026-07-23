# PLAN.md — Structural Reorg Pass-by-Pass Plan

Source app: `/Users/lizkane/Desktop/TWILIO - Agent PM`  
New copy: current directory (to be established in Prompt 2)  
Framework: React/TypeScript (Vite) frontend, Django/DRF backend — unchanged.  
Risks from the audit are called out inline under each pass.

---

## Pass 0 — Scaffold

**Scope:** Infrastructure setup only. No page migration. No behavior change. The app must build and run identically after this pass.

### Frontend

1. **Install test tooling** (devDependencies only — no runtime impact):
   - `vitest`, `@vitest/coverage-v8`
   - `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`
   - `msw` (Mock Service Worker v2)
   - `happy-dom` (test environment)
   - Add `vitest.config.ts` (or extend `vite.config.ts`) with `environment: 'happy-dom'` and `setupFiles: ['./src/test/setup.ts']`
   - Add `src/test/setup.ts` (RTL `cleanup`, msw server start/reset/stop, `@testing-library/jest-dom` matchers)
   - Add `"test": "vitest"` and `"test:coverage": "vitest run --coverage"` to `package.json` scripts.

2. **Create `src/hooks/useResource.ts`** — the shared hook (see HOOK_SPEC.md for exact signature).

3. **Move misplaced hooks:**
   - `lib/useConvert.ts` → `hooks/useConvert.ts`
   - `lib/useLogGlow.ts` → `hooks/useLogGlow.ts`
   - Update all import paths in any files that imported from `lib/`.

4. **Rename asset folder:**
   - `assets/Lucidchart Assets/` → `assets/lucidchart-assets/`
   - Update every SVG import path in the frontend that references the old name.
   - _Risk:_ There may be 70+ SVG files; grep for `Lucidchart Assets` before replacing.

5. **Resolve `pages/EditPreviewPage.tsx`:**
   - Read the file (5 lines). If it is a pure passthrough render of another component or page, remove the file and update the route in `App.tsx` to point directly at the wrapped component. If it carries any logic, inline that logic into the target component.

6. **Establish the type-split pattern:**
   - Create `types/scheduler.ts` as a stub with the comment `// Populated during Pass 1`. This validates the import plumbing before Pass 1 needs it.
   - `types/index.ts` is NOT modified yet; stubs just need to exist so the pattern is proven.

### Backend

7. **Centralize `_staff_sees_all`:**
   - The canonical implementation is already in `core/mixins.py` (line 15). It is the correct one.
   - In `accounts/views.py`: delete the local `_staff_sees_all` function definition (currently at line 7), add `from core.mixins import _staff_sees_all` to imports.
   - In `team/views.py`: same (currently at line 11).
   - In `airtable_sync/views.py`: same (currently at line 7).
   - Update the docstring comment in `core/mixins.py` to remove the "duplicated — intentionally not fixed" language.
   - _Risk:_ Circular import. `core/mixins.py` uses lazy imports (inside method bodies) to avoid cycles. `accounts/views.py` importing from `core.mixins` is a one-way dependency and is safe. Verify no new cycle with a quick `python -c "import accounts.views"` after the change.

### Tests for Pass 0

**Frontend — `src/hooks/__tests__/useResource.test.ts`:**
- Happy path: fetcher resolves, `data` populated, `loading` false after resolution.
- Loading state: `loading` is true while fetcher is pending.
- Error state: fetcher rejects → `error` set, `data` empty, `loading` false.
- Refetch: calling `refetch()` re-runs the fetcher, clears error, re-sets loading.
- Deps: changing a dep value triggers a new fetch.
- Multiple rapid dep changes: only the last fetch result is applied (stale closure protection via cancellation flag or ref).

**Backend — `core/tests/test_mixins.py`:**
- `_staff_sees_all`: returns `True` for `is_staff=True` + `profile.staff_view_override=True`; `False` for `is_staff=True` + `override=False`; `False` for `is_staff=False`; `True` when `is_staff=True` and no profile object at all.
- `RequireAccountMembershipMixin.perform_create`: raises `PermissionDenied` when caller is not a team member or admin on the account; allows when they are; allows unconditionally for staff.
- `RequireAccountMembershipMixin.perform_update`: same for update.
- `RequireCalendarEventOwnershipMixin.perform_create`: raises `PermissionDenied` when caller is not event owner or account member; allows owner; allows account team member; allows staff.
- `RequireCalendarEventOwnershipMixin.perform_update`: same.

A pass is not complete until `vitest run` and `python manage.py test core` both exit 0.

---

## Pass 1 — RemindersPage

**Scope:** Extract Reminders CRUD into a hook. Thin the page. Split Reminder types out of `types/index.ts`.

### Frontend

1. **Create `src/hooks/useReminders.ts`** built on `useResource<T>`:
   - Wraps `schedulerApi.listReminders(params)` — pass filter params (the `tab` filter) as a dep.
   - Exposes mutations: `createReminder(payload)`, `updateReminder(id, payload)`, `deleteReminder(id)`, `dismissReminder(id)`. Each mutation calls `refetch()` on success.
   - Returns `{ data, loading, error, refetch, createReminder, updateReminder, deleteReminder, dismissReminder }`.

2. **Move types** to `types/scheduler.ts`: `Reminder`, `ReminderPayload` (or equivalent create/update DTOs), any enums specific to reminders.

3. **Thin `RemindersPage.tsx`:**
   - Remove the inline `useEffect`/`useState` fetch block (lines 73–96 in the original).
   - Replace with `const { data: reminders, loading, createReminder, ... } = useReminders({ tab })`.
   - Page retains only UI state: `tab`, `showForm`, `form`, `saving`, `editId`, `voiceText`.
   - _Risk:_ The `voiceText` state feeds into the Twilio Voice SDK path. Leave the voice-input wiring in the page component; `useReminders` only handles the REST CRUD.

### Backend — `scheduler/` app (ReminderViewSet)

4. Verify `get_queryset` scopes by owner (non-staff sees only their own reminders). Add the import `from core.mixins import _staff_sees_all` if not already using it from the scaffold pass.
5. Write `scheduler/tests/test_views.py` — `ReminderViewSet`:
   - Staff user: `GET /api/reminders/` returns all reminders.
   - Non-staff user: `GET /api/reminders/` returns only their own.
   - `POST /api/reminders/` creates with correct owner.
   - `PATCH /api/reminders/{id}/` — owner can update, non-owner 403/404.
   - `DELETE /api/reminders/{id}/` — owner can delete, non-owner 403/404.
   - `POST /api/reminders/{id}/dismiss/` (or `PATCH` with `dismissed: true`) — works for owner.

### Tests for Pass 1

**Frontend — `src/hooks/__tests__/useReminders.test.ts`:**
- Happy path list loads on mount.
- `createReminder` calls the API and triggers refetch.
- `updateReminder` calls the API and triggers refetch.
- `deleteReminder` calls the API and triggers refetch.
- `dismissReminder` calls the API and triggers refetch.
- Error state when API is down.

**Frontend — `src/pages/__tests__/RemindersPage.test.tsx`:**
- Renders skeleton/spinner when `loading=true`.
- Renders empty-state message when `data=[]`.
- Renders reminder list items when `data` is populated.
- Clicking "Delete" on a reminder calls `deleteReminder` with correct id.
- Submitting the create form calls `createReminder` with form values.
- API layer mocked via msw; hook state driven by msw handler responses.

A pass is not complete until all automated tests pass AND the smoke checklist (SMOKE_TESTS.md Pass 1) is verified.

---

## Pass 2 — TeamPage

**Scope:** Extract TeamMember/UserProfile CRUD into a hook. Thin the page. Split team types.

### Frontend

1. **Create `src/hooks/useTeam.ts`** built on `useResource<T>`:
   - Wraps `teamApi.listMembers()` (or equivalent from `lib/api.ts`).
   - Exposes mutations appropriate to what TeamPage currently does — at minimum `updateTeamMember(id, payload)`. Check page source for any create/invite/remove flows.
   - Returns `{ data, loading, error, refetch, ...mutations }`.

2. **Move types** to `types/team.ts`: `TeamMember`, `UserProfile`, any team-specific DTOs or enums.

3. **Thin `TeamPage.tsx`** (1,192 lines):
   - Remove inline fetch blocks.
   - Use `useTeam()` for data.
   - Page retains only UI state (selected member, modal open, filter/search text, etc.).
   - _Risk:_ TeamPage may have local sort/filter state derived from the fetched list. Keep that in the page; the hook provides the raw list.

### Backend — `team/` app

4. Write `team/tests/test_views.py` covering list and any write endpoints for TeamMember; verify `_staff_sees_all` scoping (staff sees all teams, member sees own team members).

### Tests for Pass 2

- `src/hooks/__tests__/useTeam.test.ts`: happy path, loading, error, refetch, mutations.
- `src/pages/__tests__/TeamPage.test.tsx`: loading/empty/populated states, interaction → hook call.
- `app/backend/team/tests/test_views.py`: permission scoping for list and writes.

---

## Pass 3 — DiscoverPage

**Scope:** Extract DiscoverApplet CRUD. Page fetches from both `discoverApi` and `teamApi` — `useTeam` from Pass 2 handles the team data; a new `useDiscover` handles applets.

### Frontend

1. **Create `src/hooks/useDiscover.ts`** built on `useResource<T>`:
   - Wraps `discoverApi.listApplets()`.
   - Mutations: `createApplet(payload)`, `updateApplet(id, payload)`, `deleteApplet(id)`.

2. **Move types** to `types/discover.ts`: `DiscoverApplet`, `AppletCategory`, `ItemType`, `UrlStatus`.

3. **Thin `DiscoverPage.tsx`** (753 lines):
   - Replace the inline `items`/`loading`/`members` state blocks (lines 446–448) with `useDiscover()` and `useTeam()`.
   - Page retains only UI state: `showForm`, `editingItem`, form field state.
   - _Risk:_ The `author` field defaults to the current user's name. That data comes from `CurrentUserContext`, which is preserved as-is — the page can still read it from context to prepopulate the form.

### Backend — `discover/` app

4. Write `discover/tests/test_views.py` covering AppletViewSet: list (any authenticated user), create/update/delete (submitter-only or staff), permission enforcement on write.

### Tests for Pass 3

- `src/hooks/__tests__/useDiscover.test.ts`: happy path, mutations.
- `src/pages/__tests__/DiscoverPage.test.tsx`: loading/populated/empty, create form, edit form, delete.
- `app/backend/discover/tests/test_views.py`: permission scoping.

---

## Pass 4 — LogsPage

**Scope:** LogsPage is read-only across 5 data sources. Extract each into a hook (reuse from prior passes where possible).

### Frontend

LogsPage imports: `schedulerApi, commentsApi, feedbackApi, agentApi, skillsApi`. It renders at least 5 discrete log sections, each with its own loading state.

1. **Reuse `useReminders`** (Pass 1) for the reminders log section.
2. **`useComments` already exists** in `components/comments/useComments.ts` — use as-is. Do not migrate it here; it is cross-cutting.
3. **Create `src/hooks/useFeedbackItems.ts`** built on `useResource<T>`:
   - Wraps `feedbackApi.list()`.
   - Read-only (no mutations needed for LogsPage).
4. **Create `src/hooks/useAgentSessions.ts`** built on `useResource<T>`:
   - Wraps `agentApi.listSessions()` and/or `skillsApi.listSkills()` as needed.
   - Read-only.
5. **For CalendarEvents in LogsPage** (if the log section is date-ranged): create a simple `useCalendarEvents(params)` built on `useResource<T>` wrapping `schedulerApi.listEvents(params)`.
6. **Move types:**
   - `types/agents.ts`: `AgentSession`, `AgentMessage`, `AgentSkill`, `SkillInvocation`, `LogEntry`.
   - `types/feedback.ts`: `FeedbackItem`.
   - `types/scheduler.ts` already has CalendarEvent from Pass 1 (add if not already there).
7. **Thin `LogsPage.tsx`** (648 lines):
   - Replace each inline fetch block with the appropriate hook call.
   - Page retains only UI state (selected log entry, date range pickers, filter state).
   - _Risk:_ LogsPage uses a local `getLogs()` call (line 431: `useState<LogEntry[]>(() => getLogs())`). This appears to read from `appLog.ts` (a local in-memory log) — do not route this through a hook; keep it as-is since it's not an API call.

### Backend — `agents/` and `feedback/` apps

8. Write `agents/tests/test_views.py`: AgentSession list, permission scoping.
9. Write `feedback/tests/test_views.py`: FeedbackItem list, permission scoping.

### Tests for Pass 4

- `src/hooks/__tests__/useFeedbackItems.test.ts`: happy path, loading, error.
- `src/hooks/__tests__/useAgentSessions.test.ts`: happy path, loading, error.
- `src/pages/__tests__/LogsPage.test.tsx`: each log section renders loading/populated/error state; interactions (if any) trigger correct hook calls.
- `app/backend/agents/tests/test_views.py`: list with permission scoping.
- `app/backend/feedback/tests/test_views.py`: list with permission scoping.

---

## Out of Scope (do not attempt)

| Area | Reason |
|---|---|
| `AccountDetailPage.tsx` (7,230 lines) | ~14 entity types, ~30 inlined sub-components. Deserves its own dedicated design effort. |
| `CalendarPage.tsx` (5,549 lines) | Real-time WebSocket + Google Calendar OAuth + Salesforce sync. Multiple async state sources. |
| `ActionItemsPage.tsx` — local-draft optimistic-ID flow | The `local-*` prefix optimistic ID protocol spans render, sync, and Airtable write-back. Doesn't fit a standard useResource pattern. |
| `MeetingDetail.tsx` WebSocket code | Real-time collab is standalone; not a clean service boundary. |
| `useComments` refactor | Cross-cutting; outside the scope of these 5 passes. |
| `useCanvasState` / `PageBuilder` | Complex undo/redo canvas state; separate effort. |

---

## Completion criteria (all passes)

- `vitest run` exits 0 with no skipped tests.
- `python manage.py test` exits 0.
- `npm run build` produces no TypeScript errors.
- Each smoke-test checklist in SMOKE_TESTS.md is manually verified.
- No API contracts changed (same routes, same request/response shapes, same auth behavior).
- No visible UI/UX changes.
