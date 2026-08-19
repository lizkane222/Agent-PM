import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { resetCommentSummaries } from "../../lib/commentSummaryStore";
import { resetRequestCache } from "../../lib/requestCache";
import { useCommentSummary } from "../useCommentSummary";
import type { CommentPreview } from "../../types";

const SUMMARY_URL = "/api/v1/comments/comments/summary/";

const preview: CommentPreview = {
  id: 1,
  resource_id: 10,
  author: 42,
  author_display: "Alice",
  content: "Needs a diagram.",
  created_at: "2026-01-01T00:00:00Z",
};

describe("useCommentSummary", () => {
  beforeEach(() => {
    resetCommentSummaries();
    resetRequestCache();
  });

  it("is undefined before the first fetch resolves", () => {
    const { result } = renderHook(() => useCommentSummary("action_item", 10));
    expect(result.current).toBeUndefined();
  });

  it("returns the count and previews once loaded", async () => {
    server.use(
      http.get(SUMMARY_URL, () =>
        HttpResponse.json({ results: { "10": { count: 3, comments: [preview] } } })
      )
    );

    const { result } = renderHook(() => useCommentSummary("action_item", 10));

    await waitFor(() => expect(result.current?.count).toBe(3));
    expect(result.current?.comments[0]?.content).toBe("Needs a diagram.");
  });

  it("resolves to a zero count for a record the server omitted", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));

    const { result } = renderHook(() => useCommentSummary("action_item", 10));

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.count).toBe(0);
    expect(result.current?.comments).toEqual([]);
  });

  it("stays undefined and sends no request for a null id", async () => {
    let called = false;
    server.use(
      http.get(SUMMARY_URL, () => {
        called = true;
        return HttpResponse.json({ results: {} });
      })
    );

    const { result } = renderHook(() => useCommentSummary("action_item", null));
    await new Promise((r) => setTimeout(r, 20));

    expect(result.current).toBeUndefined();
    expect(called).toBe(false);
  });

  it("two hooks on different records of one type share a single request", async () => {
    const seen: string[] = [];
    server.use(
      http.get(SUMMARY_URL, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("resource_ids") ?? "");
        return HttpResponse.json({
          results: { "10": { count: 1, comments: [preview] }, "11": { count: 2, comments: [] } },
        });
      })
    );

    const { result } = renderHook(() => ({
      a: useCommentSummary("action_item", 10),
      b: useCommentSummary("action_item", 11),
    }));

    await waitFor(() => expect(result.current.a?.count).toBe(1));
    expect(result.current.b?.count).toBe(2);
    expect(seen).toEqual(["10,11"]);
  });

  it("re-renders when the record's rollup is refreshed", async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_URL, () => {
        calls += 1;
        return HttpResponse.json({ results: { "10": { count: calls, comments: [] } } });
      })
    );

    const { result } = renderHook(() => useCommentSummary("action_item", 10));
    await waitFor(() => expect(result.current?.count).toBe(1));

    // Mirrors what happens after a comment is posted: the write clears the HTTP cache
    // (lib/requestCache.ts) and useComments invalidates the rollup.
    resetRequestCache();
    const { invalidateCommentSummary } = await import("../../lib/commentSummaryStore");
    invalidateCommentSummary("action_item", 10);

    await waitFor(() => expect(result.current?.count).toBe(2));
  });
});
