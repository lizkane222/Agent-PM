import { useEffect, useState } from "react";

const SCHEDULED_ITEMS_KEY = "scheduledActionItems";

interface ScheduledItem {
  airtableId: string;
  task: string;
  accountName: string | null;
  start: string;
  end: string;
}

function readItems(): ScheduledItem[] {
  try {
    return JSON.parse(localStorage.getItem(SCHEDULED_ITEMS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Returns all scheduled calendar occurrences for the given airtable_id
 * that are today or in the future, sorted ascending by start time.
 * Re-evaluates whenever localStorage changes.
 */
export function useScheduledOccurrences(airtableId: string): ScheduledItem[] {
  const [occurrences, setOccurrences] = useState<ScheduledItem[]>(() =>
    getOccurrences(airtableId)
  );

  useEffect(() => {
    function compute() {
      setOccurrences(getOccurrences(airtableId));
    }
    compute();
    window.addEventListener("storage", compute);
    return () => window.removeEventListener("storage", compute);
  }, [airtableId]);

  return occurrences;
}

function getOccurrences(airtableId: string): ScheduledItem[] {
  const now = new Date();
  // Use start of today so items scheduled earlier today still show
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return readItems()
    .filter((i) => i.airtableId === airtableId && new Date(i.start) >= todayStart)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}
