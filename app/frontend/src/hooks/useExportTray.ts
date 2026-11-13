import { useRef, useEffect } from "react";
import { useExport } from "../context/ExportContext";
import type { AirtableActionItem } from "../types";

const TRAY_AUTO_CLOSE_MS = 5000;

export function useExportTray() {
  const { exportMode, toggleItem, isSelected, toggleMode } = useExport();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportModeRef = useRef(exportMode);
  const userTouchedRef = useRef(false);
  const ownToggleRef = useRef(false);

  useEffect(() => {
    exportModeRef.current = exportMode;
    // A mode change we did not make while the auto-close is pending means the user
    // took control of the tray: leave it as they set it.
    if (ownToggleRef.current) { ownToggleRef.current = false; return; }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      userTouchedRef.current = true;
    }
  }, [exportMode]);

  // Without this the pending auto-close fires after unmount and toggles the tray
  // from a tree that is gone.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function addToTray(item: AirtableActionItem) {
    const wasOff = !exportModeRef.current;
    // Only a tray the add itself opened may auto-close; one the user opened stays.
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
      userTouchedRef.current = false;
      ownToggleRef.current = true;
      toggleMode();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (exportModeRef.current && !userTouchedRef.current) {
          ownToggleRef.current = true;
          toggleMode();
        }
        timerRef.current = null;
      }, TRAY_AUTO_CLOSE_MS);
    }
  }

  return { addToTray, isSelected, exportMode };
}
