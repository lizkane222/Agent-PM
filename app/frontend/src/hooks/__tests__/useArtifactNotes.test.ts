import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockArtifactNote } from "../../test/handlers/accounts";
import { useArtifactNotes } from "../useArtifactNotes";

const BASE = "/api/v1/accounts/artifact-notes";
const page = (results: unknown[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });

describe("useArtifactNotes", () => {
  it("loads the notes for the artifact, unwrapping the envelope", async () => {
    let url = "";
    server.use(http.get(`${BASE}/`, ({ request }) => { url = request.url; return page([mockArtifactNote]); }));
    const { result } = renderHook(() => useArtifactNotes(7));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([mockArtifactNote]);
    expect(url).toContain("artifact=7");
    expect(url).toContain("page_size=500");
  });

  it("fetches nothing without an artifact id", async () => {
    let hits = 0;
    server.use(http.get(`${BASE}/`, () => { hits++; return page([]); }));
    const { result } = renderHook(() => useArtifactNotes(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hits).toBe(0);
    expect(result.current.data).toEqual([]);
  });

  it("error state", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useArtifactNotes(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("each mutation calls the API with the right body and refetches", async () => {
    let gets = 0;
    const calls: { m: string; body?: unknown }[] = [];
    server.use(
      http.get(`${BASE}/`, () => { gets++; return page([mockArtifactNote]); }),
      http.post(`${BASE}/`, async ({ request }) => { calls.push({ m: "create", body: await request.json() }); return HttpResponse.json(mockArtifactNote, { status: 201 }); }),
      http.patch(`${BASE}/:id/`, async ({ request }) => { calls.push({ m: "update", body: await request.json() }); return HttpResponse.json(mockArtifactNote); }),
      http.delete(`${BASE}/:id/`, () => { calls.push({ m: "delete" }); return new HttpResponse(null, { status: 204 }); }),
    );
    const { result } = renderHook(() => useArtifactNotes(7));
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => { await result.current.addNote("<p>hi</p>", 3); });
    await waitFor(() => expect(gets).toBe(2));
    await act(async () => { await result.current.editNote(1, "<p>edit</p>"); });
    await waitFor(() => expect(gets).toBe(3));
    await act(async () => { await result.current.removeNote(1); });
    await waitFor(() => expect(gets).toBe(4));
    expect(calls).toEqual([
      { m: "create", body: { artifact: 7, html: "<p>hi</p>", parent: 3 } },
      { m: "update", body: { html: "<p>edit</p>" } },
      { m: "delete" },
    ]);
  });

  it("re-throws a failed mutation so the caller can report it, and does not refetch", async () => {
    let gets = 0;
    server.use(
      http.get(`${BASE}/`, () => { gets++; return page([]); }),
      http.post(`${BASE}/`, () => HttpResponse.json({ detail: "no" }, { status: 404 })),
    );
    const { result } = renderHook(() => useArtifactNotes(7));
    await waitFor(() => expect(gets).toBe(1));
    let caught: unknown = null;
    await act(async () => { try { await result.current.addNote("<p>x</p>"); } catch (e) { caught = e; } });
    expect(caught).toBeTruthy();
    expect(gets).toBe(1);
  });

  it("keeps a stable refetch reference", async () => {
    const { result, rerender } = renderHook(() => useArtifactNotes(7));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.refetch;
    rerender();
    expect(result.current.refetch).toBe(first);
  });
});
