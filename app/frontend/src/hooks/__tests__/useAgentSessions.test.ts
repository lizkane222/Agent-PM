import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAgentSessions } from "../../test/handlers/agents";
import { useAgentSessions } from "../useAgentSessions";

describe("useAgentSessions", () => {
  it("happy path: loads session list on mount", async () => {
    const { result } = renderHook(() => useAgentSessions());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockAgentSessions.length);
    expect(result.current.data[0].title).toBe(mockAgentSessions[0].title);
    expect(result.current.error).toBeNull();
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get("/api/v1/agents/sessions/", () => HttpResponse.error()));
    const { result } = renderHook(() => useAgentSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("refetch: re-runs the fetcher and updates data", async () => {
    const { result } = renderHook(() => useAgentSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockAgentSessions.length);
    result.current.refetch();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockAgentSessions.length);
  });
});
