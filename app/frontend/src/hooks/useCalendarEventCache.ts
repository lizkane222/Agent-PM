import { useCallback, useEffect, useRef, useState } from "react";
import { schedulerApi } from "../lib/api";
import { useAppError } from "../context/AppErrorContext";
import type { CalendarEvent } from "../types/scheduler";

const EVENT_CACHE_TTL_MS = 5 * 60 * 1000;

function eventCacheKey(start: string, end: string): string {
  return `calEvents::${start.slice(0, 10)}::${end.slice(0, 10)}`;
}

function readEventCache(start: string, end: string): CalendarEvent[] | null {
  try {
    const raw = sessionStorage.getItem(eventCacheKey(start, end));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: CalendarEvent[] };
    if (Date.now() - ts > EVENT_CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function writeEventCache(start: string, end: string, data: CalendarEvent[]): void {
  try {
    sessionStorage.setItem(eventCacheKey(start, end), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* storage full — best effort */ }
}

function bustEventCache(): void {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("calEvents::")) toDelete.push(k);
    }
    toDelete.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* best effort */ }
}

export interface UseCalendarEventCacheResult {
  events: CalendarEvent[];
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>;
  isLoading: boolean;
  eventsRef: React.RefObject<CalendarEvent[]>;
  localMutationRef: React.MutableRefObject<boolean>;
  fetchEvents: (start: string, end: string, opts?: { bustCache?: boolean }) => Promise<void>;
  handleDatesSet: (info: { startStr: string; endStr: string; view: { type: string } }) => void;
  bustCache: () => void;
}

export interface UseCalendarEventCacheParams {
  onFetchComplete?: (data: CalendarEvent[]) => void;
  onCurrentViewChange?: (view: string) => void;
  onVisibleRangeChange?: (range: { start: string; end: string }) => void;
}

export function useCalendarEventCache({
  onFetchComplete,
  onCurrentViewChange,
  onVisibleRangeChange,
}: UseCalendarEventCacheParams = {}): UseCalendarEventCacheResult {
  const { reportError } = useAppError();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const eventsRef = useRef<CalendarEvent[]>([]);
  const localMutationRef = useRef(false);

  // Stable refs for the callbacks so fetchEvents closure doesn't re-create on every render
  const onFetchCompleteRef = useRef(onFetchComplete);
  useEffect(() => { onFetchCompleteRef.current = onFetchComplete; }, [onFetchComplete]);

  const fetchEvents = useCallback(
    async (start: string, end: string, { bustCache: bust = false }: { bustCache?: boolean } = {}) => {
      try {
        const cached = bust ? null : readEventCache(start, end);
        let data: CalendarEvent[];
        if (cached) {
          data = cached;
        } else {
          const resp = await schedulerApi.listEvents({ start, end });
          data = resp.data;
          writeEventCache(start, end, data);
        }
        if (!localMutationRef.current) {
          setEvents(data);
          eventsRef.current = data;
        }
        onFetchCompleteRef.current?.(data);
      } catch (err) {
        reportError(
          err instanceof Error ? err.message : "Failed to load calendar events",
          "calendar",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [reportError],
  );

  const handleDatesSet = useCallback(
    (info: { startStr: string; endStr: string; view: { type: string } }) => {
      void fetchEvents(info.startStr, info.endStr);
      onVisibleRangeChange?.({ start: info.startStr, end: info.endStr });
      onCurrentViewChange?.(info.view.type);
    },
    [fetchEvents, onVisibleRangeChange, onCurrentViewChange],
  );

  return {
    events, setEvents, isLoading,
    eventsRef, localMutationRef,
    fetchEvents, handleDatesSet,
    bustCache: bustEventCache,
  };
}
