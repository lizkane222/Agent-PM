import { useState, useEffect, useCallback, useRef } from "react";
import { clearGetCache } from "../lib/requestCache";

export interface UseResourceResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useResource<T>(
  fetcher: () => Promise<T[]>,
  deps: readonly unknown[] = [],
): UseResourceResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  // Stable refetch — incrementing tick re-runs the effect without requiring
  // the caller to manage a refresh trigger.
  //
  // Clearing the GET cache first is what makes refetch mean what it says. GETs are
  // coalesced and briefly cached (lib/requestCache.ts); without this, a refetch inside
  // the TTL would be answered from memory and the caller would see the same data it
  // already had. Clearing wholesale rather than by key because the fetcher is an opaque
  // thunk here — useResource never sees the URL. refetch is a user action or a
  // post-mutation step, not a hot path, so the bluntness costs nothing.
  const refetch = useCallback(() => {
    clearGetCache();
    setTick((n) => n + 1);
  }, []);

  // Keep a stable ref to the fetcher so the effect only re-runs when deps/tick
  // change, not when the fetcher identity changes on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcherRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, refetch };
}
