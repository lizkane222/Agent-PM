import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAgentTools } from "../../test/handlers/agents";
import { useAgentTools } from "../useAgentTools";

const URL = "/api/v1/agents/tools/";

describe("useAgentTools", () => {
  it("loading then happy path: unwraps the tools envelope", async () => {
    const { result } = renderHook(() => useAgentTools());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockAgentTools);
    expect(result.current.error).toBeNull();
  });

  it("error state", async () => {
    server.use(http.get(URL, () => HttpResponse.error()));
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("refetch re-reads the server", async () => {
    let calls = 0;
    server.use(http.get(URL, () => {
      calls += 1;
      return HttpResponse.json({ tools: calls === 1 ? [] : mockAgentTools });
    }));
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toEqual(mockAgentTools));
    expect(calls).toBe(2);
  });

  it("carries the server's policy flags through unchanged", async () => {
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const del = result.current.data.find((t) => t.name === "delete_action_item");
    expect(del).toMatchObject({ skill_safe: false, requires_confirmation: true });
  });
});
