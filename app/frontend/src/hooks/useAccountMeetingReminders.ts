import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { schedulerApi } from "../lib/api";
import type { Reminder } from "../types";

export interface UseAccountMeetingRemindersResult {
  meetingReminders: Record<number, Reminder[]>;
  setMeetingReminders: Dispatch<SetStateAction<Record<number, Reminder[]>>>;
  handleAddMeetingReminder: (
    calendarEventId: number,
    accountId: number,
    calTitle: string
  ) => (due_at: string, title: string) => Promise<void>;
  handleDismissMeetingReminder: (calendarEventId: number, id: number) => Promise<void>;
}

export function useAccountMeetingReminders(): UseAccountMeetingRemindersResult {
  const [meetingReminders, setMeetingReminders] = useState<Record<number, Reminder[]>>({});

  function handleAddMeetingReminder(
    calendarEventId: number,
    _accountId: number,
    calTitle: string
  ) {
    return async (due_at: string, title: string) => {
      const { data } = await schedulerApi.createReminder({
        title,
        due_at,
        resource_type: "calendar_event",
        resource_id: calendarEventId,
        resource_label: calTitle,
        notify_in_app: true,
      });
      setMeetingReminders((prev) => ({
        ...prev,
        [calendarEventId]: [...(prev[calendarEventId] ?? []), data],
      }));
    };
  }

  async function handleDismissMeetingReminder(calendarEventId: number, id: number) {
    await schedulerApi.dismissReminder(id);
    setMeetingReminders((prev) => ({
      ...prev,
      [calendarEventId]: (prev[calendarEventId] ?? []).map((r) =>
        r.id === id ? { ...r, status: "dismissed" as const } : r
      ),
    }));
  }

  return {
    meetingReminders,
    setMeetingReminders,
    handleAddMeetingReminder,
    handleDismissMeetingReminder,
  };
}
