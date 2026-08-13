import { useState, useEffect } from "react";
import ActionItemsSidebar from "./ActionItemsSidebar";
import RemindersTabContent from "./RemindersTabContent";

export default function ItemsSidebar({ onDropToast, forceTab, expandItemId }: { onDropToast: (msg: string, type: "success" | "warn") => void; forceTab?: "action-items" | "reminders"; expandItemId?: string | null }) {
  const [tab, setTab] = useState<"action-items" | "reminders">(forceTab ?? "action-items");

  useEffect(() => {
    if (forceTab) setTab(forceTab);
  }, [forceTab]);
  return (
    <div className="flex flex-col h-full overflow-hidden bg-white border-l border-gray-200 shadow-2xl">
      {/* Spacer so the button row (absolute top-4 right-4) overlaps cleanly */}
      <div className="h-16 shrink-0" />

      {/* Tab body — each mounts/unmounts so state resets on switch */}
      {tab === "action-items" ? (
        <ActionItemsSidebar onDropToast={onDropToast} expandItemId={expandItemId} />
      ) : (
        <RemindersTabContent onDropToast={onDropToast} />
      )}
    </div>
  );
}
