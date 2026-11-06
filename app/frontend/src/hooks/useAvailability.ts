import { useCallback, useEffect, useState } from "react";
import { schedulerApi } from "../lib/api";
import type { PersonAvailability } from "../lib/availability";

/**
 * Busy time for the people being compared, for the visible range. One batched request per
 * range/people change (not one per person — the old overlay fan-out is what this repo's 429
 * history warns against). Not a `useResource` hook: the response is a keyed object for a
 * caller-chosen set of people, not an entity list.
 */
export function useAvailability(emails: string[], range: { start: string; end: string } | null) {
  const [people, setPeople] = useState<PersonAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = emails.join(",");

  useEffect(() => {
    if (!range || emails.length === 0) { setPeople([]); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    schedulerApi.getAvailability(emails, range.start, range.end)
      .then(({ data }) => { if (!cancelled) { setPeople(data.people); setError(null); } })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(msg ?? "Could not load availability");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // `key` stands in for `emails`, whose identity changes every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range?.start, range?.end, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { people, loading, error, refetch };
}
