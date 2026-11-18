import { useCallback } from "react";
import { accountsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { ArtifactNote } from "../types";

export interface UseArtifactNotesResult {
  /** Every note and reply on the artifact, newest first (the server's order). */
  data: ArtifactNote[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  addNote: (html: string, parentId?: number | null) => Promise<ArtifactNote>;
  editNote: (id: number, html: string) => Promise<ArtifactNote>;
  removeNote: (id: number) => Promise<void>;
}

/** Notes (and threaded replies) on one artifact. `artifactId` null/undefined fetches nothing. */
export function useArtifactNotes(artifactId: number | null | undefined): UseArtifactNotesResult {
  const resource = useResource<ArtifactNote>(
    () => (artifactId ? accountsApi.listArtifactNotes(artifactId).then((r) => r.data.results) : Promise.resolve([])),
    [artifactId],
  );
  const refetch = resource.refetch;

  const addNote = useCallback(async (html: string, parentId?: number | null) => {
    if (!artifactId) throw new Error("No artifact to add a note to.");
    const { data } = await accountsApi.createArtifactNote({ artifact: artifactId, html, parent: parentId ?? null });
    refetch();
    return data;
  }, [artifactId, refetch]);

  const editNote = useCallback(async (id: number, html: string) => {
    const { data } = await accountsApi.updateArtifactNote(id, html);
    refetch();
    return data;
  }, [refetch]);

  const removeNote = useCallback(async (id: number) => {
    await accountsApi.deleteArtifactNote(id);
    refetch();
  }, [refetch]);

  return { ...resource, addNote, editNote, removeNote };
}
