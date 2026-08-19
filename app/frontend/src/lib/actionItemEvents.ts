/**
 * Cross-page freshness for action items.
 *
 * Several pages render action items at once — the Action Items board, the Calendar
 * sidebar, Account Detail, Dashboard — and each keeps its own copy in component state.
 * They stay in sync by listening for a `storage` event on `actionItemsUpdated`.
 *
 * The broadcast used to be the caller's job, repeated by hand at every mutation site, so
 * a create was only as fresh as whoever remembered to announce it — three creation paths
 * (including the Account Detail "New action item" form) never did, which is why an item
 * made there never reached the Calendar sidebar. `installActionItemChangeBroadcast` in
 * lib/api.ts now fires this for every action item mutation, so no call site can forget.
 *
 * Both halves are needed: `localStorage.setItem` reaches *other* tabs (the browser fires
 * the real event there) but never the tab that wrote it, so the synthetic dispatch is what
 * notifies listeners in this document.
 */

export const ACTION_ITEMS_UPDATED_KEY = "actionItemsUpdated";

export function notifyActionItemsChanged(): void {
  const stamp = String(Date.now());
  try {
    localStorage.setItem(ACTION_ITEMS_UPDATED_KEY, stamp);
  } catch { /* private mode / quota — the in-document dispatch below still works */ }
  window.dispatchEvent(
    new StorageEvent("storage", { key: ACTION_ITEMS_UPDATED_KEY, newValue: stamp })
  );
}

/**
 * Does a non-GET request to `url` change an action item itself?
 *
 * Deliberately excludes nested `/attachments/` and the separate `/airtable/steps/` routes.
 * Those change an item's *contents*, and broadcasting on them would make every page reload
 * on each checklist tick — including remounting whatever modal the user is typing in. The
 * component that owns those refetches them directly.
 */
export function isActionItemMutationUrl(url: string): boolean {
  if (url.includes("/attachments")) return false;
  return url.includes("/airtable/action-items") || url.includes("/scheduler/action-items");
}
