/**
 * Builds the right-click offer for one sensitive-capable field element: "Hide this line",
 * "Hide selected text" (only with a non-collapsed selection inside the element) -- or, on a
 * mask, "Show hidden text". Used by <SensitiveText> (read-only text) and
 * <SensitiveEditable> (an editor: a textarea, input or rich-text field).
 */
import type React from "react";
import type { ContextMenuItem } from "../action-items/ContextMenu";
import { normalizeWs } from "../../lib/sensitiveMatch";
import type { SensitiveMark } from "../../types/sensitive";
import { registerSensitiveContext, runSensitiveAction } from "./sensitiveMenu";

export const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div";
const MAX_SNIPPET = 2000;

export interface FieldContextArgs {
  isHtml: boolean;
  field: string;
  lineKey: string;
  mark: (a: { field: string; text: string; lineKey?: string }) => Promise<SensitiveMark>;
  unmark: (id: number) => Promise<void>;
}

export function registerFieldContext(e: React.MouseEvent<HTMLElement>, el: HTMLElement, a: FieldContextArgs): void {
  const target = e.target as Element;
  const maskNode = target.closest?.("[data-sensitive-mask]");
  if (maskNode && el.contains(maskNode)) {
    const markId = Number(maskNode.getAttribute("data-mark-id"));
    registerSensitiveContext(e.nativeEvent, {
      items: [{ label: "Show hidden text (remove hiding)", onClick: () => runSensitiveAction(() => a.unmark(markId)) }],
    });
    return;
  }
  const items: ContextMenuItem[] = [];
  let picked = "";
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const { selectionStart: s, selectionEnd: en, value } = target;
    if (s !== null && en !== null && en > s) picked = normalizeWs(value.slice(s, en));
  } else {
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      picked = normalizeWs(sel.toString());
    }
  }
  picked = picked.slice(0, MAX_SNIPPET);
  if (picked) {
    items.push({ label: "Hide selected text", onClick: () => runSensitiveAction(() => a.mark({ field: a.field, text: picked })) });
  }
  let lineText = "";
  if (a.isHtml) {
    const block = target.closest?.(BLOCK_SELECTOR);
    if (block && block !== el && el.contains(block)) {
      const t = normalizeWs(block.textContent ?? "");
      if (t && t !== normalizeWs(el.textContent ?? "")) lineText = t.slice(0, MAX_SNIPPET);
    }
  }
  items.push({ label: "Hide this line", onClick: () => runSensitiveAction(() => a.mark({ field: a.field, text: lineText, lineKey: lineText ? "" : a.lineKey })) });
  registerSensitiveContext(e.nativeEvent, { items });
}
