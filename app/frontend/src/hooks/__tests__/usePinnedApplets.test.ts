import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockPin } from "../../test/handlers/discover";
import { usePinnedApplets } from "../usePinnedApplets";

const BASE = "/api/v1/discover/pins/";

describe("usePinnedApplets", () => {
  it("loads pins (loading state, then data)", async () => {
    server.use(http.get(BASE, () => HttpResponse.json([mockPin])));
    const { result } = renderHook(() => usePinnedApplets());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([mockPin]);
  });

  it("sends profile=1 / account=<id> as the scope", async () => {
    const seen: string[] = [];
    server.use(http.get(BASE, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json([]); }));
    const a = renderHook(() => usePinnedApplets({ profile: true }));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    const b = renderHook(() => usePinnedApplets({ account: 5 }));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(seen).toContain("?profile=1");
    expect(seen).toContain("?account=5");
  });

  it("error state", async () => {
    server.use(http.get(BASE, () => HttpResponse.error()));
    const { result } = renderHook(() => usePinnedApplets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("pin posts then refetches", async () => {
    let gets = 0;
    let body: unknown;
    server.use(
      http.get(BASE, () => { gets++; return HttpResponse.json([]); }),
      http.post(BASE, async ({ request }) => { body = await request.json(); return HttpResponse.json(mockPin, { status: 201 }); }),
    );
    const { result } = renderHook(() => usePinnedApplets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.pin(1, 3); });
    expect(body).toEqual({ applet: 1, account: 3 });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("unpin deletes then refetches", async () => {
    let gets = 0;
    let deleted = "";
    server.use(
      http.get(BASE, () => { gets++; return HttpResponse.json([mockPin]); }),
      http.delete(`${BASE}:id/`, ({ params }) => { deleted = String(params.id); return new HttpResponse(null, { status: 204 }); }),
    );
    const { result } = renderHook(() => usePinnedApplets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.unpin(7); });
    expect(deleted).toBe("7");
    await waitFor(() => expect(gets).toBe(2));
  });

  it("re-throws mutation errors", async () => {
    server.use(http.post(BASE, () => HttpResponse.json({ detail: "no" }, { status: 404 })));
    const { result } = renderHook(() => usePinnedApplets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.pin(1, 99)).rejects.toBeTruthy();
  });
});
