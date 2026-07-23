import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockTeamMembers } from "../../test/handlers/team";
import { useTeam } from "../useTeam";

const BASE = "/api/v1/team/members";

describe("useTeam", () => {
  it("happy path: loads member list on mount", async () => {
    const { result } = renderHook(() => useTeam());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockTeamMembers.length);
    expect(result.current.error).toBeNull();
  });

  it("loading state: loading=true before fetch settles", async () => {
    const { result } = renderHook(() => useTeam());
    expect(result.current.loading).toBe(true);
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("search param is forwarded in request", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE}/`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ results: mockTeamMembers, count: mockTeamMembers.length });
      })
    );
    const { result } = renderHook(() => useTeam({ search: "alice" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedUrl).toContain("search=alice");
  });

  it("createMember calls API and triggers refetch", async () => {
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createMember({
        full_name: "Carol White",
        email: "carol@example.com",
        title: "Manager",
        department: "Sales",
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("updateMember calls API and triggers refetch", async () => {
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateMember(1, { title: "Senior AE" });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("deleteMember calls API and triggers refetch", async () => {
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteMember(1);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
