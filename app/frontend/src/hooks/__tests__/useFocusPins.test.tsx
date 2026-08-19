import { renderHook, render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useFocusPins, reloadFocusPins, isFocusPinned, toggleFocusPin, FOCUS_PINS_KEY } from "../useFocusPins";

function storedPins(): string[] {
  return JSON.parse(localStorage.getItem(FOCUS_PINS_KEY) ?? "[]");
}

describe("useFocusPins", () => {
  beforeEach(() => {
    localStorage.clear();
    // localStorage.clear() fires no storage event, so the module store must be told.
    reloadFocusPins();
  });

  it("seeds from existing localStorage", () => {
    localStorage.setItem(FOCUS_PINS_KEY, JSON.stringify(["recAAA", "recBBB"]));
    reloadFocusPins();

    const { result } = renderHook(() => useFocusPins());

    expect(result.current.pinnedIds).toEqual(new Set(["recAAA", "recBBB"]));
    expect(result.current.isPinned("recAAA")).toBe(true);
    expect(result.current.isPinned("recZZZ")).toBe(false);
  });

  it("treats malformed JSON as no pins", () => {
    localStorage.setItem(FOCUS_PINS_KEY, "{not json");
    reloadFocusPins();

    const { result } = renderHook(() => useFocusPins());

    expect(result.current.pinnedIds.size).toBe(0);
  });

  it("ignores non-string entries in a stored array", () => {
    localStorage.setItem(FOCUS_PINS_KEY, JSON.stringify(["recAAA", 42, null, "recBBB"]));
    reloadFocusPins();

    const { result } = renderHook(() => useFocusPins());

    expect(result.current.pinnedIds).toEqual(new Set(["recAAA", "recBBB"]));
  });

  it("toggle adds a pin and persists it", () => {
    const { result } = renderHook(() => useFocusPins());

    act(() => result.current.toggle("recAAA"));

    expect(result.current.isPinned("recAAA")).toBe(true);
    expect(storedPins()).toEqual(["recAAA"]);
  });

  it("toggle removes an existing pin and persists the removal", () => {
    localStorage.setItem(FOCUS_PINS_KEY, JSON.stringify(["recAAA", "recBBB"]));
    reloadFocusPins();
    const { result } = renderHook(() => useFocusPins());

    act(() => result.current.toggle("recAAA"));

    expect(result.current.isPinned("recAAA")).toBe(false);
    expect(storedPins()).toEqual(["recBBB"]);
  });

  it("preserves insertion order", () => {
    const { result } = renderHook(() => useFocusPins());

    act(() => result.current.toggle("recCCC"));
    act(() => result.current.toggle("recAAA"));
    act(() => result.current.toggle("recBBB"));

    expect([...result.current.pinnedIds]).toEqual(["recCCC", "recAAA", "recBBB"]);
    expect(storedPins()).toEqual(["recCCC", "recAAA", "recBBB"]);
  });

  // This is the contract the three ad-hoc useState copies could not honour: a write in
  // one component was invisible to its siblings, because the browser's storage event does
  // not fire in the document that performed the write.
  it("two components sharing the hook both re-render on a single toggle", () => {
    function PinLabel({ label }: { label: string }) {
      const { isPinned } = useFocusPins();
      return <span data-testid={label}>{isPinned("recAAA") ? "pinned" : "unpinned"}</span>;
    }
    function Toggler() {
      const { toggle } = useFocusPins();
      return <button onClick={() => toggle("recAAA")}>toggle</button>;
    }

    render(<><PinLabel label="a" /><PinLabel label="b" /><Toggler /></>);

    expect(screen.getByTestId("a")).toHaveTextContent("unpinned");
    expect(screen.getByTestId("b")).toHaveTextContent("unpinned");

    act(() => screen.getByRole("button", { name: "toggle" }).click());

    expect(screen.getByTestId("a")).toHaveTextContent("pinned");
    expect(screen.getByTestId("b")).toHaveTextContent("pinned");
  });

  it("syncs from another tab via a storage event", () => {
    const { result } = renderHook(() => useFocusPins());
    expect(result.current.pinnedIds.size).toBe(0);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: FOCUS_PINS_KEY,
        newValue: JSON.stringify(["recFromOtherTab"]),
      }));
    });

    expect(result.current.pinnedIds).toEqual(new Set(["recFromOtherTab"]));
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useFocusPins());
    act(() => result.current.toggle("recAAA"));

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "someOtherKey",
        newValue: JSON.stringify(["recNope"]),
      }));
    });

    expect(result.current.pinnedIds).toEqual(new Set(["recAAA"]));
  });

  it("clears state when another tab wipes localStorage wholesale", () => {
    const { result } = renderHook(() => useFocusPins());
    act(() => result.current.toggle("recAAA"));

    // A wholesale clear() arrives as a storage event with a null key.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
    });

    expect(result.current.pinnedIds.size).toBe(0);
  });

  it("exposes module-level helpers for non-React callers", () => {
    expect(isFocusPinned("recAAA")).toBe(false);
    toggleFocusPin("recAAA");
    expect(isFocusPinned("recAAA")).toBe(true);
    expect(storedPins()).toEqual(["recAAA"]);
  });
});
