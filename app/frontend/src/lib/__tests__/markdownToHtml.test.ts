import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../markdownToHtml";

describe("markdownToHtml", () => {
  it("renders headings, emphasis and links", () => {
    const html = markdownToHtml("## Title\n\nSome **bold** and *italic* and [a link](https://x.test).");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="https://x.test"');
  });

  it("nests bullet lists by indent", () => {
    const html = markdownToHtml("* Top\n  * Child\n    * Grandchild\n* Next");
    expect(html).toBe("<ul><li>Top<ul><li>Child<ul><li>Grandchild</li></ul></li></ul></li><li>Next</li></ul>");
  });

  it("distinguishes numbered lists", () => {
    expect(markdownToHtml("1. One\n2. Two")).toBe("<ol><li>One</li><li>Two</li></ol>");
  });

  it("escapes and sanitizes raw HTML", () => {
    const html = markdownToHtml("<script>alert(1)</script> <img src=x onerror=alert(1)>");
    // Escaped to inert text, never parsed as elements.
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelector("script, img")).toBeNull();
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });

  it("keeps placeholders and keywords as literal text", () => {
    const html = markdownToHtml("* For [[Account]] see @#--all-action-items-${account_name}");
    expect(html).toContain("[[Account]]");
    expect(html).toContain("@#--all-action-items-${account_name}");
  });

  it("separates paragraphs and rules", () => {
    expect(markdownToHtml("One\nstill one\n\nTwo\n\n---")).toBe("<p>One<br>still one</p><p>Two</p><hr>");
  });

  it("returns empty for empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });
});
