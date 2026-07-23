import { useCallback } from "react";
import { teamApi } from "../lib/api";
import { useResource } from "./useResource";
import type { TeamMember } from "../types/team";

export function useTeam({ search }: { search?: string } = {}) {
  const params: Record<string, string> = {};
  if (search) params["search"] = search;

  const resource = useResource<TeamMember>(
    () => teamApi.listMembers(params).then((r) => r.data.results),
    [search ?? ""],
  );

  const createMember = useCallback(
    async (payload: Partial<TeamMember>): Promise<TeamMember> => {
      const { data } = await teamApi.createMember(payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const updateMember = useCallback(
    async (id: number, payload: Partial<TeamMember>): Promise<TeamMember> => {
      const { data } = await teamApi.updateMember(id, payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const deleteMember = useCallback(
    async (id: number): Promise<void> => {
      await teamApi.deleteMember(id);
      resource.refetch();
    },
    [resource.refetch],
  );

  return { ...resource, createMember, updateMember, deleteMember };
}
