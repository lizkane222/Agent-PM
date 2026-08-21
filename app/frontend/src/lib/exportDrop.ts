import type React from "react";
import { EXPORT_ITEM_DRAG_KEY } from "../components/ExportBar";
import type { ExportItem } from "../context/ExportContext";

/**
 * Reading an export-tray pill off a drop.
 *
 * The tray drags with the HTML5 API (`draggable` + `dataTransfer`), not dnd-kit.
 * The two protocols are invisible to each other: dnd-kit is driven by pointer
 * events and never looks at `dataTransfer`, so a `useDroppable` alone will never
 * see a tray pill. Any surface that wants to accept one needs this pair.
 */

/**
 * True if the drag in flight carries a tray pill.
 *
 * Must be used instead of `readExportItem` in `onDragOver`: during a drag the
 * payload is in "protected mode" and `getData()` returns `""` — only the list of
 * `types` is readable until the actual drop. Checking `types` also means we don't
 * claim drags that belong to some other feature.
 */
export function isExportItemDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(EXPORT_ITEM_DRAG_KEY);
}

/** Parse the pill out of a drop event. Returns null for any other drag. */
export function readExportItem(e: React.DragEvent): ExportItem | null {
  try {
    const raw = e.dataTransfer.getData(EXPORT_ITEM_DRAG_KEY);
    if (!raw) return null;
    const item = JSON.parse(raw) as ExportItem;
    return item && typeof item.id === "string" ? item : null;
  } catch {
    return null; // malformed payload
  }
}

/**
 * `onDragOver` for a surface that accepts tray pills. `preventDefault()` is what
 * makes the surface a drop target at all — without it the browser cancels and the
 * `drop` event never fires, which is the single most common way this silently
 * "does nothing".
 */
export function acceptExportItemDragOver(e: React.DragEvent): boolean {
  if (!isExportItemDrag(e)) return false;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  return true;
}
