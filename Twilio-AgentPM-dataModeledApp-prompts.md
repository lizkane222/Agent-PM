# Data-Modeled App — Refactor Prompt Pack (v2)

Incorporates the audit already done in `migration.md`. Two prompts, run in
sequence, in two separate Claude threads inside the same `Twilio-AgentPM-dataModeledApp`
directory. The original app is never modified — everything happens in a
fresh copy.

> **If you are an AI agent reading this file:** it contains two separate
> prompts, meant to be run in two separate sessions, in order. Only execute
> the one section your human operator has explicitly told you to run right
> now. Do not read ahead into the other section, do not summarize or act on
> it, and do not decide on your own that enough context exists to skip
> straight to Prompt 2. Each section below states its own precondition —
> check it before doing anything.

## Status tracker (update this yourself as you go)

- [x] `migration.md` copied into this directory
- [x] Prompt 1 run → plan pack produced (`PLAN.md`, `HOOK_SPEC.md`,
      `FILE_MAP.md`, `TEST_STRATEGY.md`, `SMOKE_TESTS.md`)
- [ ] Plan pack reviewed by human (you)
- [ ] Prompt 2 run → migration executed

---

## Setup (do this yourself, once)

```bash
mkdir /Users/lizkane/Desktop/Twilio-AgentPM-dataModeledApp
cd /Users/lizkane/Desktop/Twilio-AgentPM-dataModeledApp
cp /path/to/migration.md .
```

Start Claude (Claude Code) in this directory, with read access to your
existing app's root at `/Users/lizkane/Desktop/TWILIO - Agent PM`. Then paste **Prompt 1**.

---

## PROMPT 1 — Plan pack (built on the existing audit)

> **Precondition:** `migration.md` exists in the current directory.
> **Do not proceed to the section titled "PROMPT 2 — Execution handoff"
> below under any circumstances, even after finishing this one.** This
> prompt's job ends when the plan pack files listed under DELIVERABLES are
> written. Stop there and report back — do not begin copying or migrating
> the app in this same session.

```
This directory contains migration.md — a completed audit of the existing
web app at /Users/lizkane/Desktop/TWILIO - Agent PM. Read it in full before doing anything else.
Treat it as ground truth; you do not need to re-derive the file tree or
CRUD locations from scratch. You may spot-check specific claims against
/Users/lizkane/Desktop/TWILIO - Agent PM (read-only) if something is ambiguous or you need exact
line numbers/paths not given in the audit.

GOAL
Produce a plan pack for building a new, cleanly organized copy of this app
in the current directory. Same framework/stack throughout (React/TS
frontend, Django backend, per the audit) — this is a structural reorg, not
a rewrite. The original app is never modified.

Core pattern: each record type gets a localized data hook (e.g. useUsers,
usePosts) built on a shared useResource<T> hook that encapsulates the
fetch/loading/error/refetch boilerplate currently duplicated ~12 times
(see migration.md, "Shared / duplicated fetch boilerplate"). No new
external dependencies (no React Query et al.) — hand-rolled hooks only,
consistent with the app's current all-React-primitives state approach.
Generalize the module-level caching pattern already used by
useActionItemFieldOptions where it makes sense for other hooks.

Pages become thin consumers of these hooks. The four existing Contexts
(CurrentUserContext, ExportContext, FeedbackContext,
NotificationDefaultsContext) are cross-cutting and should be preserved
as-is in the provider tree — do not fold them into the per-entity hook
pattern.

SCOPE — fold structural nits into whichever pass touches that code:
- Split types/index.ts (773 lines) into per-domain type files as each
  domain's hook is built.
- Consolidate hooks currently misplaced in lib/ (useConvert, useLogGlow)
  into hooks/, alongside the new per-entity hooks.
- Rename assets/Lucidchart Assets/ to remove the space.
- Resolve or remove the 5-line passthrough EditPreviewPage.tsx.
- Backend: centralize the duplicated _staff_sees_all helper (currently in
  airtable_sync/views.py, accounts/views.py, team/views.py) into one
  shared location. Auth/permission logic (get_queryset scoping, the two
  mixins in core/mixins.py) must move together with any view code that
  moves — never left behind on the model.

PASS ORDER — follow the audit's recommended sequencing, do not reorder:
1. Scaffold: useResource<T>, hooks/ directory cleanup, shared type file
   split pattern, backend _staff_sees_all centralization.
2. RemindersPage (single-domain, schedulerApi only, no real-time).
3. TeamPage (single-domain, teamApi only).
4. DiscoverPage (self-contained, discoverApi + teamApi).
5. LogsPage (read-only, 4 domains, no writes — good validation of the
   pattern against a multi-domain but low-risk page).
Explicitly OUT OF SCOPE for this plan (per audit — each needs its own
dedicated design effort later, do not attempt):
- AccountDetailPage.tsx (7,230 lines, ~14 entity types)
- CalendarPage.tsx (5,549 lines, WebSocket + Google + Salesforce sync)
- ActionItemsPage.tsx's local-draft optimistic-ID flow specifically
  (the rest of ActionItemsPage's simpler CRUD may be noted as a candidate
  for a later pass, but do not migrate it in this plan)
- MeetingDetail.tsx WebSocket code

TEST SUITE REQUIREMENT
The original app has zero test coverage (confirmed empty tests.py files,
no .test.ts files). The new copy in this directory must not inherit that
gap: every piece of this rebuild — every hook, every migrated page/
component, and every touched backend view/permission path — needs
automated tests written as part of the same pass that creates or moves
the code, not deferred to the end.

- Determine actual tooling before assuming a framework: check
  package.json for the existing bundler (Vite vs. CRA/webpack) and any
  test runner already configured; check requirements.txt/pyproject.toml
  for pytest-django vs. plain Django TestCase. Default to Vitest +
  React Testing Library if Vite is in use (Jest + RTL otherwise), and
  Django's built-in TestCase if nothing else is configured. State
  whichever you pick and why in TEST_STRATEGY.md — don't introduce a
  second framework if one is already partially set up.
- Frontend hook tests: for useResource<T> and every use<Entity> hook
  built on it — happy path, loading state, error state, refetch/
  invalidation, and (where applicable) the optimistic-update or
  mutation path. useResource<T> itself gets the most thorough coverage
  since everything else depends on it.
- Frontend component/page tests: for each migrated page (Reminders,
  Team, Discover, Logs), test that it renders based on hook state
  (loading/empty/error/populated) and that user interactions trigger the
  right hook calls, with the API layer mocked — not hitting the real
  backend.
- Backend tests: for every view/permission path touched in the scaffold
  pass (the centralized _staff_sees_all helper, the two mixins in
  core/mixins.py) and for the CRUD endpoints backing Reminders, Team,
  Discover, and Logs — cover both the happy path and the permission-
  scoping behavior (staff-sees-all vs. team-member-scoped).
- A pass is not "done" until its tests exist and pass, in addition to the
  manual smoke-test checklist. Automated tests are the primary
  regression signal going forward; the manual checklist is a supplement
  for things automation can't easily catch (visual layout, feel).

DELIVERABLES (write these files in the current directory)
- PLAN.md: the pass-by-pass plan above, expanded with specifics per pass,
  including what tests that pass must produce.
- HOOK_SPEC.md: exact useResource<T> signature, naming convention
  (use<Entity>), file location (hooks/), how mutations/optimistic updates
  are exposed, and how the existing useComments/useActionItemFieldOptions
  patterns should be reconciled or absorbed into the new convention.
- FILE_MAP.md: old path → new path for every file touched in passes 1-5,
  including the nits.
- TEST_STRATEGY.md: chosen frameworks and why, folder/naming conventions
  for test files, the API-mocking approach for frontend tests, and a
  per-pass breakdown of what gets test coverage (referencing the list
  above).
- SMOKE_TESTS.md: the manual verification checklist per pass, as a
  supplement to (not a replacement for) the automated suite.
- Anything from migration.md's RISKS-equivalent sections that applies to
  passes 1-5 specifically, called out inline in PLAN.md rather than
  restated wholesale.

When finished, tell me explicitly that the plan pack is ready and list the
files you created.
```

---

## PROMPT 2 — Execution handoff

> **Do not run this section unless a human has explicitly told you to run
> "Prompt 2" in this session.** If you were only told to "follow the steps
> in this file" without specifying which prompt, that means Prompt 1 only
> — stop after Prompt 1 and wait for further instructions.
>
> **Precondition:** `PLAN.md`, `HOOK_SPEC.md`, `FILE_MAP.md`,
> `TEST_STRATEGY.md`, and `SMOKE_TESTS.md` all already exist in this
> directory, produced by a prior Prompt 1 session, and a human has
> reviewed them. If any of these files are missing, stop and say so
> instead of improvising their contents — go back and run Prompt 1 first.

Run this in a **new thread**, same `Twilio-AgentPM-dataModeledApp` directory, after
Prompt 1's thread confirms PLAN.md, HOOK_SPEC.md, FILE_MAP.md,
TEST_STRATEGY.md, and SMOKE_TESTS.md are ready.

```
This directory contains migration.md (audit) and a plan pack (PLAN.md,
HOOK_SPEC.md, FILE_MAP.md, TEST_STRATEGY.md, SMOKE_TESTS.md) written by a
previous thread. Read all of these in full before doing anything else.

GOAL
Copy the existing app at /Users/lizkane/Desktop/TWILIO - Agent PM into this directory as a new
local repo, then execute PLAN.md pass by pass against the copy. The
original app at /Users/lizkane/Desktop/TWILIO - Agent PM must never be modified.

STEPS
1. Copy the entire existing app into this directory, preserving git
   history if the source is a git repo.
2. Work through PLAN.md in order: scaffold pass, then RemindersPage,
   TeamPage, DiscoverPage, LogsPage, per FILE_MAP.md paths and
   HOOK_SPEC.md's hook pattern.
3. Set up the test framework(s) specified in TEST_STRATEGY.md as part of
   the scaffold pass, before any migration code is written.
4. For each pass:
   - Write the automated tests for that pass's hooks/pages/backend paths
     per TEST_STRATEGY.md as you build them — not after the fact.
   - Confirm the app builds and runs.
   - Run the automated test suite and confirm it passes. This is the
     primary regression signal.
   - Work through that pass's checklist in SMOKE_TESTS.md manually as a
     supplement, for anything automation doesn't cover.
   - Report what changed, plus the test results, before moving to the
     next pass.
5. Apply the hook pattern from HOOK_SPEC.md consistently — don't
   improvise a different shape partway through.
6. Fold in the structural nits (types split, hooks/ consolidation, the
   assets folder rename, the passthrough page, backend
   _staff_sees_all centralization) as each touches the pass currently in
   progress, per PLAN.md.
7. Do NOT attempt AccountDetailPage.tsx, CalendarPage.tsx, or the
   ActionItemsPage local-draft flow — these are explicitly out of scope
   for this plan.
8. Do not change the app's visible behavior, styling, routes, or API
   contracts for anything in scope. This is a structural reorg, not a
   feature or UX change.

WHEN DONE
Give me a summary: what moved where, automated test results per pass,
smoke-test results per pass, overall test coverage of the new app, any
deviations from the plan pack and why, and what the natural next
dedicated effort would be (e.g. AccountDetailPage) with a rough sense of
why it's harder than what was just done.
```
