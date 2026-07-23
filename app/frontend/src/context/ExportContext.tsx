import { createContext, useCallback, useContext, useState } from "react";
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

  function persist(next: ExportItem[]) {
    try {
      if (next.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage full */ }
  }

  const toggleMode = useCallback(() => {
    setExportMode((v) => {
      if (v) {
        setItems([]);
        persist([]);
      }
      return !v;
    });
  }, []);

  const toggleItem = useCallback((item: ExportItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      const next = exists ? prev.filter((i) => i.id !== item.id) : [...prev, item];
      persist(next);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => items.some((i) => i.id === id),
    [items]
  );

  const clearItems = useCallback(() => { setItems([]); persist([]); }, []);

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
