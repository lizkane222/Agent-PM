import { useRef, useEffect } from "react";
import { useExport } from "../context/ExportContext";
import type { AirtableActionItem } from "../types";

const TRAY_AUTO_CLOSE_MS = 5000;

export function useExportTray() {
  const { exportMode, toggleItem, isSelected, toggleMode } = useExport();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportModeRef = useRef(exportMode);

  useEffect(() => { exportModeRef.current = exportMode; }, [exportMode]);

  function addToTray(item: AirtableActionItem) {
    const wasOff = !exportModeRef.current;
    toggleItem({
      id: `action_item:${item.airtable_id}`,
      type: "action_item",
      label: item.task || "Untitled",
      summary: [item.status, item.priority, item.account_name].filter(Boolean).join(" · "),
      content: [
        `Action Item: ${item.task || "Untitled"}`,
        `Status: ${item.status}`,
        `Priority: ${item.priority}`,
        item.account_name ? `Account: ${item.account_name}` : "",
        item.assignee_name ? `Assignee: ${item.assignee_name}` : "",
        item.due_date ? `Due: ${item.due_date}` : "",
        item.task_details ? `Details: ${item.task_details}` : "",
      ].filter(Boolean).join("\n"),
      accountName: item.account_name ?? undefined,
    });
    if (wasOff) {
      toggleMode();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (exportModeRef.current) toggleMode();
        timerRef.current = null;
      }, TRAY_AUTO_CLOSE_MS);
    }
  }

  return { addToTray, isSelected, exportMode };
}
