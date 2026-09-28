import { useCallback } from "react";
import { teamApi } from "../lib/api";
import { useResource } from "./useResource";
import type { TeamMemberDocument } from "../types/team";

export function useTeamMemberDocs(memberId: number | null) {
  const resource = useResource<TeamMemberDocument>(
    () =>
      memberId == null
        ? Promise.resolve([])
        : teamApi.listMemberDocuments(memberId).then((r) => r.data),
    [memberId ?? "none"],
  );

  const addDocument = useCallback(
    async (payload: { name: string; url: string }): Promise<TeamMemberDocument> => {
      if (memberId == null) throw new Error("No team member selected");
      const { data } = await teamApi.addMemberDocument(memberId, payload);
      resource.refetch();
      return data;
    },
    [memberId, resource.refetch],
  );

  const updateDocument = useCallback(
    async (
      id: number,
      payload: Partial<Pick<TeamMemberDocument, "name" | "url" | "position">>,
    ): Promise<TeamMemberDocument> => {
      const { data } = await teamApi.updateMemberDocument(id, payload);
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const removeDocument = useCallback(
    async (id: number): Promise<void> => {
      await teamApi.deleteMemberDocument(id);
      resource.refetch();
    },
    [resource.refetch],
  );

  return { ...resource, addDocument, updateDocument, removeDocument };
}
