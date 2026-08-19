/**
 * Tests for the comment-rollup cache.
 *
 * The point of this module is request coalescing: a page rendering N record cards must
 * produce one batched request per resource type, not N requests. Request counts are
 * therefore asserted at the network layer via MSW, not by mocking lib/api.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import {
  EMPTY_SUMMARY,
  getCommentSummary,
  invalidateCommentSummary,
  requestCommentSummary,
  resetCommentSummaries,
  subscribeCommentSummaries,
} from "../commentSummaryStore";
import { resetRequestCache } from "../requestCache";
import type { CommentPreview } from "../../types";

const SUMMARY_URL = "/api/v1/comments/comments/summary/";

function preview(id: number, resourceId: number, content: string): CommentPreview {
  return {
    id,
    resource_id: resourceId,
    author: 1,
    author_display: "Alice",
    content,
    created_at: "2026-01-01T00:00:00Z",
  };
}

/** Resolve once the store notifies, i.e. once a batch has landed. */
function nextNotification(): Promise<void> {
  return new Promise((resolve) => {
    const unsub = subscribeCommentSummaries(() => { unsub(); resolve(); });
  });
}

describe("commentSummaryStore", () => {
  beforeEach(() => {
    resetCommentSummaries();
    // apiClient coalesces identical GETs; without this a "was it requested again?"
    // assertion would be answered by the HTTP cache rather than the store.
    resetRequestCache();
  });

  it("coalesces many registrations of one resource type into a single request", async () => {
    const seen: string[] = [];
    server.use(
      http.get(SUMMARY_URL, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("resource_ids") ?? "");
        return HttpResponse.json({ results: {} });
      })
    );

    for (const id of [1, 2, 3, 4, 5]) requestCommentSummary("action_item", id);
    await nextNotification();

    expect(seen).toEqual(["1,2,3,4,5"]);
  });

  it("splits by resource type — one request each, not one per record", async () => {
    const seen: Array<{ type: string | null; ids: string | null }> = [];
    server.use(
      http.get(SUMMARY_URL, ({ request }) => {
        const p = new URL(request.url).searchParams;
        seen.push({ type: p.get("resource_type"), ids: p.get("resource_ids") });
        return HttpResponse.json({ results: {} });
      })
    );

    requestCommentSummary("action_item", 1);
    requestCommentSummary("calendar_event", 7);
    requestCommentSummary("action_item", 2);
    await nextNotification();

    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual({ type: "action_item", ids: "1,2" });
    expect(seen).toContainEqual({ type: "calendar_event", ids: "7" });
  });

  it("splits a very long id list into several requests", async () => {
    // The backend rejects more than 500 ids; MAX_BATCH keeps a big Views grid split
    // into a few requests rather than one 400.
    const sizes: number[] = [];
    server.use(
      http.get(SUMMARY_URL, ({ request }) => {
        const ids = new URL(request.url).searchParams.get("resource_ids") ?? "";
        sizes.push(ids.split(",").length);
        return HttpResponse.json({ results: {} });
      })
    );

    for (let id = 1; id <= 450; id += 1) requestCommentSummary("action_item", id);
    await vi.waitFor(() => expect(getCommentSummary("action_item", 450)).toBeDefined());

    expect(sizes).toEqual([200, 200, 50]);
  });

  it("stores the count and previews returned for a record", async () => {
    server.use(
      http.get(SUMMARY_URL, () =>
        HttpResponse.json({
          results: { "10": { count: 5, comments: [preview(1, 10, "first"), preview(2, 10, "second")] } },
        })
      )
    );

    requestCommentSummary("action_item", 10);
    await nextNotification();

    const summary = getCommentSummary("action_item", 10);
    expect(summary?.count).toBe(5);
    expect(summary?.comments.map((c) => c.content)).toEqual(["first", "second"]);
  });

  it("caches an empty snapshot for ids the server omitted", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));

    requestCommentSummary("action_item", 99);
    await nextNotification();

    expect(getCommentSummary("action_item", 99)).toEqual(EMPTY_SUMMARY);
  });

  it("does not re-request an id it already has cached", async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_URL, () => {
        calls += 1;
        return HttpResponse.json({ results: {} });
      })
    );

    requestCommentSummary("action_item", 1);
    await nextNotification();
    expect(calls).toBe(1);

    requestCommentSummary("action_item", 1);
    // Give the flush timer a chance to fire if it were scheduled at all.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
  });

  it("returns undefined for an id that has never been fetched", () => {
    expect(getCommentSummary("action_item", 1234)).toBeUndefined();
  });

  it("invalidate drops the cached value and refetches it", async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_URL, () => {
        calls += 1;
        return HttpResponse.json({
          results: { "10": { count: calls, comments: [preview(calls, 10, `v${calls}`)] } },
        });
      })
    );

    requestCommentSummary("action_item", 10);
    await nextNotification();
    expect(getCommentSummary("action_item", 10)?.count).toBe(1);

    // In the app, invalidate() is only ever called right after a comment POST/PATCH/
    // DELETE, and any write through apiClient clears the whole GET cache (see
    // lib/requestCache.ts). Reproduce that here — otherwise the refetch is served the
    // pre-mutation body from the 10s TTL cache and this asserts nothing about the store.
    resetRequestCache();
    invalidateCommentSummary("action_item", 10);

    // invalidate() notifies synchronously (to clear the stale value) and again once the
    // refetch lands, so wait on the value rather than on a single notification.
    await vi.waitFor(() => expect(getCommentSummary("action_item", 10)?.count).toBe(2));
    expect(calls).toBe(2);
  });

  it("leaves ids uncached when the request fails, so a later mount retries", async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_URL, () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      })
    );

    requestCommentSummary("action_item", 5);
    await nextNotification();
    expect(getCommentSummary("action_item", 5)).toBeUndefined();

    resetRequestCache();
    requestCommentSummary("action_item", 5);
    await nextNotification();
    expect(calls).toBe(2);
  });

  it("ignores non-positive ids rather than asking about them", async () => {
    let called = false;
    server.use(
      http.get(SUMMARY_URL, () => {
        called = true;
        return HttpResponse.json({ results: {} });
      })
    );

    requestCommentSummary("action_item", 0);
    await new Promise((r) => setTimeout(r, 10));

    expect(called).toBe(false);
  });

  it("notifies subscribers when a batch lands, and stops after unsubscribe", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));

    let hits = 0;
    const unsub = subscribeCommentSummaries(() => { hits += 1; });
    requestCommentSummary("action_item", 1);
    await vi.waitFor(() => expect(hits).toBeGreaterThan(0));

    unsub();
    const before = hits;
    resetCommentSummaries();
    resetRequestCache();
    requestCommentSummary("action_item", 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(hits).toBe(before);
  });
});
