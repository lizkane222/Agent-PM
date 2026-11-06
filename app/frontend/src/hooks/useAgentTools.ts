import { agentToolsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AgentTool } from "../types/agents";

/**
 * The agent's tool registry as the server enforces it (GET /agents/tools/).
 *
 * Read-only: tools are defined in code on the server, so there are no mutations. The
 * Skills page reads `skill_safe` from here instead of a hard-coded list, which had drifted
 * (it kept offering delete tools to skill authors after the server stopped allowing them).
 */
export function useAgentTools() {
  return useResource<AgentTool>(() => agentToolsApi.list().then((r) => r.data.tools));
}
