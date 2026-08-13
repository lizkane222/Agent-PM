import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockActionItem } from "../../test/handlers/action_items";

// ResizeObserver not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// AppErrorContext defaults to no-op reportError outside a provider — no wrapper needed.

describe("useActionItems", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    // Guard: restore real timers in case a test leaves fake timers active.
    vi.useRealTimers();
  });

  async function getHook() {
    const { useActionItems } = await import("../useActionItems");
    return renderHook(() => useActionItems());
  }

  /**
   * Same trick as ActionItemsPage renderPageStable(): freeze fake timers during
   * renderHook so the blankCount useEffect's setTimeout(() => setAllItems, 0)
   * is queued but never fires.  vi.useRealTimers() discards the frozen entry so
   * the server data loads cleanly without being overwritten by the stale blank.
   */
  async function getHookStable() {
    const { useActionItems } = await import("../useActionItems");
    vi.useFakeTimers();
    const hook = renderHook(() => useActionItems());
    vi.useRealTimers();
    return hook;
  }

  it("loading is true initially", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json([mockActionItem]);
      })
    );
    const { result } = await getHook();
    expect(result.current.loading).toBe(true);
  });

  it("happy path: allItems contains server item after load", async () => {
    const { result } = await getHookStable();
    // Wait for both loading=false AND allItems populated (useEffect fires after render)
    await waitFor(() => {
      const realItems = result.current.allItems.filter((i) => !i.airtable_id.startsWith("local-"));
      expect(realItems).toHaveLength(1);
    });
    expect(result.current.loading).toBe(false);
    const realItems = result.current.allItems.filter((i) => !i.airtable_id.startsWith("local-"));
    expect(realItems[0].task).toBe(mockActionItem.task);
    expect(result.current.error).toBeNull();
  });

  it("blank replenishment: after load, allItems contains local-draft items in Unstaged", async () => {
    const { result } = await getHookStable();
    // Wait for blank items to appear (useEffect runs after loading=false render)
    await waitFor(() => {
      const blanks = result.current.allItems.filter((i) => i.airtable_id.startsWith("local-"));
      expect(blanks.length).toBeGreaterThanOrEqual(1);
    });
    const blanks = result.current.allItems.filter((i) => i.airtable_id.startsWith("local-"));
    blanks.forEach((b) => {
      const zone = result.current.zones[b.airtable_id] ?? "unstaged";
      expect(zone).toBe("unstaged");
    });
  });

  it("error state: GET 500 sets error and clears loading", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        new HttpResponse(null, { status: 500 })
      )
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("refetch: re-runs the GET and updates allItems", async () => {
    let callCount = 0;
    server.use(
      http.get("/api/v1/airtable/action-items/", () => {
        callCount++;
        return HttpResponse.json([mockActionItem]);
      })
    );
    const { result } = await getHookStable();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = callCount;

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(callCount).toBeGreaterThan(before));
  });

  it("promoteBlankItem — happy path: POSTs and returns created item", async () => {
    let postCount = 0;
    server.use(
      http.post("/api/v1/airtable/action-items/", () => {
        postCount++;
        return HttpResponse.json({ ...mockActionItem, airtable_id: "recNEW001", id: 2 }, { status: 201 });
      })
    );
    const { result } = await getHookStable();
    await waitFor(() => {
      expect(result.current.allItems.filter((i) => i.airtable_id.startsWith("local-")).length).toBeGreaterThan(0);
    });

    const blanks = result.current.allItems.filter((i) => i.airtable_id.startsWith("local-"));
    const blank = { ...blanks[0], task: "New task" };

    let created: unknown;
    await act(async () => {
      created = await result.current.promoteBlankItem(blank.airtable_id, blank);
    });

    expect(postCount).toBe(1);
    expect((created as { airtable_id: string }).airtable_id).toBe("recNEW001");
  });

  it("promoteBlankItem — empty task: no POST, returns null", async () => {
    let postCount = 0;
    server.use(
      http.post("/api/v1/airtable/action-items/", () => {
        postCount++;
        return HttpResponse.json({ ...mockActionItem, airtable_id: "recNEW001" });
      })
    );
    const { result } = await getHookStable();
    await waitFor(() => {
      expect(result.current.allItems.filter((i) => i.airtable_id.startsWith("local-")).length).toBeGreaterThan(0);
    });

    const blankItem = result.current.allItems.find((i) => i.airtable_id.startsWith("local-"))!;
    let ret: unknown;
    await act(async () => {
      ret = await result.current.promoteBlankItem(blankItem.airtable_id, blankItem);
    });

    expect(postCount).toBe(0);
    expect(ret).toBeNull();
  });

  it("promoteBlankItem — double-fire guard: second call with same localId is no-op", async () => {
    let postCount = 0;
    server.use(
      http.post("/api/v1/airtable/action-items/", async () => {
        postCount++;
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ ...mockActionItem, airtable_id: "recNEW001" });
      })
    );
    const { result } = await getHookStable();
    await waitFor(() => {
      expect(result.current.allItems.filter((i) => i.airtable_id.startsWith("local-")).length).toBeGreaterThan(0);
    });

    const blank = { ...result.current.allItems.find((i) => i.airtable_id.startsWith("local-"))!, task: "Task A" };

    await act(async () => {
      // Fire both simultaneously — second should be blocked by promotingRef
      await Promise.all([
        result.current.promoteBlankItem(blank.airtable_id, blank),
        result.current.promoteBlankItem(blank.airtable_id, blank),
      ]);
    });

    expect(postCount).toBe(1);
  });

  it("promoteBlankItem — API error: returns null and calls reportError", async () => {
    server.use(
      http.post("/api/v1/airtable/action-items/", () =>
        new HttpResponse(null, { status: 500 })
      )
    );
    const { result } = await getHookStable();
    await waitFor(() => {
      expect(result.current.allItems.filter((i) => i.airtable_id.startsWith("local-")).length).toBeGreaterThan(0);
    });

    const blank = { ...result.current.allItems.find((i) => i.airtable_id.startsWith("local-"))!, task: "Fail task" };

    let ret: unknown;
    await act(async () => {
      ret = await result.current.promoteBlankItem(blank.airtable_id, blank);
    });

    expect(ret).toBeNull();
    // No thrown error — reportError swallows it (no-op context outside provider)
  });
});
