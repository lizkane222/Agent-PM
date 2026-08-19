import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createLocalStore } from "../lib/localStore";

/**
 * Ordering for the status columns on the Account Detail kanban.
 *
 * Two different rules, because the columns mean different things:
 *
 * - **Open** is an inbox, so it is strictly chronological by `created_at` — oldest at the
 *   top, newest at the bottom. Arrival records are ignored here: dragging something back
 *   out of In Progress should not park it at the bottom of the backlog.
 * - **Every other status** is ordered by when the item *arrived* there, most recent at the
 *   bottom, so the column reads as a log of what you moved and when.
 *
 * Arrival is client-side state. There is no server field for "when did this enter Blocked"
 * (`marked_done_at` exists, but only for Done), and adding one would mean a migration plus a
 * write on every status change — a lot of machinery for a display order. So arrivals are
 * recorded in localStorage, through the same module-level store the focus pins and collapse
 * sets use: the browser's `storage` event does not fire in the document that wrote, so N
 * sibling `useState` copies of one key drift apart within a single tab.
 *
 * This is UI state, not server data — `useResource` / HOOK_SPEC rules do not apply.
 */

export const STATUS_ARRIVAL_ORDER_KEY = "actionItemStatusArrival-v1";

/**
 * Cap per status. Unbounded growth is the only real risk here — an id is never removed when
 * its item is deleted, because this page only ever sees one account's items and pruning
 * against them would discard every other account's records.
 *
 * Dropping from the *front* (the oldest arrivals) is deliberate and order-preserving in
 * aggregate: an id with no record sorts above every id that has one, which is exactly where
 * the oldest arrivals already were.
 */
const MAX_IDS_PER_STATUS = 500;

/** Status name → airtable_ids in arrival order, oldest first. */
type ArrivalMap = Record<string, string[]>;

/** The fields ordering needs. `AirtableActionItem` satisfies this. */
export interface StatusOrderableItem {
  airtable_id: string;
  status: string;
  created_at: string;
  marked_done_at?: string | null;
}

const store = createLocalStore<ArrivalMap>(
  STATUS_ARRIVAL_ORDER_KEY,
  (raw) => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out: ArrivalMap = {};
      for (const [status, ids] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(ids)) out[status] = ids.filter((v): v is string => typeof v === "string");
      }
      return out;
    } catch {
      return {};
    }
  },
  (value) => JSON.stringify(value),
);

/** Re-read from localStorage. Needed after `localStorage.clear()`, which fires no storage
 *  event — call this in test setup to keep tests order-independent. */
export function reloadStatusArrivalOrder(): void {
  store.reload();
}

/**
 * Move `airtableId` to the end of `status`, removing it from wherever it was.
 *
 * An item has exactly one status, so a stale entry under its previous one would make it
 * sort as though it had never left.
 */
function withArrival(map: ArrivalMap, airtableId: string, status: string): ArrivalMap {
  const next: ArrivalMap = {};
  for (const [key, ids] of Object.entries(map)) {
    const kept = ids.filter((id) => id !== airtableId);
    if (kept.length > 0) next[key] = kept;
  }
  const appended = [...(next[status] ?? []), airtableId];
  next[status] = appended.length > MAX_IDS_PER_STATUS ? appended.slice(-MAX_IDS_PER_STATUS) : appended;
  return next;
}

/** Epoch ms for the chronological fallback, 0 for a missing or unparseable date. */
function fallbackTime(item: StatusOrderableItem, status: string): number {
  // Done is the one status the server does timestamp, so use it when present — far better
  // than creation time for a column that is mostly items completed long before this feature
  // existed and so have no arrival record.
  const raw = (status === "Done" ? item.marked_done_at : null) || item.created_at;
  const t = new Date(raw ?? "").getTime();
  return Number.isNaN(t) ? 0 : t;
}

export interface StatusArrivalOrder {
  /** Sort a single status column. Does not mutate the input. */
  orderForStatus: <T extends StatusOrderableItem>(items: T[], status: string) => T[];
}

/**
 * Watch `items` for status changes and return a sorter for the columns.
 *
 * Transitions are detected by diffing against the previously seen status rather than by
 * instrumenting each mutation site. Status changes on this page happen through the kanban
 * drag, the card's own editor and the detail modal, and a broadcast refetch can bring in a
 * change made on another page entirely — one observer catches all of them and cannot be
 * forgotten by a future call site.
 *
 * A **first sighting is not an arrival.** We did not watch the item get where it is, so it
 * keeps the chronological fallback instead of jumping to the bottom of its column, which
 * would reorder the board on every mount.
 */
export function useStatusArrivalOrder(items: StatusOrderableItem[]): StatusArrivalOrder {
  const map = useSyncExternalStore(store.subscribe, store.get, store.get);
  const seenRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const seen = seenRef.current;
    const arrivals: Array<[string, string]> = [];
    for (const item of items) {
      // A blank's local-* id is thrown away when it is promoted, so a record against one
      // would be orphaned — the same guard the focus pins and comments use.
      if (item.airtable_id.startsWith("local-")) continue;
      const previous = seen.get(item.airtable_id);
      seen.set(item.airtable_id, item.status);
      if (previous !== undefined && previous !== item.status) {
        arrivals.push([item.airtable_id, item.status]);
      }
    }
    if (arrivals.length === 0) return;
    store.update((prev) => arrivals.reduce((acc, [id, status]) => withArrival(acc, id, status), prev));
  }, [items]);

  const orderForStatus = useCallback(
    <T extends StatusOrderableItem>(list: T[], status: string): T[] => {
      // Open is the inbox: always chronological, arrival records ignored.
      if (status === "Open") {
        return [...list].sort((a, b) => fallbackTime(a, status) - fallbackTime(b, status));
      }
      const positions = new Map((map[status] ?? []).map((id, i) => [id, i]));
      return [...list].sort((a, b) => {
        const pa = positions.get(a.airtable_id);
        const pb = positions.get(b.airtable_id);
        if (pa !== undefined && pb !== undefined) return pa - pb;
        // An item we never watched arrive is older news than one we did, so it sits above.
        if (pa !== undefined) return 1;
        if (pb !== undefined) return -1;
        return fallbackTime(a, status) - fallbackTime(b, status);
      });
    },
    [map],
  );

  return { orderForStatus };
}
