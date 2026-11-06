import { useCallback } from "react";
import { notificationsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AppNotification } from "../types/team";

export function useNotifications({ channel, kind }: { channel?: string; kind?: string } = {}) {
  const params: Record<string, string> = {};
  if (channel) params.channel = channel;
  if (kind) params.kind = kind;

  const resource = useResource<AppNotification>(
    () => notificationsApi.list(params).then((r) => r.data.results),
    [channel ?? "", kind ?? ""],
  );

  const markRead = useCallback(
    async (ids?: number[]): Promise<void> => {
      await notificationsApi.markRead(ids);
      resource.refetch();
    },
    [resource.refetch],
  );

  return { ...resource, markRead };
}
