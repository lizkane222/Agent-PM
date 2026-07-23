import { useCallback } from "react";
import { discoverApi } from "../lib/api";
import { useResource } from "./useResource";
import type { DiscoverApplet } from "../types/discover";

export function useDiscover() {
  const resource = useResource<DiscoverApplet>(
    () => discoverApi.listApplets({ page_size: "200" }).then((r) => r.data.results),
  );

  const createApplet = useCallback(
    async (payload: Partial<DiscoverApplet>): Promise<DiscoverApplet> => {
      const { data } = await discoverApi.createApplet(payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const updateApplet = useCallback(
    async (id: number, payload: Partial<DiscoverApplet>): Promise<DiscoverApplet> => {
      const { data } = await discoverApi.updateApplet(id, payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const deleteApplet = useCallback(
    async (id: number): Promise<void> => {
      await discoverApi.deleteApplet(id);
      resource.refetch();
    },
    [resource.refetch],
  );

  return { ...resource, createApplet, updateApplet, deleteApplet };
}
