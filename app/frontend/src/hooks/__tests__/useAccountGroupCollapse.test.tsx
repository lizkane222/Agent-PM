import { renderHook, render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import {
  useAccountGroupCollapse,
  accountGroupKey,
  reloadAccountGroupCollapse,
  ACCOUNT_COLLAPSE_KEY,
  NO_ACCOUNT_GROUP_KEY,
} from "../useAccountGroupCollapse";

function storedKeys(): string[] {
  return JSON.parse(localStorage.getItem(ACCOUNT_COLLAPSE_KEY) ?? "[]");
}

describe("accountGroupKey", () => {
  it("lowercases and trims so both views agree on one key", () => {
    expect(accountGroupKey(" Acme Corp ")).toBe("acme corp");
    expect(accountGroupKey("ACME CORP")).toBe("acme corp");
  });

  it("maps empty, whitespace, null and undefined to the no-account key", () => {
    expect(accountGroupKey(null)).toBe(NO_ACCOUNT_GROUP_KEY);
    expect(accountGroupKey(undefined)).toBe(NO_ACCOUNT_GROUP_KEY);
    expect(accountGroupKey("")).toBe(NO_ACCOUNT_GROUP_KEY);
    expect(accountGroupKey("   ")).toBe(NO_ACCOUNT_GROUP_KEY);
  });
});

describe("useAccountGroupCollapse", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadAccountGroupCollapse();
  });

  it("seeds from existing localStorage", () => {
    localStorage.setItem(ACCOUNT_COLLAPSE_KEY, JSON.stringify(["acme"]));
    reloadAccountGroupCollapse();

    const { result } = renderHook(() => useAccountGroupCollapse());

    expect(result.current.isCollapsed("acme")).toBe(true);
    expect(result.current.isCollapsed("globex")).toBe(false);
  });

  it("treats malformed JSON as nothing collapsed", () => {
    localStorage.setItem(ACCOUNT_COLLAPSE_KEY, "not json");
    reloadAccountGroupCollapse();

    const { result } = renderHook(() => useAccountGroupCollapse());

    expect(result.current.isCollapsed("acme")).toBe(false);
  });

  it("toggle collapses then expands one group and persists both", () => {
    const { result } = renderHook(() => useAccountGroupCollapse());

    act(() => result.current.toggle("acme"));
    expect(result.current.isCollapsed("acme")).toBe(true);
    expect(storedKeys()).toEqual(["acme"]);

    act(() => result.current.toggle("acme"));
    expect(result.current.isCollapsed("acme")).toBe(false);
    expect(storedKeys()).toEqual([]);
  });

  it("setAll(keys, true) collapses every key without duplicating existing ones", () => {
    const { result } = renderHook(() => useAccountGroupCollapse());
    act(() => result.current.toggle("acme"));

    act(() => result.current.setAll(["acme", "globex", NO_ACCOUNT_GROUP_KEY], true));

    expect(storedKeys().sort()).toEqual([NO_ACCOUNT_GROUP_KEY, "acme", "globex"].sort());
    expect(storedKeys().filter((k) => k === "acme")).toHaveLength(1);
  });

  it("setAll(keys, false) expands only the listed keys", () => {
    const { result } = renderHook(() => useAccountGroupCollapse());
    act(() => result.current.setAll(["acme", "globex", "initech"], true));

    act(() => result.current.setAll(["acme", "globex"], false));

    expect(result.current.isCollapsed("acme")).toBe(false);
    expect(result.current.isCollapsed("globex")).toBe(false);
    // A group outside the list keeps its state — this is what lets "all collapsed except
    // one" survive a bulk expand of a different view's groups.
    expect(result.current.isCollapsed("initech")).toBe(true);
  });

  it("allCollapsed is false for an empty key list", () => {
    const { result } = renderHook(() => useAccountGroupCollapse());
    expect(result.current.allCollapsed([])).toBe(false);
  });

  it("allCollapsed flips true once the last group is collapsed by hand", () => {
    const { result } = renderHook(() => useAccountGroupCollapse());
    const keys = ["acme", "globex"];

    act(() => result.current.toggle("acme"));
    expect(result.current.allCollapsed(keys)).toBe(false);

    act(() => result.current.toggle("globex"));
    expect(result.current.allCollapsed(keys)).toBe(true);
  });

  it("two components sharing the hook both re-render on a single toggle", () => {
    function GroupRow({ label }: { label: string }) {
      const { isCollapsed } = useAccountGroupCollapse();
      return <span data-testid={label}>{isCollapsed("acme") ? "collapsed" : "expanded"}</span>;
    }
    function Toggler() {
      const { toggle } = useAccountGroupCollapse();
      return <button onClick={() => toggle("acme")}>toggle</button>;
    }

    render(<><GroupRow label="grid" /><GroupRow label="projects" /><Toggler /></>);

    expect(screen.getByTestId("grid")).toHaveTextContent("expanded");
    expect(screen.getByTestId("projects")).toHaveTextContent("expanded");

    act(() => screen.getByRole("button", { name: "toggle" }).click());

    expect(screen.getByTestId("grid")).toHaveTextContent("collapsed");
    expect(screen.getByTestId("projects")).toHaveTextContent("collapsed");
  });

  it("syncs from another tab via a storage event", () => {
    const { result } = renderHook(() => useAccountGroupCollapse());
    expect(result.current.isCollapsed("acme")).toBe(false);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: ACCOUNT_COLLAPSE_KEY,
        newValue: JSON.stringify(["acme"]),
      }));
    });

    expect(result.current.isCollapsed("acme")).toBe(true);
  });
});
