import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import { useCalendarEvents } from "../useCalendarEvents";

describe("useCalendarEvents", () => {
  it("happy path: loads event list on mount", async () => {
    const { result } = renderHook(() => useCalendarEvents());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockCalendarEvents.length);
    expect(result.current.error).toBeNull();
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get("/api/v1/scheduler/events/", () => HttpResponse.error()));
    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("params are forwarded in request", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(mockCalendarEvents);
      })
    );
    const { result } = renderHook(() =>
      useCalendarEvents({ ordering: "-start_datetime", page_size: "200" })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain("ordering=-start_datetime");
    expect(capturedUrl).toContain("page_size=200");
  });
});
