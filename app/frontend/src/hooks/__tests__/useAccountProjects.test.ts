import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockProject } from "../../test/handlers/accounts";
import { useAccountProjects } from "../useAccountProjects";

const PROJECTS_URL = "/api/v1/accounts/projects/";

describe("useAccountProjects", () => {
  it("loads every visible project in one request, asking for a big page", async () => {
    const urls: string[] = [];
    server.use(http.get(PROJECTS_URL, ({ request }) => {
      urls.push(request.url);
      return HttpResponse.json({ results: [mockProject], count: 1 });
    }));
    const { result } = renderHook(() => useAccountProjects());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.get("page_size")).toBe("500");
    expect(new URL(urls[0]).searchParams.get("account")).toBeNull();
  });

  it("error state", async () => {
    server.use(http.get(PROJECTS_URL, () => HttpResponse.error()));
    const { result } = renderHook(() => useAccountProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("refetch reloads", async () => {
    let n = 0;
    server.use(http.get(PROJECTS_URL, () => { n++; return HttpResponse.json({ results: [], count: 0 }); }));
    const { result } = renderHook(() => useAccountProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refetch());
    await waitFor(() => expect(n).toBe(2));
  });

  it("setActionIds patches each row then refetches once", async () => {
    const patches: { url: string; body: unknown }[] = [];
    let gets = 0;
    server.use(
      http.get(PROJECTS_URL, () => { gets++; return HttpResponse.json({ results: [mockProject], count: 1 }); }),
      http.patch(`${PROJECTS_URL}:id/`, async ({ request }) => {
        patches.push({ url: request.url, body: await request.json() });
        return HttpResponse.json(mockProject);
      }),
    );
    const { result } = renderHook(() => useAccountProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setActionIds([{ id: 1, action_ids: ["a"] }, { id: 2, action_ids: [] }]);
    });
    expect(patches.map((p) => p.body)).toEqual([{ action_ids: ["a"] }, { action_ids: [] }]);
    await waitFor(() => expect(gets).toBe(2));
  });

  it("setActionIds re-throws a failed write and still refetches", async () => {
    let gets = 0;
    server.use(
      http.get(PROJECTS_URL, () => { gets++; return HttpResponse.json({ results: [], count: 0 }); }),
      http.patch(`${PROJECTS_URL}:id/`, () => new HttpResponse(null, { status: 403 })),
    );
    const { result } = renderHook(() => useAccountProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.setActionIds([{ id: 1, action_ids: [] }])).rejects.toBeTruthy();
    });
    await waitFor(() => expect(gets).toBe(2));
  });
});
