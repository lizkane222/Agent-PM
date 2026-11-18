import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockTags } from "../../test/handlers/discover";
import { useDiscoverTags } from "../useDiscoverTags";

describe("useDiscoverTags", () => {
  it("loads the tag list", async () => {
    const { result } = renderHook(() => useDiscoverTags());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockTags);
  });

  it("error state", async () => {
    server.use(http.get("/api/v1/discover/applets/tags/", () => HttpResponse.error()));
    const { result } = renderHook(() => useDiscoverTags());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
  });

  it("refetch re-reads", async () => {
    let n = 0;
    server.use(http.get("/api/v1/discover/applets/tags/", () => { n++; return HttpResponse.json({ tags: [] }); }));
    const { result } = renderHook(() => useDiscoverTags());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.refetch(); });
    await waitFor(() => expect(n).toBe(2));
  });
});
