# HOOK_SPEC.md — Hook Architecture Specification

---

## 1. `useResource<T>` — the shared base hook

### Location
`src/hooks/useResource.ts`

### Signature

```ts
export function useResource<T>(
  fetcher: () => Promise<T[]>,
  deps: readonly unknown[] = [],
): UseResourceResult<T>

export interface UseResourceResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}
```

### Contract

- `fetcher` is called on mount and whenever any value in `deps` changes (identity comparison, same semantics as `useEffect`).
- `fetcher` must return `T[]` directly. The caller is responsible for unwrapping DRF envelope responses — e.g. `() => schedulerApi.listReminders(p).then(r => r.data.results)`.
- `loading` starts `true` on mount and on each `refetch()` / dep change. It becomes `false` once the fetch settles (success or error).
- `error` is set on rejection, cleared on the next successful fetch.
- `data` is never `null`; it starts as `[]` and only updates on a successful response.
- Stale-fetch protection: if `deps` change while a fetch is in flight, the older result is discarded. Implement via a cancellation boolean ref:

```ts
useEffect(() => {
  let cancelled = false;
  setLoading(true);
  setError(null);
  fetcher()
    .then(result => { if (!cancelled) { setData(result); setLoading(false); } })
    .catch(err  => { if (!cancelled) { setError(err); setLoading(false); } });
  return () => { cancelled = true; };
}, deps);  // eslint-disable-line react-hooks/exhaustive-deps
```

- `refetch()` is a stable function reference (wrapped in `useCallback` with no deps). Calling it increments an internal counter dep that triggers the effect, re-running the fetcher with the same `deps` values. This avoids requiring the caller to manage a manual refresh trigger.

### What `useResource` does NOT do

- No module-level caching — that is opt-in per hook (see §4 below).
- No pagination — hooks that need paginated results manage pagination state themselves.
- No mutations — each per-entity hook adds its own typed mutation functions alongside the resource state.
- No optimistic updates — out of scope for these passes (ActionItemsPage's local-draft flow is explicitly excluded).

---

## 2. Naming convention — `use<Entity>`

| New hook | File | Entity type |
|---|---|---|
| `useReminders` | `hooks/useReminders.ts` | `Reminder[]` |
| `useTeam` | `hooks/useTeam.ts` | `TeamMember[]` |
| `useDiscover` | `hooks/useDiscover.ts` | `DiscoverApplet[]` |
| `useAgentSessions` | `hooks/useAgentSessions.ts` | `AgentSession[]` |
| `useFeedbackItems` | `hooks/useFeedbackItems.ts` | `FeedbackItem[]` |
| `useCalendarEvents` | `hooks/useCalendarEvents.ts` | `CalendarEvent[]` (if needed for LogsPage) |

Rules:
- One entity per hook. If a page needs two entity types, it calls two hooks.
- The hook name is `use<Entity>` (singular concept, plural data) — not `use<Page>Data`.
- All hooks live in `src/hooks/` alongside the existing `useActionItemFieldOptions.ts` and `useScheduledOccurrences.ts`.

---

## 3. Mutation pattern

Per-entity hooks extend the `UseResourceResult<T>` with typed mutation functions:

```ts
// Example: useReminders
export interface UseRemindersResult extends UseResourceResult<Reminder> {
  createReminder: (payload: CreateReminderPayload) => Promise<Reminder>;
  updateReminder: (id: number, payload: UpdateReminderPayload) => Promise<Reminder>;
  deleteReminder: (id: number) => Promise<void>;
  dismissReminder: (id: number) => Promise<void>;
}
```

Each mutation:
1. Calls the corresponding `schedulerApi.*` method.
2. On success, calls `refetch()` to re-sync the list. No optimistic updates for these passes.
3. On error, re-throws so the page component can handle user-facing error messages (e.g. a toast or inline error near the form).

The page component is responsible for any `saving`/`submitting` UI state around a mutation call — that stays in the page, not the hook.

---

## 4. Module-level cache — opt-in

Some hooks benefit from fetching at most once per page load (e.g. static reference data like field options or a small team list unlikely to change mid-session). Apply the pattern from `useActionItemFieldOptions` when it makes sense:

```ts
// Module-level — survives React tree remounts within the same JS module lifetime
let _cache: TeamMember[] | null = null;
let _promise: Promise<void> | null = null;

export function useTeam() {
  const resource = useResource<TeamMember>(
    () => {
      if (_cache) return Promise.resolve(_cache);
      if (!_promise) {
        _promise = teamApi.listMembers().then(r => {
          _cache = r.data.results;
        });
      }
      return _promise.then(() => _cache!);
    },
    [],  // never re-fetches on dep change — intentional for cached data
  );
  ...
}
```

**When to use the cache:** data that is stable for the session (team members, field options). Do not cache entity lists that the user can mutate in the same session (Reminders, Applets) — those must always reflect the latest server state.

**Cache invalidation:** not in scope for these passes. Mutations that call `refetch()` bypass the cache only if the cache check is part of the fetcher. For mutable lists, don't use the module-level cache.

---

## 5. Reconciling `useComments`

`useComments` (`components/comments/useComments.ts`) is a cross-cutting hook used across many pages and components. It already follows the spirit of the new pattern (a `load` callback, `useEffect` invoking it, mutation functions that call `load()` after).

**It is not migrated in these 5 passes.** It continues to live in `components/comments/` and is used as-is.

If it is refactored in a future pass, the migration path is:
- Replace the internal `load` + `useEffect` with `useResource<Comment>` using `(resourceType, resourceId)` as deps.
- Keep the existing mutation methods (`addComment`, `editComment`, `deleteComment`) unchanged — they already call `load()` after each write, which maps directly to calling `refetch()`.
- The `reload` export alias maps to `refetch`.

---

## 6. Reconciling `useActionItemFieldOptions`

This hook uses the module-level cache pattern (§4 above) and lives in `hooks/` where it belongs. **No changes needed in these passes.**

Its pattern is the reference implementation for the opt-in cache. Generalize from it; do not modify it.

---

## 7. `useConvert` and `useLogGlow`

These are moved from `lib/` to `hooks/` in Pass 0 (see FILE_MAP.md). No behavioral changes. They do not use `useResource` and do not need to — they are not entity-fetch hooks.

---

## 8. Full example — `useReminders`

```ts
// src/hooks/useReminders.ts
import { useCallback } from "react";
import { schedulerApi } from "../lib/api";
import { useResource } from "./useResource";
import type { Reminder } from "../types/scheduler";

interface ReminderParams {
  tab: "pending" | "completed" | "all";
}

export function useReminders(params: ReminderParams) {
  const resource = useResource<Reminder>(
    () => schedulerApi.listReminders(params).then(r => r.data.results),
    [params.tab],
  );

  const createReminder = useCallback(async (payload: Omit<Reminder, "id">) => {
    const { data } = await schedulerApi.createReminder(payload);
    resource.refetch();
    return data;
  }, [resource.refetch]);

  const updateReminder = useCallback(async (id: number, payload: Partial<Reminder>) => {
    const { data } = await schedulerApi.updateReminder(id, payload);
    resource.refetch();
    return data;
  }, [resource.refetch]);

  const deleteReminder = useCallback(async (id: number) => {
    await schedulerApi.deleteReminder(id);
    resource.refetch();
  }, [resource.refetch]);

  const dismissReminder = useCallback(async (id: number) => {
    await schedulerApi.dismissReminder(id);
    resource.refetch();
  }, [resource.refetch]);

  return { ...resource, createReminder, updateReminder, deleteReminder, dismissReminder };
}
```
