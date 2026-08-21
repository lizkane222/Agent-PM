import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { SearchResult } from "../lib/api";

export interface ExportItem {
  id: string; // e.g. "account:123", "action_item:abc"
  type: "account" | "action_item" | "reminder" | "calendar_event" | "team_member" | "note";
  label: string;
  summary: string;
  content: string; // full text injected into chat
  accountId?: number;
  accountName?: string;
  // Fields carried when the item came from a search result
  url?: string;
  accent?: string;
  detail?: string;
  typeLabel?: string;
}

/** Convert a SearchResult into the ExportItem shape used by the rest of the system. */
export function searchResultToExportItem(r: SearchResult): ExportItem {
  const knownTypes = ["account", "action_item", "reminder", "calendar_event", "team_member", "note"] as const;
  type KnownType = typeof knownTypes[number];
  const mappedType: KnownType = (knownTypes as readonly string[]).includes(r.type as string)
    ? (r.type as KnownType)
    : "note";

  return {
    id: `${r.type}:${r.id}`,
    type: mappedType,
    label: r.title,
    summary: r.detail ?? "",
    content: [r.title, r.detail, r.meta, r.account].filter(Boolean).join("\n"),
    accountName: r.account || undefined,
    url: r.url,
    accent: r.accent,
    detail: r.detail,
    typeLabel: r.type_label,
  };
}

interface ExportContextValue {
  exportMode: boolean;
  items: ExportItem[];
  toggleMode: () => void;
  toggleItem: (item: ExportItem) => void;
  isSelected: (id: string) => boolean;
  clearItems: () => void;
  count: number;
}

const STORAGE_KEY = "agentpm_export_tray";

function loadPersistedItems(): ExportItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExportItem[]) : [];
  } catch { return []; }
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: React.ReactNode }) {
  const [exportMode, setExportMode] = useState(() => loadPersistedItems().length > 0);
  const [items, setItems] = useState<ExportItem[]>(loadPersistedItems);

  // Mirror of `items` so `toggleItem` can decide add-vs-remove without depending
  // on a captured render value (two picks in the same tick would otherwise make
  // the second one read a stale list).
  const itemsRef = useRef(items);

  function persist(next: ExportItem[]) {
    try {
      if (next.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage full */ }
  }

  function commitItems(next: ExportItem[]) {
    itemsRef.current = next;
    setItems(next);
    persist(next);
  }

  /**
   * Open/close the tray. Deliberately does NOT empty it: closing is a view
   * action, and the tray is the user's collected work. `clearItems` (the tray's
   * own "Clear" button) is the only thing that discards.
   */
  const toggleMode = useCallback(() => setExportMode((v) => !v), []);

  const toggleItem = useCallback((item: ExportItem) => {
    const exists = itemsRef.current.some((i) => i.id === item.id);
    commitItems(
      exists ? itemsRef.current.filter((i) => i.id !== item.id) : [...itemsRef.current, item]
    );
    // Picking something must reveal where it went — otherwise the item lands in
    // a tray the user can't see.
    if (!exists) setExportMode(true);
  }, []);

  const isSelected = useCallback(
    (id: string) => items.some((i) => i.id === id),
    [items]
  );

  const clearItems = useCallback(() => { commitItems([]); }, []);

  return (
    <ExportContext.Provider
      value={{ exportMode, items, toggleMode, toggleItem, isSelected, clearItems, count: items.length }}
    >
      {children}
    </ExportContext.Provider>
  );
}

export function useExport() {
  const ctx = useContext(ExportContext);
  if (!ctx) throw new Error("useExport must be inside ExportProvider");
  return ctx;
}
