import { describe, it, expect } from "vitest";
import { renderEventDescriptionHtml } from "../safeEventHtml";

describe("renderEventDescriptionHtml", () => {
  it("renders <br> as real line breaks, not literal text", () => {
    const src = "<br>One tap mobile<br>+1646...#,,,,*346111# US (New York)<br><br>---<br><br>Join by SIP<br>• ";
    const out = renderEventDescriptionHtml(src);
    expect(out).not.toContain("&lt;br");
    expect((out.match(/<br>/g) ?? []).length).toBe(7);
    expect(out).toContain("One tap mobile");
    expect(out).toContain("+1646...#,,,,*346111# US (New York)");
  });

  it("strips scripts, handlers and javascript: urls", () => {
    const out = renderEventDescriptionHtml(
      '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)" onclick="x()">hi</a><b onmouseover="y()">b</b>',
    );
    expect(out).not.toMatch(/script|onerror|onclick|onmouseover|javascript:|<img/i);
    expect(out).toContain("hi");
    expect(out).toContain("<b>b</b>");
  });

  it("adds rel noopener to links and keeps http urls", () => {
    const out = renderEventDescriptionHtml('<a href="https://example.com/x">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("escapes plain text, keeps newlines and linkifies bare urls", () => {
    const out = renderEventDescriptionHtml("a < b\nsee https://example.com/z");
    expect(out).toContain("a &lt; b<br>");
    expect(out).toContain('<a href="https://example.com/z"');
  });

  it("drops disallowed tags but keeps their text", () => {
    const out = renderEventDescriptionHtml("<div><h1>Title</h1><iframe src='https://e.com'></iframe></div>");
    expect(out).toBe("Title");
  });

  it("returns empty string for blank input", () => {
    expect(renderEventDescriptionHtml("  ")).toBe("");
    expect(renderEventDescriptionHtml(null)).toBe("");
  });
});
