import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  addQuickLink, MAX_QUICK_LINKS, normalizeQuickLinkUrl, quickLinkLabel, QUICK_LINKS_KEY,
  reloadQuickLinks, removeQuickLink, useQuickLinks,
} from "../useQuickLinks";

beforeEach(() => {
  localStorage.clear();
  reloadQuickLinks();
});

describe("normalizeQuickLinkUrl", () => {
  it.each([
    ["https://docs.google.com/document/d/1", "https://docs.google.com/document/d/1"],
    ["http://example.com/a", "http://example.com/a"],
    ["docs.google.com/document", "https://docs.google.com/document"],
    ["  lucid.app/documents  ", "https://lucid.app/documents"],
    ["example.com", "https://example.com/"],
    ["localhost:5173/x", "https://localhost:5173/x"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeQuickLinkUrl(input)).toBe(expected);
  });

  it.each([
    "", "   ", "foo", "hello world", "javascript:alert(1)", "JaVaScRiPt:alert(1)",
    "data:text/html,<script>1</script>",
    // Has a real-looking host, so only the protocol check stops it.
    "javascript://example.com/%0aalert(1)", "data://example.com/x", "vbscript://example.com/x", "mailto:a@b.com", "ftp://example.com", "file:///etc/passwd",
    "https://", "http://nodot",
    // Credentials in a link are how it is made to look like a different site.
    "https://google.com@evil.example.com", "https://user:pass@example.com",
  ])("rejects %j", (input) => {
    expect(normalizeQuickLinkUrl(input)).toBeNull();
  });
});

describe("quickLinkLabel", () => {
  it("uses the host without www.", () => {
    expect(quickLinkLabel("https://www.example.com/a/b")).toBe("example.com");
    expect(quickLinkLabel("https://lucid.app/documents")).toBe("lucid.app");
  });
});

describe("quick link store", () => {
  it("adds a link with an id and a host label, and persists it", () => {
    const r = addQuickLink("lucid.app/documents");
    expect(r.ok).toBe(true);
    const stored = JSON.parse(localStorage.getItem(QUICK_LINKS_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ url: "https://lucid.app/documents", label: "lucid.app" });
    expect(stored[0].id).toMatch(/^ql-/);
  });

  it("refuses an invalid link and stores nothing", () => {
    expect(addQuickLink("javascript:alert(1)")).toEqual({ ok: false, reason: "invalid" });
    expect(localStorage.getItem(QUICK_LINKS_KEY)).toBeNull();
  });

  it("refuses a duplicate, even when typed differently", () => {
    addQuickLink("example.com/a");
    expect(addQuickLink("https://example.com/a")).toEqual({ ok: false, reason: "duplicate" });
    expect(JSON.parse(localStorage.getItem(QUICK_LINKS_KEY) ?? "[]")).toHaveLength(1);
  });

  it("stops at the maximum", () => {
    for (let i = 0; i < MAX_QUICK_LINKS; i++) expect(addQuickLink(`site${i}.example.com`).ok).toBe(true);
    expect(addQuickLink("one-more.example.com")).toEqual({ ok: false, reason: "full" });
  });

  it("removes only the link asked for", () => {
    const a = addQuickLink("a.example.com");
    addQuickLink("b.example.com");
    if (a.ok) removeQuickLink(a.link.id);
    const left = JSON.parse(localStorage.getItem(QUICK_LINKS_KEY) ?? "[]");
    expect(left.map((l: { label: string }) => l.label)).toEqual(["b.example.com"]);
  });

  it("drops stored entries that are not safe web links (the value is user-editable)", () => {
    localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify([
      { id: "1", label: "ok", url: "https://ok.example.com/" },
      { id: "2", label: "bad", url: "javascript:alert(1)" },
      { id: "3", label: "worse" },
      "garbage",
    ]));
    reloadQuickLinks();
    const { result } = renderHook(() => useQuickLinks());
    expect(result.current.links.map(l => l.id)).toEqual(["1"]);
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem(QUICK_LINKS_KEY, "{not json");
    reloadQuickLinks();
    expect(renderHook(() => useQuickLinks()).result.current.links).toEqual([]);
  });
});

describe("useQuickLinks", () => {
  it("re-renders every consumer when a link is added", () => {
    const a = renderHook(() => useQuickLinks());
    const b = renderHook(() => useQuickLinks());
    act(() => { a.result.current.add("example.com"); });
    expect(a.result.current.links).toHaveLength(1);
    expect(b.result.current.links).toHaveLength(1);
  });

  it("add and remove return/accept what the UI needs", () => {
    const { result } = renderHook(() => useQuickLinks());
    let id = "";
    act(() => { const r = result.current.add("example.com"); if (r.ok) id = r.link.id; });
    expect(id).not.toBe("");
    act(() => { result.current.remove(id); });
    expect(result.current.links).toEqual([]);
  });
});
