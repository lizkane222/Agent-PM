import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockComment } from "../../test/handlers/comments";

// AppErrorProvider is not needed here — useComments calls reportError via
// useAppError(), which returns a no-op default when used outside a provider.

describe("useComments", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function getHook(
    resourceType: string | null = "action_item",
    resourceId: number | null = 10,
  ) {
    const { useComments } = await import("../useComments");
    return renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (useComments as any)(resourceType, resourceId)
    );
  }

  it("loading is true initially then false after data loads", async () => {
    const { result } = await getHook();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("happy path: populates comments after GET resolves", async () => {
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0].content).toBe(mockComment.content);
    expect(result.current.error).toBeNull();
  });

  it("null resourceType: no GET fired, comments is empty", async () => {
    let getCount = 0;
    server.use(
      http.get("/api/v1/comments/comments/", () => {
        getCount++;
        return HttpResponse.json({ results: [mockComment], count: 1 });
      }),
    );
    const { result } = await getHook(null, 10);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCount).toBe(0);
    expect(result.current.comments).toEqual([]);
  });

  it("null resourceId: no GET fired, comments is empty", async () => {
    let getCount = 0;
    server.use(
      http.get("/api/v1/comments/comments/", () => {
        getCount++;
        return HttpResponse.json({ results: [mockComment], count: 1 });
      }),
    );
    const { result } = await getHook("action_item", null);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCount).toBe(0);
    expect(result.current.comments).toEqual([]);
  });

  it("error state: GET 500 sets error and clears loading", async () => {
    server.use(
      http.get("/api/v1/comments/comments/", () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.comments).toEqual([]);
  });

  it("refetch: re-runs the GET and updates comments", async () => {
    let callCount = 0;
    server.use(
      http.get("/api/v1/comments/comments/", () => {
        callCount++;
        return HttpResponse.json({ results: [mockComment], count: 1 });
      }),
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = callCount;

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(callCount).toBeGreaterThan(before));
  });

  it("addComment: POSTs then refetches", async () => {
    let postCount = 0;
    let getCount = 0;
    const created = { ...mockComment, id: 99, content: "New comment" };
    server.use(
      http.get("/api/v1/comments/comments/", () => {
        getCount++;
        return HttpResponse.json({ results: [mockComment], count: 1 });
      }),
      http.post("/api/v1/comments/comments/", () => {
        postCount++;
        return HttpResponse.json(created);
      }),
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const getBefore = getCount;

    await act(async () => {
      await result.current.addComment({ content: "New comment" });
    });

    expect(postCount).toBe(1);
    await waitFor(() => expect(getCount).toBeGreaterThan(getBefore));
  });

  it("addComment with null ids: returns null, no POST fired", async () => {
    let postCount = 0;
    server.use(
      http.post("/api/v1/comments/comments/", () => {
        postCount++;
        return HttpResponse.json(mockComment);
      }),
    );
    const { result } = await getHook(null, null);
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returnVal: unknown;
    await act(async () => {
      returnVal = await result.current.addComment({ content: "x" });
    });

    expect(postCount).toBe(0);
    expect(returnVal).toBeNull();
  });

  it("editComment: PATCHes then refetches", async () => {
    let patchCount = 0;
    let getCount = 0;
    server.use(
      http.get("/api/v1/comments/comments/", () => {
        getCount++;
        return HttpResponse.json({ results: [mockComment], count: 1 });
      }),
      http.patch("/api/v1/comments/comments/:id/", () => {
        patchCount++;
        return HttpResponse.json({ ...mockComment, content: "Edited" });
      }),
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const getBefore = getCount;

    await act(async () => {
      await result.current.editComment(1, "Edited");
    });

    expect(patchCount).toBe(1);
    await waitFor(() => expect(getCount).toBeGreaterThan(getBefore));
  });

  it("deleteComment: DELETEs then refetches", async () => {
    let deleteCount = 0;
    let getCount = 0;
    server.use(
      http.get("/api/v1/comments/comments/", () => {
        getCount++;
        return HttpResponse.json({ results: [mockComment], count: 1 });
      }),
      http.delete("/api/v1/comments/comments/:id/", () => {
        deleteCount++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const getBefore = getCount;

    await act(async () => {
      await result.current.deleteComment(1);
    });

    expect(deleteCount).toBe(1);
    await waitFor(() => expect(getCount).toBeGreaterThan(getBefore));
  });

  it("addComment propagates API error (re-throws)", async () => {
    server.use(
      http.post("/api/v1/comments/comments/", () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );
    const { result } = await getHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.addComment({ content: "fail" });
      }),
    ).rejects.toThrow();
  });
});
