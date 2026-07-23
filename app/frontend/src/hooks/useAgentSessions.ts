import { agentApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AgentSession } from "../types/agents";

export function useAgentSessions() {
  return useResource<AgentSession>(
    () => agentApi.listSessions().then((r) => r.data.results),
  );
}
