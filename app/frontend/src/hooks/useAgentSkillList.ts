import { agentSkillsApi } from "../lib/api";
import type { AgentSkill } from "../types/agents";
import { useResource } from "./useResource";

/** Every Agent PM skill the signed-in user can see (their own plus published ones). */
export function useAgentSkillList() {
  return useResource<AgentSkill>(() => agentSkillsApi.list().then((r) => r.data.results ?? []));
}
