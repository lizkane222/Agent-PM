import { skillRunsApi } from "../lib/api";
import type { SkillRunRow } from "../types/agents";
import { useResource } from "./useResource";

/** The signed-in user's skill runs (newest first). Admins may ask for everyone's with `all`. */
export function useSkillRuns(all = false) {
  return useResource<SkillRunRow>(
    () => skillRunsApi.list({ ...(all ? { scope: "all" as const } : {}), page_size: "100" }).then((r) => r.data.results),
    [all],
  );
}
