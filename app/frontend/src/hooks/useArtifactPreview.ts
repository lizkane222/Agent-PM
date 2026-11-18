import { useEffect, useState } from "react";
import { accountsApi } from "../lib/api";
import type { ArtifactPreviewResult } from "../types";

export interface UseArtifactPreviewResult {
  /** null until the first response; the server's description of the file afterwards. */
  data: ArtifactPreviewResult | null;
  loading: boolean;
  /** The request itself failed (network, 404 for an invisible artifact). */
  error: Error | null;
}

/**
 * Server-side preview of one artifact file (text, CSV, HTML, Office, archives).
 * One object, not a `T[]`, so this is not built on `useResource` (same exemption as
 * `useMyTokenBudget`). Does nothing while `enabled` is false.
 */
export function useArtifactPreview(artifactId: number | null | undefined, enabled = true): UseArtifactPreviewResult {
  const [data, setData] = useState<ArtifactPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !artifactId) { setData(null); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    accountsApi.getArtifactPreview(artifactId)
      .then(({ data: d }) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e : new Error("Preview failed")); setLoading(false); } });
    return () => { cancelled = true; };
  }, [artifactId, enabled]);

  return { data, loading, error };
}
