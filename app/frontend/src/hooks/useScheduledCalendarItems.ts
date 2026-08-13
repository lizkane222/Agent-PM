import { useEffect, useState } from "react";
import type { ScheduledItem, ScheduledReminder } from "../types/calendar";

const SCHEDULED_ITEMS_KEY = "scheduledActionItems";
const SCHEDULED_REMINDERS_KEY = "scheduledReminders";

function readScheduledItems(): ScheduledItem[] {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_ITEMS_KEY) ?? "[]"); } catch { return []; }
}

function readScheduledReminders(): ScheduledReminder[] {
  try { return JSON.parse(localStorage.getItem(SCHEDULED_REMINDERS_KEY) ?? "[]"); } catch { return []; }
}

export function useScheduledCalendarItems() {
  const [scheduledItems, setScheduledItems] = useState<ScheduledItem[]>(() => readScheduledItems());
  const [scheduledReminders, setScheduledReminders] = useState<ScheduledReminder[]>(() => readScheduledReminders());

  // Sync from localStorage when ActionItemsPage/RemindersPage writes from another tab
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SCHEDULED_ITEMS_KEY) setScheduledItems(readScheduledItems());
      if (e.key === SCHEDULED_REMINDERS_KEY) setScheduledReminders(readScheduledReminders());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function addScheduledItem(item: ScheduledItem): ScheduledItem | null {
    const existing = readScheduledItems();
    const startMin = item.start.slice(0, 16);
    if (existing.find((i) => i.airtableId === item.airtableId && i.start.slice(0, 16) === startMin)) return null;
    const uid = item.uid ?? `sched-${item.airtableId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const saved = { ...item, uid };
    const next = [...existing, saved];
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(next) }));
    setScheduledItems(next);
    return saved;
  }

  function removeScheduledItem(airtableId: string): void {
    const next = readScheduledItems().filter((i) => i.airtableId !== airtableId);
    localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(next) }));
    setScheduledItems(next);
  }

  function addScheduledReminder(reminder: ScheduledReminder): boolean {
    const existing = readScheduledReminders();
    const startMin = reminder.start.slice(0, 16);
    if (existing.find((i) => i.reminderId === reminder.reminderId && i.start.slice(0, 16) === startMin)) return false;
    const next = [...existing, reminder];
    localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(next) }));
    setScheduledReminders(next);
    return true;
  }

  function removeScheduledReminder(reminderId: number): void {
    const next = readScheduledReminders().filter((r) => r.reminderId !== reminderId);
    localStorage.setItem(SCHEDULED_REMINDERS_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_REMINDERS_KEY, newValue: JSON.stringify(next) }));
    setScheduledReminders(next);
  }

  return {
    scheduledItems, setScheduledItems,
    scheduledReminders, setScheduledReminders,
    addScheduledItem, removeScheduledItem,
    addScheduledReminder, removeScheduledReminder,
  };
}
