import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockPagePin } from "../../test/handlers/skills";
import { usePagePins } from "../usePagePins";

const PINS = "/api/v1/skills/page-pins/";

describe("usePagePins", () => {
  it("starts loading, then returns this page's pins", async () => {
    let page = "";
    server.use(http.get(PINS, ({ request }) => {
      page = new URL(request.url).searchParams.get("page") ?? "";
      return HttpResponse.json({ results: [mockPagePin({ id: 4 })] });
    }));
    const { result } = renderHook(() => usePagePins("reminders"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(page).toBe("reminders");
    expect(result.current.data.map((p) => p.id)).toEqual([4]);
  });

  it("is empty when nothing is pinned", async () => {
    const { result } = renderHook(() => usePagePins("calendar"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a load failure", async () => {
    server.use(http.get(PINS, () => HttpResponse.json({}, { status: 500 })));
    const { result } = renderHook(() => usePagePins("calendar"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("add posts the pin (with the everyone flag) and refetches", async () => {
    let body: Record<string, unknown> = {};
    let gets = 0;
    server.use(
      http.get(PINS, () => { gets++; return HttpResponse.json({ results: [] }); }),
      http.post(PINS, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(mockPagePin(), { status: 201 }); }),
    );
    const { result } = renderHook(() => usePagePins("layouts"));
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => { await result.current.add(9, true); });
    expect(body).toEqual({ page: "layouts", skill_id: 9, everyone: true });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("add defaults to a personal pin", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post(PINS, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(mockPagePin(), { status: 201 }); }));
    const { result } = renderHook(() => usePagePins("calendar"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.add(3); });
    expect(body.everyone).toBe(false);
  });

  it("remove deletes the pin and refetches", async () => {
    let deleted = "";
    let gets = 0;
    server.use(
      http.get(PINS, () => { gets++; return HttpResponse.json({ results: [mockPagePin({ id: 12 })] }); }),
      http.delete(`${PINS}:id/`, ({ params }) => { deleted = String(params.id); return new HttpResponse(null, { status: 204 }); }),
    );
    const { result } = renderHook(() => usePagePins("calendar"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => { await result.current.remove(12); });
    expect(deleted).toBe("12");
    await waitFor(() => expect(gets).toBe(2));
  });

  it("re-throws a failed add so the caller can show the message, and does not refetch", async () => {
    let gets = 0;
    server.use(
      http.get(PINS, () => { gets++; return HttpResponse.json({ results: [] }); }),
      http.post(PINS, () => HttpResponse.json({ detail: "Only admins can pin a skill for everyone." }, { status: 403 })),
    );
    const { result } = renderHook(() => usePagePins("calendar"));
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => {
      await expect(result.current.add(1, true)).rejects.toMatchObject({ response: { status: 403 } });
    });
    expect(gets).toBe(1);
  });
});
