import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { usePublicItems } from "../usePublicItems";

describe("usePublicItems", () => {
  it("loads a member's items", async () => {
    let seen = "";
    server.use(http.get("/api/v1/team/public-items/", ({ request }) => {
      seen = new URL(request.url).search;
      return HttpResponse.json([{ id: 1, title: "Handbook" }]);
    }));
    const { result } = renderHook(() => usePublicItems(2));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen).toContain("member=2");
    expect(result.current.data).toHaveLength(1);
  });

  it("does not fetch without a member", async () => {
    let hit = false;
    server.use(http.get("/api/v1/team/public-items/", () => { hit = true; return HttpResponse.json([]); }));
    const { result } = renderHook(() => usePublicItems(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hit).toBe(false);
  });

  it("surfaces an error", async () => {
    server.use(http.get("/api/v1/team/public-items/", () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => usePublicItems("me"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it.each([
    ["addItem", "post", (r: ReturnType<typeof usePublicItems>) => r.addItem({ item_type: "note", title: "n" })],
    ["updateItem", "patch", (r: ReturnType<typeof usePublicItems>) => r.updateItem(1, { title: "z" })],
    ["removeItem", "delete", (r: ReturnType<typeof usePublicItems>) => r.removeItem(1)],
  ] as const)("%s calls the API then refetches", async (_n, method, run) => {
    let gets = 0;
    let writes = 0;
    server.use(
      http.get("/api/v1/team/public-items/", () => { gets += 1; return HttpResponse.json([]); }),
      http[method]("/api/v1/team/public-items/*", () => { writes += 1; return HttpResponse.json({ id: 1 }, { status: method === "post" ? 201 : 200 }); }),
    );
    const { result } = renderHook(() => usePublicItems("me"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await run(result.current); });
    expect(writes).toBe(1);
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });
});
