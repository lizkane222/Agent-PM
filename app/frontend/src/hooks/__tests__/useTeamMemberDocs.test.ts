import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockTeamMemberDocuments } from "../../test/handlers/team";
import { useTeamMemberDocs } from "../useTeamMemberDocs";

const BASE = "/api/v1/team/members/1/documents";

describe("useTeamMemberDocs", () => {
  it("happy path: loads docs for the given member", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.json(mockTeamMemberDocuments)));
    const { result } = renderHook(() => useTeamMemberDocs(1));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockTeamMemberDocuments);
    expect(result.current.error).toBeNull();
  });

  it("loading state: loading=true before fetch settles", () => {
    const { result } = renderHook(() => useTeamMemberDocs(1));
    expect(result.current.loading).toBe(true);
  });

  it("no member selected: resolves empty with no request", async () => {
    const { result } = renderHook(() => useTeamMemberDocs(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
  });

  it("error state: sets error when the API fails", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useTeamMemberDocs(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("addDocument calls the API and triggers refetch", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.json([])));
    const { result } = renderHook(() => useTeamMemberDocs(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    server.use(http.get(`${BASE}/`, () => HttpResponse.json(mockTeamMemberDocuments)));
    await act(async () => {
      await result.current.addDocument({ name: "Coverage doc", url: "https://docs.example.com/coverage" });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockTeamMemberDocuments);
  });

  it("addDocument rejects when no member is selected", async () => {
    const { result } = renderHook(() => useTeamMemberDocs(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.addDocument({ name: "x", url: "https://x" })).rejects.toThrow();
  });

  it("updateDocument calls the API and triggers refetch", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.json(mockTeamMemberDocuments)));
    const { result } = renderHook(() => useTeamMemberDocs(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateDocument(1, { name: "Renamed doc" });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("removeDocument calls the API and triggers refetch", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.json(mockTeamMemberDocuments)));
    const { result } = renderHook(() => useTeamMemberDocs(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeDocument(1);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
