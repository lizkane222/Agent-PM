import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { moveTo, nudge, toggleIn, loadIdList, revealSection, SECTION_GLOW_MS } from "../sectionLayout";

describe("ordering helpers", () => {
  it("moveTo puts an item at an index, clamped, without mutating", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveTo(list, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTo(list, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(list, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveTo(list, "b", -5)).toEqual(["b", "a", "c", "d"]);
    expect(moveTo(list, "zzz", 1)).toEqual(list);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  it("nudge moves one place and stops at the ends", () => {
    expect(nudge(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(nudge(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(nudge(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(nudge(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("toggleIn adds to the end or removes", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("loadIdList", () => {
  beforeEach(() => localStorage.clear());
  it("returns null when nothing is saved or the value is not a list", () => {
    expect(loadIdList("k", ["a"])).toBeNull();
    localStorage.setItem("k", "{bad json");
    expect(loadIdList("k", ["a"])).toBeNull();
    localStorage.setItem("k", JSON.stringify({ a: 1 }));
    expect(loadIdList("k", ["a"])).toBeNull();
  });
  it("drops unknown ids and repeats, keeps order", () => {
    localStorage.setItem("k", JSON.stringify(["b", "gone", "a", "b", 5]));
    expect(loadIdList("k", ["a", "b", "c"])).toEqual(["b", "a"]);
  });
  it("an empty saved list is respected (the user removed everything)", () => {
    localStorage.setItem("k", "[]");
    expect(loadIdList("k", ["a"])).toEqual([]);
  });
});

describe("revealSection", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<div data-section-id="x"></div><div data-section-id="y"></div>'; });
  afterEach(() => vi.useRealTimers());

  it("scrolls to the section and glows it for exactly three seconds", () => {
    const x = document.querySelector<HTMLElement>('[data-section-id="x"]')!;
    x.scrollIntoView = vi.fn();
    expect(SECTION_GLOW_MS).toBe(3000);
    expect(revealSection("x")).toBe(true);
    expect(x.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(x.getAttribute("data-glow")).toBe("true");
    vi.advanceTimersByTime(2999);
    expect(x.getAttribute("data-glow")).toBe("true");
    vi.advanceTimersByTime(1);
    expect(x.hasAttribute("data-glow")).toBe(false);
  });

  it("only the revealed section glows", () => {
    revealSection("x");
    expect(document.querySelector('[data-section-id="y"]')?.hasAttribute("data-glow")).toBe(false);
  });

  it("revealing again restarts the three seconds", () => {
    const x = document.querySelector<HTMLElement>('[data-section-id="x"]')!;
    revealSection("x");
    vi.advanceTimersByTime(2000);
    revealSection("x");
    vi.advanceTimersByTime(2000);
    expect(x.getAttribute("data-glow")).toBe("true");
    vi.advanceTimersByTime(1000);
    expect(x.hasAttribute("data-glow")).toBe(false);
  });

  it("returns false for a section that is not on the page", () => {
    expect(revealSection("nope")).toBe(false);
  });
});
