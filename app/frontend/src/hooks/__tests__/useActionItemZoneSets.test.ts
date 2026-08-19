import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  ACTION_ITEM_ZONES_KEY,
  reloadActionItemZones,
  useActionItemZoneSets,
} from "../useActionItemZoneSets";

/** Write the key the way ActionItemsPage does, then announce it the way a second tab would. */
function writeZones(zones: Record<string, string>) {
  const raw = JSON.stringify(zones);
  localStorage.setItem(ACTION_ITEM_ZONES_KEY, raw);
  window.dispatchEvent(new StorageEvent("storage", { key: ACTION_ITEM_ZONES_KEY, newValue: raw }));
}

describe("useActionItemZoneSets", () => {
  beforeEach(() => {
    localStorage.clear();
    // localStorage.clear() fires no storage event, so the module-level store keeps the
    // previous test's value until it is told to re-read.
    reloadActionItemZones();
  });

  it("splits one key into the tracking and staged sets", () => {
    localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify({
      a: "active", b: "today", c: "active", d: "unstaged", e: "accounts",
    }));
    reloadActionItemZones();

    const { result } = renderHook(() => useActionItemZoneSets());
    expect([...result.current.trackingIds].sort()).toEqual(["a", "c"]);
    expect([...result.current.stagedIds]).toEqual(["b"]);
  });

  it("ignores zones it does not own", () => {
    localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify({ d: "unstaged", e: "complete" }));
    reloadActionItemZones();

    const { result } = renderHook(() => useActionItemZoneSets());
    expect(result.current.trackingIds.size).toBe(0);
    expect(result.current.stagedIds.size).toBe(0);
  });

  it("updates on a cross-tab storage event", () => {
    const { result } = renderHook(() => useActionItemZoneSets());
    expect(result.current.trackingIds.size).toBe(0);

    act(() => writeZones({ rec1: "active" }));
    expect([...result.current.trackingIds]).toEqual(["rec1"]);

    act(() => writeZones({ rec1: "today" }));
    expect(result.current.trackingIds.size).toBe(0);
    expect([...result.current.stagedIds]).toEqual(["rec1"]);
  });

  it("keeps sibling consumers in sync", () => {
    // The whole reason this is a module-level store: N useState copies of one key drift.
    const a = renderHook(() => useActionItemZoneSets());
    const b = renderHook(() => useActionItemZoneSets());

    act(() => writeZones({ rec9: "active" }));
    expect([...a.result.current.trackingIds]).toEqual(["rec9"]);
    expect([...b.result.current.trackingIds]).toEqual(["rec9"]);
  });

  it("returns a stable set reference until the stored map actually changes", () => {
    const { result, rerender } = renderHook(() => useActionItemZoneSets());
    const before = result.current.trackingIds;
    rerender();
    expect(result.current.trackingIds).toBe(before);
  });

  it("survives a malformed value", () => {
    localStorage.setItem(ACTION_ITEM_ZONES_KEY, "not json");
    reloadActionItemZones();
    const { result } = renderHook(() => useActionItemZoneSets());
    expect(result.current.trackingIds.size).toBe(0);
    expect(result.current.stagedIds.size).toBe(0);
  });

  it("survives a JSON array where an object was expected", () => {
    localStorage.setItem(ACTION_ITEM_ZONES_KEY, JSON.stringify(["a", "b"]));
    reloadActionItemZones();
    const { result } = renderHook(() => useActionItemZoneSets());
    expect(result.current.trackingIds.size).toBe(0);
  });
});
