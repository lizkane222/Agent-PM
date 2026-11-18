import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { sensitiveMarksResponse } from "../../test/handlers/sensitive";
import { useSensitiveMarks } from "../useSensitiveMarks";

const mark = { id: 5, field: "task", text: "secret", line_key: "" };

describe("useSensitiveMarks", () => {
  it("is undefined while loading, then the marks", async () => {
    server.use(sensitiveMarksResponse({ "7": [mark] }));
    const { result } = renderHook(() => useSensitiveMarks("action_item", 7));
    expect(result.current.marks).toBeUndefined();
    await waitFor(() => expect(result.current.marks).toEqual([mark]));
  });

  it("never fetches for local ids or missing ids", async () => {
    let hits = 0;
    server.use(http.get("/api/v1/sensitive/marks/", () => { hits++; return HttpResponse.json({ results: {} }); }));
    renderHook(() => useSensitiveMarks("action_item", "local-1"));
    renderHook(() => useSensitiveMarks("action_item", null));
    await new Promise((r) => setTimeout(r, 40));
    expect(hits).toBe(0);
  });

  it("mark posts and updates every consumer; unmark deletes; errors re-throw", async () => {
    const posts: unknown[] = [];
    server.use(
      http.post("/api/v1/sensitive/marks/", async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(mark, { status: 201 });
      }),
      http.delete("/api/v1/sensitive/marks/5/", () => new HttpResponse(null, { status: 204 })),
    );
    const a = renderHook(() => useSensitiveMarks("action_item", 7));
    const b = renderHook(() => useSensitiveMarks("action_item", 7));
    await waitFor(() => expect(a.result.current.marks).toEqual([]));
    await act(async () => { await a.result.current.mark({ field: "task", text: "secret" }); });
    expect(posts[0]).toMatchObject({ resource_type: "action_item", resource_id: "7", field: "task", text: "secret" });
    await waitFor(() => expect(b.result.current.marks).toEqual([mark]));
    await act(async () => { await a.result.current.unmark(5); });
    await waitFor(() => expect(b.result.current.marks).toEqual([]));

    server.use(http.post("/api/v1/sensitive/marks/", () => HttpResponse.json({}, { status: 404 })));
    await expect(a.result.current.mark({ field: "task", text: "x" })).rejects.toBeTruthy();
  });
});
