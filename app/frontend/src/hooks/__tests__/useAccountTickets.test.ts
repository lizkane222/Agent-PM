import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockTicket } from "../../test/handlers/accounts";
import { useAccountTickets } from "../useAccountTickets";

const BASE = "/api/v1/accounts/tickets";
const page = (results: unknown[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });

describe("useAccountTickets", () => {
  it("loads the list, unwrapping the DRF envelope, with account and kind params", async () => {
    let url = "";
    server.use(http.get(`${BASE}/`, ({ request }) => { url = request.url; return page([mockTicket]); }));
    const { result } = renderHook(() => useAccountTickets({ account: 1, kind: "jira" }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([mockTicket]);
    expect(url).toContain("account=1");
    expect(url).toContain("kind=jira");
  });

  it("passes review=needs_review and no account", async () => {
    let url = "";
    server.use(http.get(`${BASE}/`, ({ request }) => { url = request.url; return page([]); }));
    const { result } = renderHook(() => useAccountTickets({ review: "needs_review" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(url).toContain("review=needs_review");
    expect(url).not.toContain("account=");
  });

  it("error state", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useAccountTickets({ account: 1 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("each mutation calls the API and refetches", async () => {
    let gets = 0;
    const calls: string[] = [];
    server.use(
      http.get(`${BASE}/`, () => { gets++; return page([mockTicket]); }),
      http.post(`${BASE}/`, () => { calls.push("create"); return HttpResponse.json(mockTicket, { status: 201 }); }),
      http.patch(`${BASE}/:id/`, () => { calls.push("update"); return HttpResponse.json(mockTicket); }),
      http.delete(`${BASE}/:id/`, () => { calls.push("delete"); return new HttpResponse(null, { status: 204 }); }),
      http.post(`${BASE}/:id/assign/`, () => { calls.push("assign"); return HttpResponse.json(mockTicket); }),
    );
    const { result } = renderHook(() => useAccountTickets({ account: 1, kind: "jira" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const start = gets;
    await act(async () => { await result.current.createTicket({ url: "https://x.test/1" }); });
    await waitFor(() => expect(gets).toBe(start + 1));
    await act(async () => { await result.current.updateTicket(1, { status: "closed" }); });
    await waitFor(() => expect(gets).toBe(start + 2));
    await act(async () => { await result.current.assignTicket(1, { account: 2 }); });
    await waitFor(() => expect(gets).toBe(start + 3));
    await act(async () => { await result.current.removeTicket(1); });
    await waitFor(() => expect(gets).toBe(start + 4));
    expect(calls).toEqual(["create", "update", "assign", "delete"]);
  });

  it("re-throws mutation errors", async () => {
    server.use(http.post(`${BASE}/`, () => HttpResponse.json({ detail: "no" }, { status: 400 })));
    const { result } = renderHook(() => useAccountTickets({ account: 1 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.createTicket({ url: "x" })).rejects.toBeDefined();
  });
});
