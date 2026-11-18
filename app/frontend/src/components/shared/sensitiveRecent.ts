/**
 * Hand-off between <SensitiveText> and whichever context menu a surface opens for the same
 * right-click. Kept free of runtime imports so `ContextMenu` can use it without a cycle.
 *
 * When SensitiveText registers its entries for a right-click it also leaves them here for a
 * moment; the shared `ContextMenu` picks them up when it mounts (same click, a few ms later)
 * and appends them -- so every card/row menu in the app gains "Hide this line / Hide selected
 * text / Show hidden text" without each surface wiring it.
 */
import type { ContextMenuItem } from "../action-items/ContextMenu";

export const SENSITIVE_NOTE =
  "Hiding only masks the text on screen in this app, for everyone. The data is still stored and readable through the API and exports, so this is a screen-share aid, not access control.";

const WINDOW_MS = 250;
let recent: { items: ContextMenuItem[]; at: number } | null = null;

export function leaveRecentSensitiveItems(items: ContextMenuItem[]): void {
  recent = { items, at: performance.now() };
}

/**
 * Entries from the right-click that just happened. Not consumed on read: React StrictMode
 * runs a state initializer twice, and the short window is what keeps a later, unrelated menu clean.
 */
export function takeRecentSensitiveItems(): ContextMenuItem[] {
  const r = recent;
  return r && performance.now() - r.at < WINDOW_MS ? r.items : [];
}

export function clearRecentSensitiveItems(): void {
  recent = null;
}
