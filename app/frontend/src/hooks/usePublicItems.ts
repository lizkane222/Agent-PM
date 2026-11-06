import { useCallback } from "react";
import { publicItemsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { PublicItem } from "../types/team";

/** Public items for one member (`"me"` for the signed-in user). Writes are owner-only server-side. */
export function usePublicItems(memberId: number | "me" | null) {
  const resource = useResource<PublicItem>(
    () => (memberId === null ? Promise.resolve([]) : publicItemsApi.listForMember(memberId).then((r) => r.data)),
    [memberId],
  );

  const addItem = useCallback(
    async (payload: Partial<PublicItem> | FormData): Promise<PublicItem> => {
      const { data } = await publicItemsApi.create(payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const updateItem = useCallback(
    async (id: number, payload: Partial<PublicItem>): Promise<PublicItem> => {
      const { data } = await publicItemsApi.update(id, payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const removeItem = useCallback(
    async (id: number): Promise<void> => {
      await publicItemsApi.remove(id);
      resource.refetch();
    },
    [resource.refetch],
  );

  return { ...resource, addItem, updateItem, removeItem };
}
