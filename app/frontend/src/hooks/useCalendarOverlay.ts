import { useCallback, useEffect, useRef, useState } from "react";
import { schedulerApi } from "../lib/api";
import type { CalendarEvent } from "../types";
import type { OverlayUser } from "../types/calendar";

export type { OverlayUser };

export interface CalendarOverlay {
  user: OverlayUser;
  events: CalendarEvent[];
}

export const OVERLAY_PALETTE = [
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#ea580c", // orange
  "#65a30d", // lime
  "#0d9488", // teal
];

export default function useCalendarOverlay(
  dateRange: { start: string; end: string } | null
): {
  overlays: CalendarOverlay[];
  addUser: (user: OverlayUser) => void;
  removeUser: (username: string) => void;
  nextColor: () => string;
} {
  const [overlays, setOverlays] = useState<CalendarOverlay[]>([]);
  const overlaysRef = useRef<CalendarOverlay[]>([]);
  overlaysRef.current = overlays;
  const dateRangeRef = useRef(dateRange);
  dateRangeRef.current = dateRange;

  const addUser = useCallback((user: OverlayUser) => {
    if (overlaysRef.current.some((o) => o.user.username === user.username)) return;
    const params: Record<string, string> = { overlay_user: user.username };
    const dr = dateRangeRef.current;
    if (dr?.start) params.start = dr.start;
    if (dr?.end) params.end = dr.end;
    schedulerApi
      .listEvents(params)
      .then(({ data }) => {
        setOverlays((prev) => {
          if (prev.some((o) => o.user.username === user.username)) return prev;
          return [...prev, { user, events: data as CalendarEvent[] }];
        });
      })
      .catch(() => {});
  }, []);

  const removeUser = useCallback((username: string) => {
    setOverlays((prev) => prev.filter((o) => o.user.username !== username));
  }, []);

  useEffect(() => {
    if (!dateRange || overlaysRef.current.length === 0) return;
    const params = { start: dateRange.start, end: dateRange.end };
    Promise.all(
      overlaysRef.current.map((o) =>
        schedulerApi
          .listEvents({ ...params, overlay_user: o.user.username })
          .then(({ data }) => ({ ...o, events: data as CalendarEvent[] }))
          .catch(() => o)
      )
    ).then(setOverlays);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange?.start, dateRange?.end]);

  const nextColor = useCallback((): string => {
    const used = new Set(overlaysRef.current.map((o) => o.user.color));
    return OVERLAY_PALETTE.find((c) => !used.has(c)) ?? OVERLAY_PALETTE[overlaysRef.current.length % OVERLAY_PALETTE.length];
  }, []);

  return { overlays, addUser, removeUser, nextColor };
}
