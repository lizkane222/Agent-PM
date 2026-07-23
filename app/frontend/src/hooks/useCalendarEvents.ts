import { schedulerApi } from "../lib/api";
import { useResource } from "./useResource";
import type { CalendarEvent } from "../types/scheduler";

export function useCalendarEvents(params?: Record<string, string>) {
  const stableKey = JSON.stringify(params ?? {});
  return useResource<CalendarEvent>(
    () => schedulerApi.listEvents(params).then((r) => r.data ?? []),
    [stableKey],
  );
}
