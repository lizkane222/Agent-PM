import { realtimeApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AgentActivityEvent } from "../types";

/** Changes made to the caller's calendar events (the Activity Log's Events tab). */
export function useEventUpdates() {
  return useResource<AgentActivityEvent>(() => realtimeApi.listEventUpdates().then((r) => r.data.results));
}
