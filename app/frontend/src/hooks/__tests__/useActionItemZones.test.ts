import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useActionItemZones } from "../useActionItemZones";

describe("useActionItemZones", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initial state loaded from localStorage", () => {
    localStorage.setItem("actionItemZones", JSON.stringify({ recAAA: "today" }));
    localStorage.setItem("actionItemAccountAssign", JSON.stringify({ recAAA: "at-1" }));
    const { result } = renderHook(() => useActionItemZones());
    expect(result.current.zones).toEqual({ recAAA: "today" });
    expect(result.current.accountAssign).toEqual({ recAAA: "at-1" });
  });

  it("setZone updates state and writes localStorage", () => {
    const { result } = renderHook(() => useActionItemZones());
    act(() => { result.current.setZones({ recAAA: "active" }); });
    expect(result.current.zones).toEqual({ recAAA: "active" });
    expect(JSON.parse(localStorage.getItem("actionItemZones") ?? "{}")).toEqual({ recAAA: "active" });
  });

  it("swapBoth atomically swaps local-N → realId in both zones and accountAssign", () => {
    localStorage.setItem("actionItemZones", JSON.stringify({ "local-1": "unstaged" }));
    localStorage.setItem("actionItemAccountAssign", JSON.stringify({ "local-1": "at-2" }));
    const { result } = renderHook(() => useActionItemZones());

    act(() => { result.current.swapBoth("local-1", "recNEW", "accounts", "at-5"); });

    // Old key removed
    expect(result.current.zones["local-1"]).toBeUndefined();
    expect(result.current.accountAssign["local-1"]).toBeUndefined();
    // New key added
    expect(result.current.zones["recNEW"]).toBe("accounts");
    expect(result.current.accountAssign["recNEW"]).toBe("at-5");
    // localStorage updated
    const storedZones = JSON.parse(localStorage.getItem("actionItemZones") ?? "{}");
    expect(storedZones["local-1"]).toBeUndefined();
    expect(storedZones["recNEW"]).toBe("accounts");
  });

  it("swapBoth with no accountKey leaves accountAssign clean for old key", () => {
    localStorage.setItem("actionItemZones", JSON.stringify({ "local-1": "unstaged" }));
    const { result } = renderHook(() => useActionItemZones());

    act(() => { result.current.swapBoth("local-1", "recNEW", "unstaged"); });

    expect(result.current.zones["recNEW"]).toBe("unstaged");
    expect(result.current.accountAssign["recNEW"]).toBeUndefined();
  });

  it("mergeZones: incoming today/active zones are merged; other zones ignored", () => {
    const { result } = renderHook(() => useActionItemZones());
    act(() => { result.current.setZones({ recAAA: "accounts", recBBB: "today" }); });

    act(() => {
      result.current.mergeZones({
        recAAA: "today",    // incoming "today" wins
        recBBB: "active",   // incoming "active" wins
        recCCC: "accounts", // not today/active → ignored
      });
    });

    expect(result.current.zones["recAAA"]).toBe("today");
    expect(result.current.zones["recBBB"]).toBe("active");
    expect(result.current.zones["recCCC"]).toBeUndefined();
  });

  it("persistence across remounts: fresh render reads updated localStorage", () => {
    const { result: r1 } = renderHook(() => useActionItemZones());
    act(() => { r1.current.setZones({ recXXX: "complete" }); });

    const { result: r2 } = renderHook(() => useActionItemZones());
    expect(r2.current.zones["recXXX"]).toBe("complete");
  });
});
