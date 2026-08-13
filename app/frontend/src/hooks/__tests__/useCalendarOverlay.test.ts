import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { server } from "../../test/msw-server";
import { http, HttpResponse } from "msw";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import useCalendarOverlay, { OVERLAY_PALETTE } from "../useCalendarOverlay";
import type { OverlayUser } from "../useCalendarOverlay";

const bobUser: OverlayUser = {
  username: "bob",
  displayName: "Bob",
  avatarUrl: "",
  color: OVERLAY_PALETTE[0],
};

describe("useCalendarOverlay", () => {
  it("addUser: fetches events and adds overlay", async () => {
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("overlay_user")) {
          return HttpResponse.json(mockCalendarEvents);
        }
        return HttpResponse.json([]);
      })
    );

    const { result } = renderHook(() => useCalendarOverlay(null));

    act(() => {
      result.current.addUser(bobUser);
    });

    await waitFor(() => expect(result.current.overlays).toHaveLength(1));
    expect(result.current.overlays[0].user.username).toBe("bob");
    expect(result.current.overlays[0].events.length).toBeGreaterThan(0);
  });

  it("addUser: does not add duplicate", async () => {
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json(mockCalendarEvents)
      )
    );

    const { result } = renderHook(() => useCalendarOverlay(null));

    act(() => {
      result.current.addUser(bobUser);
    });
    await waitFor(() => expect(result.current.overlays).toHaveLength(1));

    act(() => {
      result.current.addUser(bobUser);
    });
    // Allow any async ops to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.overlays).toHaveLength(1);
  });

  it("removeUser: removes the overlay", async () => {
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json(mockCalendarEvents)
      )
    );

    const { result } = renderHook(() => useCalendarOverlay(null));

    act(() => {
      result.current.addUser(bobUser);
    });
    await waitFor(() => expect(result.current.overlays).toHaveLength(1));

    act(() => {
      result.current.removeUser("bob");
    });
    expect(result.current.overlays).toHaveLength(0);
  });

  it("nextColor: returns first unused palette color", () => {
    const { result } = renderHook(() => useCalendarOverlay(null));
    expect(result.current.nextColor()).toBe(OVERLAY_PALETTE[0]);
  });
});
