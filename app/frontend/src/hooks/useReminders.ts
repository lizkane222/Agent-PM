import { useCallback } from "react";
import { schedulerApi } from "../lib/api";
import { useResource } from "./useResource";
import type { Reminder, ReminderLink } from "../types/scheduler";

/** What a new reminder needs. Notifying other people is opt-in and needs the user's approval. */
type NewReminderPayload =
  Omit<Reminder, "id" | "created_by" | "created_by_username" | "created_at" | "updated_at" | "recipients" | "recipient_details" | "occurrences" | "links">
  & { recipients?: number[]; links?: ReminderLink[]; confirm_notify_others?: boolean };

export type ReminderFilterTab = "pending" | "all" | "dismissed";

interface ReminderParams {
  tab: ReminderFilterTab;
}

export interface UseRemindersResult {
  data: Reminder[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  createReminder: (payload: NewReminderPayload) => Promise<Reminder>;
  updateReminder: (id: number, payload: Partial<Reminder>) => Promise<Reminder>;
  deleteReminder: (id: number) => Promise<void>;
  dismissReminder: (id: number) => Promise<Reminder>;
}

export function useReminders({ tab }: ReminderParams): UseRemindersResult {
  // Most recent first: the page reads top-down from the newest due time. `page_size` because the
  // default page would silently cut a long history off at the oldest end.
  const params: Record<string, string> = { ordering: "-due_at", page_size: "500" };
  if (tab === "pending") params.status = "pending";
  if (tab === "dismissed") params.status = "dismissed";

  const resource = useResource<Reminder>(
    () => schedulerApi.listReminders(params).then((r) => r.data.results),
    [tab],
  );

  const createReminder = useCallback(
    async (payload: NewReminderPayload) => {
      const { data } = await schedulerApi.createReminder(payload);
      resource.refetch();
      return data;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource.refetch],
  );

  const updateReminder = useCallback(
    async (id: number, payload: Partial<Reminder>) => {
      const { data } = await schedulerApi.updateReminder(id, payload);
      resource.refetch();
      return data;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource.refetch],
  );

  const deleteReminder = useCallback(
    async (id: number) => {
      await schedulerApi.deleteReminder(id);
      resource.refetch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource.refetch],
  );

  const dismissReminder = useCallback(
    async (id: number) => {
      const { data } = await schedulerApi.dismissReminder(id);
      resource.refetch();
      return data;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource.refetch],
  );

  return { ...resource, createReminder, updateReminder, deleteReminder, dismissReminder };
}
