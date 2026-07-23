import { useCallback } from "react";
import { schedulerApi } from "../lib/api";
import { useResource } from "./useResource";
import type { Reminder } from "../types/scheduler";

export type ReminderFilterTab = "pending" | "all" | "dismissed";

interface ReminderParams {
  tab: ReminderFilterTab;
}

export interface UseRemindersResult {
  data: Reminder[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  createReminder: (payload: Omit<Reminder, "id" | "created_by" | "created_by_username" | "created_at" | "updated_at">) => Promise<Reminder>;
  updateReminder: (id: number, payload: Partial<Reminder>) => Promise<Reminder>;
  deleteReminder: (id: number) => Promise<void>;
  dismissReminder: (id: number) => Promise<Reminder>;
}

export function useReminders({ tab }: ReminderParams): UseRemindersResult {
  const params: Record<string, string> = {};
  if (tab === "pending") params.status = "pending";
  if (tab === "dismissed") params.status = "dismissed";

  const resource = useResource<Reminder>(
    () => schedulerApi.listReminders(params).then((r) => r.data.results),
    [tab],
  );

  const createReminder = useCallback(
    async (payload: Omit<Reminder, "id" | "created_by" | "created_by_username" | "created_at" | "updated_at">) => {
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
