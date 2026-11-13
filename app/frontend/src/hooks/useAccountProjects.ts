import { useCallback } from "react";
import { accountsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AccountProject } from "../types/accounts";

/**
 * Every project and goal (a goal is an `AccountProject` with `kind: "goal"`) the caller can
 * see, across all accounts. One request: the Action Items page's Projects view needs the
 * lot, and a request per account is the fan-out this repo's throttle punishes.
 */
export function useAccountProjects() {
  const resource = useResource<AccountProject>(
    () => accountsApi.listAllProjects().then((r) => r.data.results),
    [],
  );

  /**
   * Rewrite the `action_ids` of several projects/goals together (a move touches the new
   * owner and every old one). One refetch at the end; a failure re-throws so the page can
   * say so, and the refetch still runs so the view reflects whatever did get written.
   */
  const setActionIds = useCallback(
    async (updates: { id: number; action_ids: string[] }[]): Promise<void> => {
      try {
        await Promise.all(updates.map((u) => accountsApi.updateProject(u.id, { action_ids: u.action_ids })));
      } finally {
        resource.refetch();
      }
    },
    [resource.refetch],
  );

  return { ...resource, setActionIds };
}
