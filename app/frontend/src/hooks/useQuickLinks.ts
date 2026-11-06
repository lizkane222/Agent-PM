import { useCallback, useSyncExternalStore } from "react";
import { createLocalStore } from "../lib/localStore";

/**
 * Quick links — links a user adds to the "+ new file" list on their profile page.
 *
 * UI state kept in this browser (like focus pins), so they follow the browser, not the account.
 * Moving them to the server means a profile field and a migration; nothing here depends on it.
 */

export const QUICK_LINKS_KEY = "profileQuickLinks-v1";
export const MAX_QUICK_LINKS = 20;

export interface QuickLink {
  id: string;
  label: string;
  url: string;
}

/**
 * Turn what a user typed into an http(s) URL, or null if it is not one.
 * "docs.google.com/doc" is accepted (https:// is assumed); "javascript:…", "mailto:…" and a bare
 * word are not — a quick link opens in a new tab, so only web links are allowed.
 */
export function normalizeQuickLinkUrl(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text || /\s/.test(text)) return null;
  // "host:5173/x" reads as having a scheme ("host:") but is a host and port, so it is not one.
  const isHostPort = /^[^\s/:@]+:\d+(?:[/?#]|$)/.test(text);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !isHostPort;
  const withScheme = hasScheme ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // user:pass@host links are how a link is made to look like a different site.
    if (u.username || u.password) return null;
    // "https://foo" parses, but is never a site the user meant; localhost is the one real exception.
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A readable name for a link: its host, without "www.". */
export function quickLinkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const store = createLocalStore<QuickLink[]>(
  QUICK_LINKS_KEY,
  (raw) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (l): l is QuickLink =>
          !!l && typeof l.id === "string" && typeof l.url === "string" && typeof l.label === "string"
          // Re-check on read: the stored value is user-editable, and these become href attributes.
          && normalizeQuickLinkUrl(l.url) !== null,
      );
    } catch {
      return [];
    }
  },
  (value) => JSON.stringify(value),
);

export type AddQuickLinkResult =
  | { ok: true; link: QuickLink }
  | { ok: false; reason: "invalid" | "duplicate" | "full" };

export function addQuickLink(raw: string): AddQuickLinkResult {
  const url = normalizeQuickLinkUrl(raw);
  if (!url) return { ok: false, reason: "invalid" };
  const current = store.get();
  if (current.some((l) => l.url === url)) return { ok: false, reason: "duplicate" };
  if (current.length >= MAX_QUICK_LINKS) return { ok: false, reason: "full" };
  const link: QuickLink = {
    id: `ql-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: quickLinkLabel(url),
    url,
  };
  store.update((prev) => [...prev, link]);
  return { ok: true, link };
}

export function removeQuickLink(id: string): void {
  store.update((prev) => prev.filter((l) => l.id !== id));
}

/** Re-read from localStorage. Needed after `localStorage.clear()`, which fires no storage event. */
export function reloadQuickLinks(): void {
  store.reload();
}

export function useQuickLinks() {
  const links = useSyncExternalStore(store.subscribe, store.get, store.get);
  const add = useCallback((raw: string) => addQuickLink(raw), []);
  const remove = useCallback((id: string) => removeQuickLink(id), []);
  return { links, add, remove };
}
