import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEmailThreads } from "../useEmailThreads";
import { saveLoadedThreads } from "../../lib/emailThreadStore";

describe("useEmailThreads", () => {
  it("is undefined until loaded, then survives a remount (navigation) with its stamp", () => {
    const first = renderHook(() => useEmailThreads(9));
    expect(first.result.current).toBeUndefined();
    act(() => saveLoadedThreads(9, [], 1234));
    expect(first.result.current?.loadedAt).toBe(1234);
    first.unmount();
    const second = renderHook(() => useEmailThreads(9));
    expect(second.result.current?.loadedAt).toBe(1234);
    expect(renderHook(() => useEmailThreads(10)).result.current).toBeUndefined();
  });
});
