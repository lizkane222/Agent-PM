import { useCallback } from "react";
import { skillPinsApi } from "../lib/api";
import type { PagePin, SkillPageKey } from "../types/agents";
import { useResource } from "./useResource";

/**
 * The Claude skills pinned to one page of the app, for the signed-in user: their own pins plus any
 * an admin pinned for everyone. Mutations wait for the server, then refetch, and re-throw so the
 * caller can show the message.
 */
export function usePagePins(page: SkillPageKey) {
  const res = useResource<PagePin>(() => skillPinsApi.list(page).then((r) => r.data.results), [page]);
  const { refetch } = res;

  const add = useCallback(async (skillId: number, everyone = false) => {
    await skillPinsApi.add(page, skillId, everyone);
    refetch();
  }, [page, refetch]);

  const remove = useCallback(async (pinId: number) => {
    await skillPinsApi.remove(pinId);
    refetch();
  }, [refetch]);

  return { ...res, add, remove };
}
