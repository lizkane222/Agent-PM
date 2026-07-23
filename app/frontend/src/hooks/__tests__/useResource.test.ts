import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useResource } from "../useResource";

interface TestItem {
  id: number;
  name: string;
}

const item1: TestItem = { id: 1, name: "alpha" };
const item2: TestItem = { id: 2, name: "beta" };

function makeResolving(items: TestItem[]) {
  return vi.fn().mockResolvedValue(items);
}

function makeRejecting(message = "network error") {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe("useResource", () => {
  it("starts with loading=true, data=[], error=null", () => {
    const fetcher = makeResolving([]);
    const { result } = renderHook(() => useResource(fetcher));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("happy path: resolves data and sets loading=false", async () => {
    const fetcher = makeResolving([item1, item2]);
    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([item1, item2]);
    expect(result.current.error).toBeNull();
  });

  it("error state: fetcher rejects → error set, data stays [], loading=false", async () => {
    const fetcher = makeRejecting("api down");
    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toBe("api down");
    expect(result.current.data).toEqual([]);
  });

  it("refetch: calling refetch re-runs the fetcher and returns fresh data", async () => {
    let callCount = 0;
    const fetcher = vi.fn(() => {
      callCount += 1;
      return Promise.resolve(callCount === 1 ? [item1] : [item1, item2]);
    });

    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([item1]);

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([item1, item2]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refetch: sets loading=true before the new fetch resolves", async () => {
    let resolveSecond: (v: TestItem[]) => void;
    const secondFetch = new Promise<TestItem[]>((res) => {
      resolveSecond = res;
    });
    let callCount = 0;
    const fetcher = vi.fn(() => {
      callCount += 1;
      return callCount === 1 ? Promise.resolve([item1]) : secondFetch;
    });

    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.refetch());
    // Should be loading again immediately
    expect(result.current.loading).toBe(true);

    act(() => resolveSecond!([item2]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([item2]);
  });

  it("refetch after error: clears the error and re-fetches", async () => {
    let shouldFail = true;
    const fetcher = vi.fn(() => {
      if (shouldFail) return Promise.reject(new Error("boom"));
      return Promise.resolve([item1]);
    });

    const { result } = renderHook(() => useResource(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();

    shouldFail = false;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([item1]);
  });

  it("dep change: triggers a new fetch", async () => {
    let depValue = "a";
    const fetcher = vi.fn(() => Promise.resolve([item1]));
    const { result, rerender } = renderHook(() => useResource(fetcher, [depValue]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);

    depValue = "b";
    rerender();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("stale-fetch protection: only the last fetch result is applied", async () => {
    const resolvers: Array<(v: TestItem[]) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<TestItem[]>((res) => {
          resolvers.push(res);
        })
    );

    let dep = 1;
    const { result, rerender } = renderHook(() => useResource(fetcher, [dep]));
    // First fetch is in flight

    dep = 2;
    rerender();
    // Second fetch is now in flight

    // Resolve the FIRST fetch last (stale)
    act(() => resolvers[1]([item2])); // resolve second (fresh) first
    act(() => resolvers[0]([item1])); // resolve first (stale) after

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Should show item2 (result of the second fetch), not item1
    expect(result.current.data).toEqual([item2]);
  });
});
