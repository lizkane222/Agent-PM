import { useCallback, useState } from "react";

const STORAGE_KEY = "acct-detail-collapsed-v1";

function loadState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function useSectionCollapse() {
  const [state, setState] = useState<Record<string, boolean>>(loadState);

  const toggle = useCallback((key: string) => {
    setState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  return {
    collapsed: (key: string) => !!state[key],
    toggle,
  };
}
