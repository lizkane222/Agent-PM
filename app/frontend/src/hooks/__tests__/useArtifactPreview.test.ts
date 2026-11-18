import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { useArtifactPreview } from "../useArtifactPreview";

const URL = "/api/v1/accounts/artifacts/:id/preview/";

describe("useArtifactPreview", () => {
  it("loads the server's description of the file", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ kind: "text", format: "plain", text: "hi", truncated: false })));
    const { result } = renderHook(() => useArtifactPreview(5));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ kind: "text", format: "plain", text: "hi", truncated: false });
  });

  it("does nothing while disabled or without an id", async () => {
    let hits = 0;
    server.use(http.get(URL, () => { hits++; return HttpResponse.json({ kind: "native" }); }));
    const a = renderHook(() => useArtifactPreview(5, false));
    const b = renderHook(() => useArtifactPreview(null));
    await new Promise((r) => setTimeout(r, 30));
    expect(hits).toBe(0);
    expect(a.result.current).toEqual({ data: null, loading: false, error: null });
    expect(b.result.current.loading).toBe(false);
  });

  it("reports a failed request as an error", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ detail: "x" }, { status: 404 })));
    const { result } = renderHook(() => useArtifactPreview(5));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("refetches when the artifact changes and drops the stale answer", async () => {
    server.use(http.get(URL, ({ params }) => HttpResponse.json({ kind: "text", format: "plain", text: `file ${params.id}`, truncated: false })));
    const { result, rerender } = renderHook(({ id }) => useArtifactPreview(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.data).toMatchObject({ text: "file 1" }));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toMatchObject({ text: "file 2" }));
  });
});
