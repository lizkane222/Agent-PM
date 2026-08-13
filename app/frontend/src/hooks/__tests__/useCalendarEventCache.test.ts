import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { useCalendarEventCache } from "../useCalendarEventCache";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import type { CalendarEvent } from "../../types/scheduler";

const RANGE_START = "2026-07-28T00:00:00.000Z";
const RANGE_END = "2026-07-29T00:00:00.000Z";

const CACHE_KEY = `calEvents::2026-07-28::2026-07-29`;

const CACHED_EVENT: CalendarEvent = {
  id: 99,
  owner: 1,
  owner_username: "alice",
  title: "Cached Event",
  description: "",
  location: "",
  start_datetime: RANGE_START,
  end_datetime: RANGE_END,
  all_day: false,
  status: "confirmed",
  account: null,
  account_name: null,
  google_event_id: "cached-evt-99",
  meet_link: "",
  calendar_id: "",
  is_synced: false,
  agentpm_airtable_id: "",
  attendees: [],
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

describe("useCalendarEventCache", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("starts in loading state", () => {
    const { result } = renderHook(() => useCalendarEventCache());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.events).toEqual([]);
  });

  it("fetchEvents populates events and calls onFetchComplete", async () => {
    const onFetchComplete = vi.fn();
    const { result } = renderHook(() => useCalendarEventCache({ onFetchComplete }));

    await act(async () => {
      await result.current.fetchEvents(RANGE_START, RANGE_END);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.events).toEqual(mockCalendarEvents);
    });
    expect(onFetchComplete).toHaveBeenCalledWith(mockCalendarEvents);
  });

  it("serves from session cache when data is fresh", async () => {
    // Pre-populate cache with a different event than the MSW handler returns
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: [CACHED_EVENT] }));

    let apiCallCount = 0;
    server.use(
      http.get("/api/v1/scheduler/events/", () => {
        apiCallCount++;
        return HttpResponse.json(mockCalendarEvents);
      }),
    );

    const { result } = renderHook(() => useCalendarEventCache());
    await act(async () => {
      await result.current.fetchEvents(RANGE_START, RANGE_END);
    });

    expect(apiCallCount).toBe(0);
    expect(result.current.events).toEqual([CACHED_EVENT]);
  });

  it("bustCache + fetchEvents bypasses cache and refetches from API", async () => {
    // Pre-populate with stale data
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: [CACHED_EVENT] }));

    const { result } = renderHook(() => useCalendarEventCache());

    await act(async () => {
      result.current.bustCache();
      await result.current.fetchEvents(RANGE_START, RANGE_END, { bustCache: true });
    });

    // After explicit bust, should get fresh API data
    await waitFor(() => {
      expect(result.current.events).toEqual(mockCalendarEvents);
    });
  });

  it("API error leaves events empty and sets isLoading to false", async () => {
    server.use(
      http.get("/api/v1/scheduler/events/", () => new HttpResponse(null, { status: 500 })),
    );

    const { result } = renderHook(() => useCalendarEventCache());
    await act(async () => {
      await result.current.fetchEvents(RANGE_START, RANGE_END);
    });

    expect(result.current.events).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("localMutationRef.current=true prevents overwriting optimistic state", async () => {
    const { result } = renderHook(() => useCalendarEventCache());

    // Simulate an in-progress drag/drop optimistic update
    act(() => {
      result.current.localMutationRef.current = true;
      result.current.setEvents([CACHED_EVENT]);
    });

    await act(async () => {
      await result.current.fetchEvents(RANGE_START, RANGE_END);
    });

    // fetchEvents should NOT overwrite the optimistic state
    expect(result.current.events).toEqual([CACHED_EVENT]);
  });
});
