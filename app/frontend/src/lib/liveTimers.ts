/**
 * Live Tracking timers — a client cache of the server's running sessions.
 *
 * Timers used to live in this browser's localStorage (`actionItemTimers` / `activeTimers`),
 * with the calendar block's id held in a React ref. A reload, a second tab or a second
 * device lost track of the session, left zero-length blocks behind, and logged time twice.
 * The server now owns them (airtable_sync/live_tracking.py): one running session per user
 * and item, the block created on Start and resized on Stop, and both totals incremented
 * atomically. This module is the single client entry point for start / stop / cancel.
 *
 * Module-level external store for the same reason lib/localStore.ts is one: several pages
 * and cards read it at once. Mutations broadcast `liveTimersUpdated` (other tabs re-read)
 * and `actionItemsUpdated` (pages refetch the item's new totals), plus
 * CALENDAR_CHANGED_KEY so the calendar drops its event cache and shows the resized block now.
 */

import type { AirtableActionItem } from "../types";

export interface LiveTimer {
  id: number;
  action_item: string; // airtable_id
  task: string;
  account_name: string | null;
  started_at: string;
  ended_at: string | null;
  seconds: number;
  calendar_event: number | null;
}

export const LIVE_TIMERS_KEY = "liveTimersUpdated";
export const CALENDAR_CHANGED_KEY = "calendarEventsChanged";

let timers: Record<string, LiveTimer> = {};
let loaded = false;
let inflight: Promise<void> | null = null;
const subscribers = new Set<() => void>();
let listening = false;

function notify() {
  for (const cb of subscribers) cb();
}

/**
 * Tell other tabs the timers changed (a real `storage` event fires only there), and tell
 * this document's calendar / item lists to re-read. The store itself is already current, so
 * it must not hear its own LIVE_TIMERS_KEY — re-fetching there raced the write it just made.
 */
function broadcast({ itemsChanged = false }: { itemsChanged?: boolean } = {}) {
  const stamp = String(Date.now());
  try { localStorage.setItem(LIVE_TIMERS_KEY, stamp); } catch { /* private mode */ }
  const local = [CALENDAR_CHANGED_KEY, ...(itemsChanged ? ["actionItemsUpdated"] : [])];
  for (const key of local) {
    try { localStorage.setItem(key, stamp); } catch { /* private mode */ }
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: stamp }));
  }
}

function setAll(rows: LiveTimer[]) {
  timers = Object.fromEntries(rows.map((r) => [r.action_item, r]));
  loaded = true;
  notify();
}

async function api() {
  // Lazy for the same reason commentSummaryStore's is: test/setup imports this module to
  // reset it, and a static import would drag the axios client into the setup graph.
  return (await import("./api")).airtableApi;
}

function onStorage(e: StorageEvent) {
  if (e.key === LIVE_TIMERS_KEY) void refreshLiveTimers();
}

export function subscribeLiveTimers(cb: () => void): () => void {
  subscribers.add(cb);
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    listening = true;
  }
  if (!loaded) void refreshLiveTimers();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && listening) {
      window.removeEventListener("storage", onStorage);
      listening = false;
    }
  };
}

export function getLiveTimers(): Record<string, LiveTimer> {
  return timers;
}

/** Re-read running timers from the server (coalesces concurrent calls). */
export function refreshLiveTimers(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await (await api()).listTimers();
      setAll(data.results);
    } catch {
      /* keep what we have; the next mutation or focus refreshes */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function startLiveTimer(airtableId: string): Promise<LiveTimer> {
  const { data } = await (await api()).startTimer(airtableId);
  timers = { ...timers, [airtableId]: data.session };
  notify();
  broadcast();
  return data.session;
}

/** Stop and log. Resolves with the item's updated totals. */
export async function stopLiveTimer(airtableId: string): Promise<AirtableActionItem> {
  try {
    const { data } = await (await api()).stopTimer(airtableId);
    return data.item;
  } finally {
    // Whether it stopped or was already stopped elsewhere (409), it is not running here.
    const { [airtableId]: _gone, ...rest } = timers;
    timers = rest;
    notify();
    broadcast({ itemsChanged: true });
  }
}

/** Discard without logging (e.g. the block was removed from the calendar). */
export async function cancelLiveTimer(airtableId: string): Promise<void> {
  try {
    await (await api()).cancelTimer(airtableId);
  } finally {
    const { [airtableId]: _gone, ...rest } = timers;
    timers = rest;
    notify();
    broadcast();
  }
}

/** Seconds a running timer has been going, as of `now`. */
export function runningSeconds(t: LiveTimer | undefined, now: number = Date.now()): number {
  if (!t) return 0;
  return Math.max(0, Math.floor((now - new Date(t.started_at).getTime()) / 1000));
}

/** Test-only reset (wired into test/setup.ts). */
export function resetLiveTimers(): void {
  timers = {};
  loaded = false;
  inflight = null;
  notify();
}
