/**
 * Right-click menu plumbing for <SensitiveText>.
 *
 * A SensitiveText does NOT open its own menu on right-click, because many surfaces (cards,
 * calendar events) already have one and two competing menus would be wrong. Instead it
 * records what it can offer for that exact browser event (`registerSensitiveContext`):
 *
 *  - A surface WITH its own menu appends `sensitiveMenuItems(e)` to its items.
 *  - If nobody calls preventDefault() on the event, the single document-level listener
 *    here opens a small menu of its own. Right-clicking anything that is not sensitive-
 *    capable keeps the browser default.
 *
 * The menu lives in its own React root (it needs no app context), so it works from any
 * tree -- including portals and tests that render a bare component.
 *
 * Display only: these actions mask text in this app's UI; the data stays stored and
 * readable via the API and exports. This is a screen-share aid, not access control.
 */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ContextMenu, type ContextMenuItem } from "../action-items/ContextMenu";
import { SENSITIVE_NOTE, clearRecentSensitiveItems, leaveRecentSensitiveItems } from "./sensitiveRecent";

export { SENSITIVE_NOTE };

export interface SensitiveContext {
  items: ContextMenuItem[];
}

const contexts = new WeakMap<Event, SensitiveContext>();

/** First (innermost) registration for an event wins. */
export function registerSensitiveContext(ev: Event, ctx: SensitiveContext): void {
  if (!contexts.has(ev)) {
    contexts.set(ev, ctx);
    leaveRecentSensitiveItems(ctx.items);
  }
  ensureHost();
}

/** Menu entries for the right-click `e`, or [] when it did not land on sensitive-capable text. */
export function sensitiveMenuItems(e: { nativeEvent: Event } | Event): ContextMenuItem[] {
  const ev = "nativeEvent" in e ? e.nativeEvent : e;
  return contexts.get(ev)?.items ?? [];
}

/** Open the sensitive-text menu at a point with a surface's own items already merged in. */
export function openSensitiveMenu(x: number, y: number, items: ContextMenuItem[]): void {
  ensureHost();
  clearRecentSensitiveItems();
  state = { ...state, menu: { x, y, items } };
  paint();
}

/** Run a mutation from a menu item; a failure becomes a short on-screen message. */
export function runSensitiveAction(fn: () => Promise<unknown>): void {
  fn().catch(() => showToast("Could not update the hidden text. Nothing was changed."));
}

// ── host ─────────────────────────────────────────────────────────────────────

interface HostState { menu: { x: number; y: number; items: ContextMenuItem[] } | null; toast: string | null }
let state: HostState = { menu: null, toast: null };
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let listening = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function Host({ s }: { s: HostState }) {
  return (
    <>
      {s.menu && (
        <ContextMenu x={s.menu.x} y={s.menu.y} items={s.menu.items} note={SENSITIVE_NOTE} sensitive={false} onClose={closeMenu} />
      )}
      {s.toast && (
        <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border px-3 py-2 text-sm shadow-lg"
          style={{ zIndex: 10001, background: "var(--surface-card)", color: "var(--text-ink)", borderColor: "var(--border-subtle)" }}>
          {s.toast}
        </div>
      )}
    </>
  );
}

function paint() {
  if (!root) return;
  flushSync(() => root!.render(<Host s={state} />));
}

function closeMenu() {
  state = { ...state, menu: null };
  paint();
}

function showToast(message: string) {
  state = { ...state, toast: message };
  paint();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state = { ...state, toast: null }; paint(); }, 4000);
}

function onDocumentContextMenu(ev: MouseEvent) {
  const ctx = contexts.get(ev);
  if (!ctx || ev.defaultPrevented || ctx.items.length === 0) return;
  ev.preventDefault();
  clearRecentSensitiveItems();
  state = { ...state, menu: { x: ev.clientX, y: ev.clientY, items: ctx.items } };
  paint();
}

function ensureHost() {
  if (!container) {
    container = document.createElement("div");
    container.setAttribute("data-sensitive-menu-host", "");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  if (!listening) {
    document.addEventListener("contextmenu", onDocumentContextMenu);
    listening = true;
  }
}

/** Test-only: close the menu/toast between tests. */
export function resetSensitiveMenu(): void {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  clearRecentSensitiveItems();
  state = { menu: null, toast: null };
  if (root) paint();
}

/**
 * Append the sensitive-text entries (captured from the right-click event) to a surface's own
 * menu items, after a separator. Returns `items` unchanged when there are none.
 */
export function withSensitiveItems(items: ContextMenuItem[], sensitive: ContextMenuItem[]): ContextMenuItem[] {
  if (sensitive.length === 0) return items;
  return [...items, { separator: true, label: "", onClick: () => {} }, ...sensitive];
}
