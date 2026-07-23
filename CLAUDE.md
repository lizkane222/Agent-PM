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
| `AccountDetailPage.tsx` (~7,230 lines) | ~14 entity types, ~30 inlined sub-components |
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
