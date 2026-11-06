import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAccountSectionCollapse, reloadAccountSectionCollapse, ACCOUNT_SECTION_COLLAPSE_KEY } from "../useAccountSectionCollapse";

describe("useAccountSectionCollapse", () => {
  beforeEach(() => { localStorage.clear(); reloadAccountSectionCollapse(); });

  it("starts with everything expanded", () => {
    const { result } = renderHook(() => useAccountSectionCollapse());
    expect(result.current.isCollapsed("timeline")).toBe(false);
  });

  it("toggles and persists to one global key", () => {
    const { result } = renderHook(() => useAccountSectionCollapse());
    act(() => result.current.toggle("timeline"));
    expect(result.current.isCollapsed("timeline")).toBe(true);
    expect(JSON.parse(localStorage.getItem(ACCOUNT_SECTION_COLLAPSE_KEY)!)).toEqual(["timeline"]);
    act(() => result.current.toggle("timeline"));
    expect(result.current.isCollapsed("timeline")).toBe(false);
  });

  it("keeps sibling hook instances in step within one tab", () => {
    const a = renderHook(() => useAccountSectionCollapse());
    const b = renderHook(() => useAccountSectionCollapse());
    act(() => a.result.current.toggle("email"));
    expect(b.result.current.isCollapsed("email")).toBe(true);
  });

  it("restores a saved preference (survives a reload and navigating between accounts)", () => {
    localStorage.setItem(ACCOUNT_SECTION_COLLAPSE_KEY, JSON.stringify(["artifacts"]));
    reloadAccountSectionCollapse();
    const { result } = renderHook(() => useAccountSectionCollapse());
    expect(result.current.isCollapsed("artifacts")).toBe(true);
  });

  it("falls back to expanded on corrupt storage", () => {
    localStorage.setItem(ACCOUNT_SECTION_COLLAPSE_KEY, "{not json");
    reloadAccountSectionCollapse();
    const { result } = renderHook(() => useAccountSectionCollapse());
    expect(result.current.isCollapsed("artifacts")).toBe(false);
  });
});
