import type { AirtableActionItem } from "../types";

/**
 * Ordering and filtering for the calendar page's action-items sidebar.
 *
 * The list used to render in whatever order the API returned it — `AirtableActionItemViewSet`
 * sets `pagination_class = None` and applies no `order_by`, so the order was arbitrary and a
 * card's position told you nothing. This module gives it six explicit groups.
 *
 * The first three groups are *positional* state — where the user put the card on the Action
 * Items page — read from `actionItemZones` and `actionFocusPins`, not from `status`. The last
 * three are the card's `status`. Note the naming trap: `ZONE_LABELS.active` in
 * `pages/ActionItemsPage.tsx` is the string "In Progress" while that column's header reads
 * "Currently Tracking". Here "tracking" is the zone and "in_progress" is the status.
 *
 * Lives in `lib/` rather than either sidebar because there are two copies of that component
 * (`pages/CalendarPage.tsx`'s local one is the live one; `components/calendar/ActionItemsSidebar.tsx`
 * is its diverged twin) and the logic must not drift between them.
 */

export type SidebarGroupKey =
  | "tracking"
  | "staged"
  | "pinned"
  | "in_progress"
  | "open"
  | "done";

/**
 * The groups in render order — also the source of truth for the filter chip row, so a chip
 * can never exist without a matching section or vice versa.
 */
export const SIDEBAR_GROUPS: { key: SidebarGroupKey; label: string; flagLabel: string }[] = [
  { key: "tracking", label: "Currently Tracking", flagLabel: "Tracking" },
  { key: "staged", label: "Staged Today", flagLabel: "Staged" },
  { key: "pinned", label: "Pinned In Progress", flagLabel: "Pinned" },
  { key: "in_progress", label: "In Progress", flagLabel: "In Progress" },
  { key: "open", label: "Open", flagLabel: "Open" },
  { key: "done", label: "Done", flagLabel: "Done" },
];

/**
 * How far back the Done group reaches. Done items are fetched in full — the endpoint is
 * unpaginated — but rendering all of them would grow the sidebar without bound (55 rows in
 * the dev DB already). The window is stated in the section header so the cap is never silent.
 */
export const DONE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SidebarGroupingContext {
  /** `actionItemZones[id] === "active"` — the "Currently Tracking" column. */
  trackingIds: Set<string>;
  /** `actionItemZones[id] === "today"` — the "Stage Today" column. */
  stagedIds: Set<string>;
  /** `actionFocusPins` — see `hooks/useFocusPins.ts`. */
  pinnedIds: Set<string>;
  /** Empty means "no flags ticked", which shows everything. */
  selectedFlags: Set<SidebarGroupKey>;
  /** Injected so tests need no fake timers. Defaults to now. */
  now?: number;
}

/** Milliseconds for a timestamp field, or null when absent/unparseable. */
function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Was this marked done inside the window?
 *
 * `marked_done_at` is only set by the viewset when a status transitions to Done, so rows
 * that arrived Done from an Airtable sync have it null (4 of 55 in the dev DB). Falling back
 * to `updated_at` keeps those visible instead of silently dropping them; an item with
 * neither is treated as recent rather than hidden.
 */
export function isRecentlyDone(
  item: AirtableActionItem,
  now: number = Date.now(),
  windowDays: number = DONE_WINDOW_DAYS,
): boolean {
  const doneAt = timestamp(item.marked_done_at) ?? timestamp(item.updated_at);
  if (doneAt === null) return true;
  return now - doneAt <= windowDays * DAY_MS;
}

/**
 * The one group a card renders in — first match wins, so a card that is both tracked and
 * pinned shows up once, under Tracking.
 *
 * Returns null for anything the sidebar does not show: Blocked / Backlogged (never shown)
 * and Done outside the window.
 */
export function groupForItem(
  item: AirtableActionItem,
  ctx: Pick<SidebarGroupingContext, "trackingIds" | "stagedIds" | "pinnedIds"> & { now?: number },
): SidebarGroupKey | null {
  const id = item.airtable_id;
  if (ctx.trackingIds.has(id)) return "tracking";
  if (ctx.stagedIds.has(id)) return "staged";
  if (ctx.pinnedIds.has(id)) return "pinned";
  if (item.status === "In Progress") return "in_progress";
  if (item.status === "Open") return "open";
  if (item.status === "Done") return isRecentlyDone(item, ctx.now ?? Date.now()) ? "done" : null;
  return null;
}

/**
 * Do the ticked flags admit this card?
 *
 * Flags are independent predicates, not group membership: ticking "Open" shows every
 * `status === "Open"` card, including one sitting in the Tracking section. Union semantics
 * across ticked flags — otherwise a card could only ever be reached by the one flag matching
 * the section it happened to land in, which reads as a bug.
 *
 * An empty selection matches everything, so the default view is unchanged.
 */
export function matchesFlags(
  item: AirtableActionItem,
  ctx: Pick<SidebarGroupingContext, "trackingIds" | "stagedIds" | "pinnedIds" | "selectedFlags">,
): boolean {
  if (ctx.selectedFlags.size === 0) return true;
  const id = item.airtable_id;
  for (const flag of ctx.selectedFlags) {
    switch (flag) {
      case "tracking": if (ctx.trackingIds.has(id)) return true; break;
      case "staged": if (ctx.stagedIds.has(id)) return true; break;
      case "pinned": if (ctx.pinnedIds.has(id)) return true; break;
      case "in_progress": if (item.status === "In Progress") return true; break;
      case "open": if (item.status === "Open") return true; break;
      case "done": if (item.status === "Done") return true; break;
    }
  }
  return false;
}

export interface SidebarGroup {
  key: SidebarGroupKey;
  label: string;
  items: AirtableActionItem[];
}

/**
 * Bucket, filter and sort in one pass. Each group is `created_at` descending — newest at the
 * top — and empty groups are dropped so no header renders over nothing.
 */
export function groupActionItems(
  items: AirtableActionItem[],
  ctx: SidebarGroupingContext,
): SidebarGroup[] {
  const now = ctx.now ?? Date.now();
  const buckets = new Map<SidebarGroupKey, AirtableActionItem[]>();

  for (const item of items) {
    if (!matchesFlags(item, ctx)) continue;
    const key = groupForItem(item, { ...ctx, now });
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return SIDEBAR_GROUPS.flatMap(({ key, label }) => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length === 0) return [];
    // Stable sort, so items with an identical created_at keep the order the API gave them.
    const sorted = [...bucket].sort(
      (a, b) => (timestamp(b.created_at) ?? 0) - (timestamp(a.created_at) ?? 0),
    );
    return [{ key, label, items: sorted }];
  });
}
