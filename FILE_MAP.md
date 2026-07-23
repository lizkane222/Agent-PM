# FILE_MAP.md — Old Path → New Path

Paths are relative to the app root (`app/`). Source is `/Users/lizkane/Desktop/TWILIO - Agent PM/app/`. Destination is the new repo's `app/` directory.

Legend:
- **MOVED** — same content, new location; all imports updated
- **THINNED** — file kept but inline data-fetch code removed; hook call added
- **SPLIT FROM** — types extracted from this file into a new per-domain file
- **DELETED** — file removed (route/import updated)
- **NEW** — does not exist in the source app
- **MODIFIED** — in-place change (import path update or code deletion)

---

## Pass 0 — Scaffold

### Frontend

| Source path | Destination path | Change |
|---|---|---|
| `frontend/src/lib/useConvert.ts` | `frontend/src/hooks/useConvert.ts` | MOVED |
| `frontend/src/lib/useLogGlow.ts` | `frontend/src/hooks/useLogGlow.ts` | MOVED |
| `frontend/src/assets/Lucidchart Assets/` (entire folder) | `frontend/src/assets/lucidchart-assets/` | MOVED (folder rename) |
| `frontend/src/pages/EditPreviewPage.tsx` | _(deleted)_ | DELETED — route in `App.tsx` updated to point directly at the wrapped component |
| — | `frontend/src/hooks/useResource.ts` | NEW |
| — | `frontend/src/types/scheduler.ts` | NEW (stub — populated in Pass 1) |
| — | `frontend/vitest.config.ts` | NEW |
| — | `frontend/src/test/setup.ts` | NEW |
| `frontend/package.json` | `frontend/package.json` | MODIFIED — add `vitest`, `@testing-library/*`, `msw`, `happy-dom` to devDependencies; add `test` and `test:coverage` scripts |

Any file that imports from `lib/useConvert` or `lib/useLogGlow` gets its import path updated. Any file that imports from `assets/Lucidchart Assets/` gets its path updated to `assets/lucidchart-assets/`.

### Backend

| Source path | Destination path | Change |
|---|---|---|
| `backend/accounts/views.py` | `backend/accounts/views.py` | MODIFIED — delete local `_staff_sees_all` definition; add `from core.mixins import _staff_sees_all` |
| `backend/team/views.py` | `backend/team/views.py` | MODIFIED — same |
| `backend/airtable_sync/views.py` | `backend/airtable_sync/views.py` | MODIFIED — same |
| `backend/core/mixins.py` | `backend/core/mixins.py` | MODIFIED — update docstring to remove "duplicated — intentionally not fixed" language |
| — | `backend/core/tests/__init__.py` | NEW (empty) |
| — | `backend/core/tests/test_mixins.py` | NEW |

---

## Pass 1 — RemindersPage

### Frontend

| Source path | Destination path | Change |
|---|---|---|
| `frontend/src/pages/RemindersPage.tsx` | `frontend/src/pages/RemindersPage.tsx` | THINNED — inline fetch blocks removed; `useReminders()` call added |
| `frontend/src/types/index.ts` | `frontend/src/types/index.ts` | SPLIT FROM — `Reminder`, `ReminderPayload` (and related DTOs) removed; re-exported from `types/scheduler.ts` for backwards compat during transition |
| — | `frontend/src/hooks/useReminders.ts` | NEW |
| — | `frontend/src/types/scheduler.ts` | MODIFIED — `Reminder` and related types added (stub from Pass 0 filled) |
| — | `frontend/src/hooks/__tests__/useReminders.test.ts` | NEW |
| — | `frontend/src/pages/__tests__/RemindersPage.test.tsx` | NEW |

### Backend

| Source path | Destination path | Change |
|---|---|---|
| `backend/scheduler/tests.py` | `backend/scheduler/tests.py` | Remains (empty); test logic lives in the new tests/ directory |
| — | `backend/scheduler/tests/__init__.py` | NEW (empty) |
| — | `backend/scheduler/tests/test_views.py` | NEW |

---

## Pass 2 — TeamPage

### Frontend

| Source path | Destination path | Change |
|---|---|---|
| `frontend/src/pages/TeamPage.tsx` | `frontend/src/pages/TeamPage.tsx` | THINNED — inline fetch removed; `useTeam()` call added |
| `frontend/src/types/index.ts` | `frontend/src/types/index.ts` | SPLIT FROM — `TeamMember`, `UserProfile` removed; re-exported from `types/team.ts` |
| — | `frontend/src/hooks/useTeam.ts` | NEW |
| — | `frontend/src/types/team.ts` | NEW |
| — | `frontend/src/hooks/__tests__/useTeam.test.ts` | NEW |
| — | `frontend/src/pages/__tests__/TeamPage.test.tsx` | NEW |

### Backend

| Source path | Destination path | Change |
|---|---|---|
| — | `backend/team/tests/__init__.py` | NEW (empty) |
| — | `backend/team/tests/test_views.py` | NEW |

---

## Pass 3 — DiscoverPage

### Frontend

| Source path | Destination path | Change |
|---|---|---|
| `frontend/src/pages/DiscoverPage.tsx` | `frontend/src/pages/DiscoverPage.tsx` | THINNED — inline fetch removed; `useDiscover()` + `useTeam()` calls added |
| `frontend/src/types/index.ts` | `frontend/src/types/index.ts` | SPLIT FROM — `DiscoverApplet`, `AppletCategory`, `ItemType`, `UrlStatus` removed; re-exported from `types/discover.ts` |
| — | `frontend/src/hooks/useDiscover.ts` | NEW |
| — | `frontend/src/types/discover.ts` | NEW |
| — | `frontend/src/hooks/__tests__/useDiscover.test.ts` | NEW |
| — | `frontend/src/pages/__tests__/DiscoverPage.test.tsx` | NEW |

### Backend

| Source path | Destination path | Change |
|---|---|---|
| — | `backend/discover/tests/__init__.py` | NEW (empty) |
| — | `backend/discover/tests/test_views.py` | NEW |

---

## Pass 4 — LogsPage

### Frontend

| Source path | Destination path | Change |
|---|---|---|
| `frontend/src/pages/LogsPage.tsx` | `frontend/src/pages/LogsPage.tsx` | THINNED — inline fetch blocks replaced by hook calls; local `getLogs()` state untouched |
| `frontend/src/types/index.ts` | `frontend/src/types/index.ts` | SPLIT FROM — `AgentSession`, `AgentMessage`, `AgentSkill`, `SkillInvocation`, `LogEntry` moved to `types/agents.ts`; `FeedbackItem` moved to `types/feedback.ts`; `CalendarEvent` (if not already in `types/scheduler.ts`) added there |
| — | `frontend/src/hooks/useAgentSessions.ts` | NEW |
| — | `frontend/src/hooks/useFeedbackItems.ts` | NEW |
| — | `frontend/src/hooks/useCalendarEvents.ts` | NEW (if LogsPage uses calendar events directly; otherwise reuse `useReminders` range fetch) |
| — | `frontend/src/types/agents.ts` | NEW |
| — | `frontend/src/types/feedback.ts` | NEW |
| — | `frontend/src/hooks/__tests__/useAgentSessions.test.ts` | NEW |
| — | `frontend/src/hooks/__tests__/useFeedbackItems.test.ts` | NEW |
| — | `frontend/src/pages/__tests__/LogsPage.test.tsx` | NEW |

### Backend

| Source path | Destination path | Change |
|---|---|---|
| — | `backend/agents/tests/__init__.py` | NEW (empty) |
| — | `backend/agents/tests/test_views.py` | NEW |
| — | `backend/feedback/tests/__init__.py` | NEW (empty) |
| — | `backend/feedback/tests/test_views.py` | NEW |

---

## Files NOT touched in these 5 passes

The following exist in the source app and are copied as-is into the new repo with no modifications:

- `frontend/src/pages/AccountDetailPage.tsx`
- `frontend/src/pages/CalendarPage.tsx`
- `frontend/src/pages/ActionItemsPage.tsx` (entire file, including the local-draft flow)
- `frontend/src/pages/ClaudeSkillsPage.tsx`
- `frontend/src/pages/RolePage.tsx`
- `frontend/src/pages/ChatPage.tsx`
- `frontend/src/pages/AccountsPage.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/SettingsPage.tsx`
- `frontend/src/pages/AdminDataPage.tsx`
- `frontend/src/components/` (all, except imports updated where hook locations changed)
- `frontend/src/context/` (all 4 Contexts — untouched)
- `frontend/src/lib/api.ts` (untouched — it is the existing data-access layer)
- `frontend/src/App.tsx` (only the `EditPreviewPage` route entry is removed/updated)
- All backend apps not listed above

---

## `types/index.ts` transition strategy

To avoid a big-bang rename that breaks imports across the whole codebase, the type migration is progressive:

1. When types are moved to a per-domain file (e.g. `types/scheduler.ts`), add a re-export line to `types/index.ts`:
   ```ts
   export type { Reminder, ReminderPayload } from "./scheduler";
   ```
2. This means existing pages that still import from `types/index.ts` continue to work unmodified.
3. New code (hooks, tests) imports from the domain-specific file directly.
4. `types/index.ts` will be progressively hollowed across the 5 passes. A future pass (outside this plan) can delete the re-exports once all consumers are updated.
