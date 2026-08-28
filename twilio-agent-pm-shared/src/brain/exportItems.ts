import type { ExportItem } from "../types.js";

export function toggleExportItem(items: ExportItem[], item: ExportItem): ExportItem[] {
  const exists = items.some((i) => i.id === item.id);
  return exists ? items.filter((i) => i.id !== item.id) : [...items, item];
}
