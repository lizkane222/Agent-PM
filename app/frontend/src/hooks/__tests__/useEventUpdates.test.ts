import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockEventUpdate } from "../../test/handlers/realtime";
import { useEventUpdates } from "../useEventUpdates";

const URL = "/api/v1/realtime/activity/event-updates/";

describe("useEventUpdates", () => {
  it("starts loading, then returns the change entries", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ results: [mockEventUpdate()] })));
    const { result } = renderHook(() => useEventUpdates());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data[0].title).toBe('Event created: "Kickoff"');
  });

  it("is empty when nothing has changed", async () => {
    const { result } = renderHook(() => useEventUpdates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces an error", async () => {
    server.use(http.get(URL, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useEventUpdates());
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("refetch reads the feed again", async () => {
    let hits = 0;
    server.use(http.get(URL, () => { hits += 1; return HttpResponse.json({ results: [] }); }));
    const { result } = renderHook(() => useEventUpdates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refetch());
    await waitFor(() => expect(hits).toBe(2));
  });
});
