// Lightweight in-memory + localStorage app activity log.
// Each entry is serialized to localStorage AND persisted to the backend so
// data survives localStorage clears. Max 200 entries kept locally (oldest dropped).

import { realtimeApi } from "./api";

export type LogCategory = "account" | "team" | "action_item" | "calendar" | "comment_reply";

export interface LogResource {
  type: "account" | "action_item" | "calendar_event" | "reminder";
  // For Django-backed records use numeric id; for Airtable-backed records use string airtable_id
  id: number | string;
}

export interface LogEntry {
  id: string;
  ts: number; // Date.now()
  category: LogCategory;
  message: string;
  // Optional links: each has a label and a path (react-router path, may include ?glow=1)
  links?: { label: string; path: string }[];
  // Optional pointer to the record this event belongs to
  resource?: LogResource;
  // Opaque snapshot enabling a "Restore" undo for conversion operations
  restoreData?: Record<string, unknown>;
}

const STORAGE_KEY = "appActivityLog";
const MAX_ENTRIES = 200;

function readAll(): LogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as LogEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: LogEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

export function addLog(entry: Omit<LogEntry, "id" | "ts">) {
  const full: LogEntry = {
    ...entry,
    id: Math.random().toString(36).slice(2),
    ts: Date.now(),
  };
  const existing = readAll();
  writeAll([...existing, full]);
  // Notify LogsPage if it's mounted
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "1" }));

  // Persist to backend (fire-and-forget — never blocks the UI)
  realtimeApi.createActivity({
    event_type: full.category,
    title: full.message,
    metadata: {
      ...(full.links ? { links: full.links } : {}),
      ...(full.resource ? { resource: full.resource } : {}),
    },
    client_id: full.id,
    client_ts: full.ts,
  }).catch(() => {
    // Silently swallow — local log already written
  });
}

export function patchLog(id: string, patch: Partial<Pick<LogEntry, "restoreData" | "links">>) {
  const all = readAll().map((e) => e.id === id ? { ...e, ...patch } : e);
  writeAll(all);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "1" }));
}

export function getLogs(): LogEntry[] {
  return readAll().slice().reverse(); // newest first
}

export function getLogsForResource(type: LogResource["type"], id: number | string): LogEntry[] {
  const sid = String(id);
  return readAll()
    .filter((e) => e.resource?.type === type && String(e.resource.id) === sid)
    .reverse();
}

/**
 * Fetch the last 500 events from the backend and merge them into localStorage,
 * deduplicating by client_id. Call this on app load or when localStorage has
 * been cleared so local state is restored from the server.
 */
export async function syncLogsFromBackend(): Promise<void> {
  try {
    const resp = await realtimeApi.listActivity();
    const remote = resp.data.results ?? [];
    const existing = readAll();
    const existingIds = new Set(existing.map((e) => e.id));

    const restored: LogEntry[] = [];
    for (const ev of remote) {
      const clientId = (ev as unknown as { client_id?: string }).client_id;
      const clientTs = (ev as unknown as { client_ts?: number }).client_ts;
      // Only restore frontend-originated events (those with a client_id and a frontend category)
      if (!clientId || existingIds.has(clientId)) continue;
      const category = ev.event_type as LogCategory;
      if (!["account", "team", "action_item", "calendar"].includes(category)) continue;
      const meta = ev.metadata as { links?: { label: string; path: string }[]; resource?: LogResource };
      restored.push({
        id: clientId,
        ts: clientTs ?? new Date(ev.created_at).getTime(),
        category,
        message: ev.title,
        links: meta.links,
        resource: meta.resource,
      });
    }

    if (restored.length > 0) {
      // Merge restored entries with any still-present local ones, re-sort by ts
      const merged = [...existing, ...restored].sort((a, b) => a.ts - b.ts);
      writeAll(merged);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "1" }));
    }
  } catch {
    // Backend unreachable — local log (even if empty) is the fallback
  }
}

/** Write a backend-sourced event to localStorage without POSTing back to the server. */
export function addBackendLog(entry: { id: string; ts: number; category: string; message: string }): void {
  const existing = readAll();
  if (existing.some((e) => e.id === entry.id)) return; // deduplicate
  const full: LogEntry = {
    id: entry.id,
    ts: entry.ts,
    category: entry.category as LogCategory,
    message: entry.message,
  };
  writeAll([...existing, full]);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "1" }));
}

export { STORAGE_KEY as LOG_STORAGE_KEY };
