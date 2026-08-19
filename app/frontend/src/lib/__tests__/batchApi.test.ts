/**
 * Tests for the batched API client helpers that replaced per-item fan-outs.
 * Each of these used to be called once per item, which tripped the backend's
 * DRF user throttle (200/min) and surfaced 429s.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { accountsApi, schedulerApi } from "../api";

describe("accountsApi.listArtifactsForAccounts", () => {
  it("sends all account IDs as one comma-separated batch", async () => {
    let seenIds: string | null = null;
    server.use(
      http.get("/api/v1/accounts/accounts/artifacts-batch/", ({ request }) => {
        seenIds = new URL(request.url).searchParams.get("ids");
        return HttpResponse.json([]);
      })
    );

    await accountsApi.listArtifactsForAccounts([3, 1, 2]);

    expect(seenIds).toBe("3,1,2");
  });

  it("resolves a flat list, matching the per-account route's shape", async () => {
    const res = await accountsApi.listArtifactsForAccounts([1, 2]);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("resolves empty without hitting the network when given no IDs", async () => {
    let called = false;
    server.use(
      http.get("/api/v1/accounts/accounts/artifacts-batch/", () => {
        called = true;
        return HttpResponse.json([]);
      })
    );

    const res = await accountsApi.listArtifactsForAccounts([]);

    expect(res.data).toEqual([]);
    expect(called).toBe(false);
  });

  it("is not shadowed by the account-detail route", async () => {
    // "artifacts-batch" sits where an account ID goes. If route matching resolved it
    // as a detail lookup, this would come back as a single account object.
    const res = await accountsApi.listArtifactsForAccounts([1]);
    expect(Array.isArray(res.data)).toBe(true);
  });
});

describe("schedulerApi.listMeetingNotesForEvents", () => {
  it("sends all event IDs as one comma-separated batch", async () => {
    let seenEvent: string | null = null;
    server.use(
      http.get("/api/v1/scheduler/meeting-notes/", ({ request }) => {
        seenEvent = new URL(request.url).searchParams.get("event");
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      })
    );

    await schedulerApi.listMeetingNotesForEvents([10, 11, 12]);

    expect(seenEvent).toBe("10,11,12");
  });

  it("requests a page size wide enough that a large batch is not truncated", async () => {
    let pageSize: string | null = null;
    server.use(
      http.get("/api/v1/scheduler/meeting-notes/", ({ request }) => {
        pageSize = new URL(request.url).searchParams.get("page_size");
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      })
    );

    await schedulerApi.listMeetingNotesForEvents([1, 2]);

    expect(Number(pageSize)).toBeGreaterThan(50);
  });

  it("resolves an empty DRF envelope without hitting the network for no IDs", async () => {
    let called = false;
    server.use(
      http.get("/api/v1/scheduler/meeting-notes/", () => {
        called = true;
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      })
    );

    const res = await schedulerApi.listMeetingNotesForEvents([]);

    // Shape must match a real response so callers can read .data.results unconditionally.
    expect(res.data.results).toEqual([]);
    expect(res.data.count).toBe(0);
    expect(called).toBe(false);
  });

  it("leaves the single-event helper on its original param shape", async () => {
    let seenEvent: string | null = null;
    server.use(
      http.get("/api/v1/scheduler/meeting-notes/", ({ request }) => {
        seenEvent = new URL(request.url).searchParams.get("event");
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      })
    );

    await schedulerApi.listMeetingNotes(7);

    expect(seenEvent).toBe("7");
  });
});
