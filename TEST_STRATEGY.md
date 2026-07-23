# TEST_STRATEGY.md — Test Framework and Coverage Plan

---

## Framework choices

### Frontend: Vitest + React Testing Library + MSW

**Why Vitest:**  
The app uses Vite 5 as its bundler (confirmed via `package.json`). Vitest runs inside the same Vite pipeline — same transforms, same config, same aliases — with zero extra configuration. No test runner is currently set up (no `jest`, no `vitest` in `package.json`). Introducing Vitest is the lowest-friction option: one `devDependency` and a config block. Introducing Jest instead would require a second transform pipeline (Babel or `ts-jest`) that diverges from Vite's behavior and can produce build/test divergence for things like SVG imports and path aliases.

**Packages to add (devDependencies):**
```
vitest
@vitest/coverage-v8
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
msw
happy-dom
```

**Config (`vitest.config.ts` or `vite.config.ts` test block):**
```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/hooks/**", "src/pages/**"],
    },
  },
});
```

**`src/test/setup.ts`:**
```ts
import "@testing-library/jest-dom";
import { afterEach, beforeAll, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw-server"; // MSW node server

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());
```

**Why MSW for API mocking:**  
MSW intercepts at the network level (via Service Worker in browsers, via `msw/node` in tests). This means the hooks under test use their real `axios`/`fetch` calls — there is no mocking of `lib/api.ts` functions directly. Benefits: tests exercise the full hook-to-API-call chain; switching between `msw/node` and browser Service Worker uses the same handler definitions; handlers can be overridden per-test for error/edge-case scenarios.

**`src/test/msw-server.ts`:**
```ts
import { setupServer } from "msw/node";
// Import handlers from src/test/handlers/ — one file per API domain
import { schedulerHandlers } from "./handlers/scheduler";
import { teamHandlers } from "./handlers/team";
// ... etc.
export const server = setupServer(...schedulerHandlers, ...teamHandlers);
```

Handlers live in `src/test/handlers/<domain>.ts`. Each handler defines the happy-path response. Tests that need error cases call `server.use(http.get('/api/...', () => HttpResponse.error()))` within the test body (MSW v2 API).

**Why happy-dom over jsdom:**  
happy-dom has faster startup and better compatibility with Vite's ESM output. No known incompatibilities with RTL or the app's dependencies.

---

### Backend: Django's built-in TestCase

**Why Django TestCase:**  
`requirements.txt` contains no `pytest-django`, `pytest`, or `factory_boy`. The existing (empty) `tests.py` files use Django's convention. Introducing a second test runner just to get `pytest` syntax is unnecessary overhead with no payoff for the tests we're writing (CRUD + permission assertions are trivially expressible with `APITestCase`).

**No new backend dependencies** are needed.

**Base classes to use:**
- `from rest_framework.test import APITestCase` — for all DRF endpoint tests (provides `self.client.get/post/patch/delete` with JSON content type).
- `from django.test import TestCase` — for unit tests of helpers and mixins (no HTTP needed).
- `from django.contrib.auth import get_user_model` — for creating test users.

**Database:** Each `TestCase` / `APITestCase` runs in a transaction that is rolled back after the test. No test database setup beyond `python manage.py test` is needed.

---

## File and naming conventions

### Frontend

```
src/
├── hooks/
│   ├── useResource.ts
│   ├── useReminders.ts
│   └── __tests__/
│       ├── useResource.test.ts
│       ├── useReminders.test.ts
│       └── ...
├── pages/
│   ├── RemindersPage.tsx
│   └── __tests__/
│       ├── RemindersPage.test.tsx
│       └── ...
└── test/
    ├── setup.ts
    ├── msw-server.ts
    └── handlers/
        ├── scheduler.ts
        ├── team.ts
        ├── discover.ts
        ├── agents.ts
        └── feedback.ts
```

- Test files are co-located in `__tests__/` subdirectories next to the code they test.
- Test file names match the source file name with `.test.ts` / `.test.tsx` suffix.
- MSW handler files are named after the backend Django app they mock.

### Backend

```
backend/
├── core/
│   └── tests/
│       ├── __init__.py
│       └── test_mixins.py
├── scheduler/
│   └── tests/
│       ├── __init__.py
│       └── test_views.py
├── team/
│   └── tests/
│       ├── __init__.py
│       └── test_views.py
├── discover/
│   └── tests/
│       ├── __init__.py
│       └── test_views.py
├── agents/
│   └── tests/
│       ├── __init__.py
│       └── test_views.py
└── feedback/
    └── tests/
        ├── __init__.py
        └── test_views.py
```

- Each app's existing empty `tests.py` is left in place (Django will find the `tests/` package first).
- Test classes follow `class ReminderViewSetTest(APITestCase):` naming.
- Test method names: `test_<scenario>` — e.g. `test_staff_user_sees_all_reminders`, `test_non_staff_sees_only_own`.

---

## API mocking approach (frontend)

**Layer mocked:** HTTP (MSW at the network layer). We do NOT mock `lib/api.ts` functions directly.

**Why this matters:** If we mock `schedulerApi.listReminders`, we are testing the hook in isolation from the API call shape. MSW tests the hook's entire code path — including how it calls the API, how it handles the response envelope, and what it does with the result. This catches bugs like incorrect `r.data.results` vs `r.data` access patterns.

**MSW handler example (happy path):**
```ts
// src/test/handlers/scheduler.ts
import { http, HttpResponse } from "msw";
import type { Reminder } from "../../types/scheduler";

const mockReminders: Reminder[] = [
  { id: 1, title: "Follow up", due_date: "2026-07-25", dismissed: false, ... },
];

export const schedulerHandlers = [
  http.get("/api/reminders/", () =>
    HttpResponse.json({ results: mockReminders, count: 1 })
  ),
  http.post("/api/reminders/", async ({ request }) => {
    const body = await request.json() as Partial<Reminder>;
    return HttpResponse.json({ id: 99, ...body }, { status: 201 });
  }),
  // patch, delete, dismiss ...
];
```

**Error-case override (per-test):**
```ts
it("shows error state when API fails", async () => {
  server.use(
    http.get("/api/reminders/", () => HttpResponse.error())
  );
  const { result } = renderHook(() => useReminders({ tab: "pending" }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).not.toBeNull();
  expect(result.current.data).toEqual([]);
});
```

---

## Per-pass coverage breakdown

### Pass 0 — Scaffold

| Test file | What it covers |
|---|---|
| `src/hooks/__tests__/useResource.test.ts` | All states (happy path, loading, error, refetch, dep change, stale-fetch cancellation). This is the highest-priority test file — all subsequent hooks depend on it. |
| `backend/core/tests/test_mixins.py` | `_staff_sees_all` truth table (4 cases); `RequireAccountMembershipMixin` create + update (member allowed, non-member denied, staff bypasses); `RequireCalendarEventOwnershipMixin` create + update (owner allowed, account member allowed, unrelated user denied, staff bypasses). |

### Pass 1 — RemindersPage

| Test file | What it covers |
|---|---|
| `src/hooks/__tests__/useReminders.test.ts` | Happy path load; loading state on mount; error state; `createReminder` calls API + triggers refetch; `updateReminder` same; `deleteReminder` same; `dismissReminder` same. |
| `src/pages/__tests__/RemindersPage.test.tsx` | Renders loading skeleton; renders empty state; renders populated list (at least title + due date visible); clicking delete on first item calls `deleteReminder(1)`; form submission with valid data calls `createReminder`; tab change causes refetch (via MSW handler check or mock call count). |
| `backend/scheduler/tests/test_views.py` | ReminderViewSet: staff list (all), non-staff list (own only), create (sets correct owner), update own (allowed), update other's (403/404), delete own (allowed), delete other's (403/404), dismiss action (owner allowed). |

### Pass 2 — TeamPage

| Test file | What it covers |
|---|---|
| `src/hooks/__tests__/useTeam.test.ts` | Happy path; loading; error; `updateTeamMember` calls API + refetch; module-level cache (if used) — second render does not trigger a second API call. |
| `src/pages/__tests__/TeamPage.test.tsx` | Loading state; populated list (names visible); any write interaction (e.g. save profile) calls correct mutation. |
| `backend/team/tests/test_views.py` | Team member list scoping (staff vs. non-staff); any write endpoints for member data. |

### Pass 3 — DiscoverPage

| Test file | What it covers |
|---|---|
| `src/hooks/__tests__/useDiscover.test.ts` | Happy path; `createApplet`; `updateApplet`; `deleteApplet`. |
| `src/pages/__tests__/DiscoverPage.test.tsx` | Loading; populated grid; create form (author auto-filled from CurrentUserContext mock); edit; delete. |
| `backend/discover/tests/test_views.py` | List (any authenticated user); create (submitter set to caller); update own vs. other's; delete own vs. other's; staff bypass. |

### Pass 4 — LogsPage

| Test file | What it covers |
|---|---|
| `src/hooks/__tests__/useFeedbackItems.test.ts` | Happy path; loading; error. |
| `src/hooks/__tests__/useAgentSessions.test.ts` | Happy path; loading; error. |
| `src/pages/__tests__/LogsPage.test.tsx` | Each log section renders its loading state independently; each section renders populated data; any section that renders empty state (0 records) shows a "no entries" message rather than blank space. |
| `backend/agents/tests/test_views.py` | AgentSession list scoping; AgentSkill list. |
| `backend/feedback/tests/test_views.py` | FeedbackItem list scoping. |

---

## Minimum coverage targets

These are floors, not ceilings:

- `useResource.ts`: 100% line coverage (it is tiny and critical).
- Every other new hook: ≥90% line coverage.
- Page components: ≥80% line coverage (UI branches are harder to enumerate exhaustively).
- Backend test files: every `get_queryset` branch (staff-sees-all true/false), every permission mixin path (allowed/denied/staff), every mutation endpoint (201/403/404).

Coverage report: `npm run test:coverage` produces an lcov report. Backend coverage is not numerically tracked in this plan but the qualitative requirement is: every branch of the `_staff_sees_all` helper and both mixins must have a test that exercises it.
