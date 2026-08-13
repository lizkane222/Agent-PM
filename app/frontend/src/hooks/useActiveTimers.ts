import { useEffect, useState } from "react";
import type { ActiveTimer } from "../types/calendar";
import type { CalendarEvent } from "../types/scheduler";

export function useActiveTimers(): {
  activeTimers: Record<string, ActiveTimer>;
  timerEvents: CalendarEvent[];
} {
  const [activeTimers, setActiveTimers] = useState<Record<string, ActiveTimer>>(() => {
    try { return JSON.parse(localStorage.getItem("activeTimers") ?? "{}"); } catch { return {}; }
  });

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "activeTimers") {
        try { setActiveTimers(JSON.parse(e.newValue ?? "{}")); } catch { /* ignore malformed */ }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Tick every second while at least one timer is running so end times update live
  useEffect(() => {
    if (Object.keys(activeTimers).length === 0) return;
    const id = setInterval(() => setActiveTimers((prev) => ({ ...prev })), 1000);
    return () => clearInterval(id);
  }, [activeTimers]);

  const now = Date.now();
  const timerEvents: CalendarEvent[] = Object.entries(activeTimers).map(([id, t]) => ({
    id: -(Math.abs(id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) + 1),
    owner: 0,
    owner_username: t.accountName ?? "",
    google_event_id: `active-timer-${id}`,
    title: `⏱ ${t.task}`,
    description: "",
    location: "",
    start_datetime: new Date(t.startedAt).toISOString(),
    end_datetime: new Date(now).toISOString(),
    all_day: false,
    status: "confirmed" as const,
    attendees: [],
    meet_link: "",
    calendar_id: "work_tracking",
    is_synced: false,
    agentpm_airtable_id: id,
    account: null,
    account_name: t.accountName ?? null,
    created_at: "",
    updated_at: "",
  }));

  return { activeTimers, timerEvents };
}
