import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockActionItem } from "../../test/handlers/action_items";
import { notifyActionItemsChanged } from "../../lib/actionItemEvents";
import { useActionItemList } from "../useActionItemList";

const LIST = "/api/v1/airtable/action-items/";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serve the list and record every GET's query string. */
function serveList(items: unknown = [mockActionItem]) {
  const gets: URLSearchParams[] = [];
  server.use(
    http.get(LIST, ({ request }) => {
      gets.push(new URL(request.url).searchParams);
      return HttpResponse.json(items as never);
    }),
  );
  return gets;
}

describe("useActionItemList", () => {
  it("loading state: loading=true before the fetch settles", () => {
    serveList();
    const { result } = renderHook(() => useActionItemList());
    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it("happy path: loads the list and sends the params", async () => {
    const gets = serveList();
    const { result } = renderHook(() => useActionItemList({ status: "Open,In Progress", account: "3" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ airtable_id: "recAAA001" });
    expect(result.current.error).toBeNull();
    expect(gets[0].get("status")).toBe("Open,In Progress");
    expect(gets[0].get("account")).toBe("3");
  });

  it("accepts a DRF envelope as well as a bare array", async () => {
    serveList({ count: 1, next: null, previous: null, results: [mockActionItem] });
    const { result } = renderHook(() => useActionItemList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
  });

  it("an unexpected body yields an empty array, not a crash", async () => {
    serveList({ detail: "nope" });
    const { result } = renderHook(() => useActionItemList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("error state: sets error and leaves items empty", async () => {
    server.use(http.get(LIST, () => HttpResponse.error()));
    const { result } = renderHook(() => useActionItemList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it("refetch re-reads the server", async () => {
    const gets = serveList();
    const { result } = renderHook(() => useActionItemList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refetch());
    await waitFor(() => expect(gets).toHaveLength(2));
  });

  it("refetch keeps a stable reference", async () => {
    serveList();
    const { result, rerender } = renderHook(() => useActionItemList());
    const first = result.current.refetch;
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender();
    expect(result.current.refetch).toBe(first);
  });

  it("params change: refetches with the new params and is loading again", async () => {
    const gets = serveList();
    const { result, rerender } = renderHook(({ p }) => useActionItemList(p), { initialProps: { p: { account: "1" } } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ p: { account: "2" } });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(gets.map((g) => g.get("account"))).toEqual(["1", "2"]);
  });

  it("a new params object with the same contents does not refetch", async () => {
    const gets = serveList();
    const { result, rerender } = renderHook(({ p }) => useActionItemList(p), { initialProps: { p: { account: "1" } } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ p: { account: "1" } });
    await sleep(50);
    expect(gets).toHaveLength(1);
  });

  it("enabled=false: no request is made and the list stays empty", async () => {
    const gets = serveList();
    const { result } = renderHook(() => useActionItemList({}, { enabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(gets).toHaveLength(0);
    expect(result.current.items).toEqual([]);
  });

  describe("actionItemsUpdated broadcast", () => {
    it("refetches silently: loading never flips back to true and items stay in place", async () => {
      const gets = serveList();
      const seen: boolean[] = [];
      const { result } = renderHook(() => {
        const r = useActionItemList({}, { debounceMs: 20 });
        seen.push(r.loading);
        return r;
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      const settledAt = seen.length;
      act(() => notifyActionItemsChanged());
      await waitFor(() => expect(gets).toHaveLength(2));
      await waitFor(() => expect(result.current.refreshing).toBe(false));
      expect(seen.slice(settledAt).every((l) => l === false)).toBe(true);
      expect(result.current.items).toHaveLength(1);
    });

    it("picks up a row added elsewhere", async () => {
      const rows = [mockActionItem];
      server.use(http.get(LIST, () => HttpResponse.json(rows)));
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 20 }));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      rows.push({ ...mockActionItem, id: 2, airtable_id: "recBBB002" });
      act(() => notifyActionItemsChanged());
      await waitFor(() => expect(result.current.items).toHaveLength(2));
    });

    it("is debounced: a burst of broadcasts makes one request", async () => {
      const gets = serveList();
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 60 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => { notifyActionItemsChanged(); notifyActionItemsChanged(); notifyActionItemsChanged(); });
      await sleep(250);
      expect(gets).toHaveLength(2);
    });

    it("ignores other storage keys", async () => {
      const gets = serveList();
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 10 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "somethingElse", newValue: "1" })); });
      await sleep(80);
      expect(gets).toHaveLength(1);
    });

    it("broadcast:false opts out", async () => {
      const gets = serveList();
      const { result } = renderHook(() => useActionItemList({}, { broadcast: false, debounceMs: 10 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => notifyActionItemsChanged());
      await sleep(80);
      expect(gets).toHaveLength(1);
    });

    it("unmounting cancels a pending refetch and removes the listener", async () => {
      const gets = serveList();
      const { result, unmount } = renderHook(() => useActionItemList({}, { debounceMs: 60 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => notifyActionItemsChanged());
      unmount();
      await sleep(150);
      expect(gets).toHaveLength(1);
    });
  });

  describe("mutations", () => {
    it("updateFields PATCHes /fields/, returns the row and refetches", async () => {
      const gets = serveList();
      let body: unknown;
      server.use(
        http.patch(`${LIST}:id/fields/`, async ({ request, params }) => {
          body = { id: params.id, ...(await request.json() as object) };
          return HttpResponse.json({ ...mockActionItem, task: "Renamed" });
        }),
      );
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 20 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      let returned: unknown;
      await act(async () => { returned = await result.current.updateFields("recAAA001", { task: "Renamed" }); });
      expect(body).toEqual({ id: "recAAA001", task: "Renamed" });
      expect(returned).toMatchObject({ task: "Renamed" });
      await waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(2));
    });

    it("updateStatus PATCHes /status/ and refetches", async () => {
      const gets = serveList();
      let body: unknown;
      server.use(
        http.patch(`${LIST}:id/status/`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ ...mockActionItem, status: "Done" });
        }),
      );
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 20 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.updateStatus("recAAA001", "Done"); });
      expect(body).toEqual({ status: "Done" });
      await waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(2));
    });

    it("remove DELETEs by numeric id and refetches", async () => {
      const gets = serveList();
      let deleted: string | readonly string[] | undefined;
      server.use(http.delete(`${LIST}:id/`, ({ params }) => { deleted = params.id; return new HttpResponse(null, { status: 204 }); }));
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 20 }));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      await act(async () => { await result.current.remove("recAAA001"); });
      expect(deleted).toBe("1");
      await waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(2));
    });

    it("remove of an id the list does not hold sends nothing", async () => {
      serveList();
      let called = false;
      server.use(http.delete(`${LIST}:id/`, () => { called = true; return new HttpResponse(null, { status: 204 }); }));
      const { result } = renderHook(() => useActionItemList());
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.remove("recNOPE"); });
      expect(called).toBe(false);
    });

    it("create POSTs, returns the new row and refetches", async () => {
      const gets = serveList();
      let body: unknown;
      server.use(http.post(LIST, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...mockActionItem, id: 9, airtable_id: "recNEW9", task: "Brand new" }, { status: 201 });
      }));
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 20 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      let created: { airtable_id?: string } | undefined;
      await act(async () => { created = await result.current.create({ task: "Brand new" }); });
      expect(body).toMatchObject({ task: "Brand new" });
      expect(created?.airtable_id).toBe("recNEW9");
      await waitFor(() => expect(gets.length).toBeGreaterThanOrEqual(2));
    });

    it("a mutation plus its own broadcast costs one refetch, not two", async () => {
      const gets = serveList();
      const { result } = renderHook(() => useActionItemList({}, { debounceMs: 40 }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.updateFields("recAAA001", { task: "x" }); });
      await sleep(250);
      expect(gets).toHaveLength(2);
    });

    it("re-throws a failed mutation and does not refetch", async () => {
      const gets = serveList();
      server.use(http.patch(`${LIST}:id/fields/`, () => HttpResponse.json({ detail: "no" }, { status: 403 })));
      const { result } = renderHook(() => useActionItemList({}, { broadcast: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await expect(act(async () => { await result.current.updateFields("recAAA001", { task: "x" }); })).rejects.toBeTruthy();
      await sleep(60);
      expect(gets).toHaveLength(1);
    });

    it("local-* ids are never sent to the server", async () => {
      serveList();
      const calls: string[] = [];
      server.use(
        http.patch(`${LIST}:id/fields/`, ({ request }) => { calls.push(request.url); return HttpResponse.json(mockActionItem); }),
        http.patch(`${LIST}:id/status/`, ({ request }) => { calls.push(request.url); return HttpResponse.json(mockActionItem); }),
        http.delete(`${LIST}:id/`, ({ request }) => { calls.push(request.url); return new HttpResponse(null, { status: 204 }); }),
      );
      const { result } = renderHook(() => useActionItemList());
      await waitFor(() => expect(result.current.loading).toBe(false));
      let a: unknown, b: unknown, c: unknown;
      await act(async () => {
        a = await result.current.updateFields("local-3", { task: "x" });
        b = await result.current.updateStatus("local-3", "Done");
        c = await result.current.remove("local-3");
      });
      expect([a, b, c]).toEqual([null, null, undefined]);
      expect(calls).toEqual([]);
    });
  });
});
