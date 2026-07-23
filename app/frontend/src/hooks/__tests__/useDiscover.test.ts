import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockApplets } from "../../test/handlers/discover";
import { useDiscover } from "../useDiscover";

const BASE = "/api/v1/discover/applets";

describe("useDiscover", () => {
  it("happy path: loads applet list on mount", async () => {
    const { result } = renderHook(() => useDiscover());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockApplets.length);
    expect(result.current.error).toBeNull();
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useDiscover());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("createApplet calls API and triggers refetch", async () => {
    const { result } = renderHook(() => useDiscover());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createApplet({
        name: "New Applet",
        description: "Desc",
        url: "https://example.com/new",
        type: "applet",
        category: "Tool",
        author: "Carol",
        tags: [],
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("updateApplet calls API and triggers refetch", async () => {
    const { result } = renderHook(() => useDiscover());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateApplet(1, { name: "Updated Name" });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("deleteApplet calls API and triggers refetch", async () => {
    const { result } = renderHook(() => useDiscover());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteApplet(1);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
