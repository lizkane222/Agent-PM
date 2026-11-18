import { describe, it, expect } from "vitest";
import { safeHref } from "../CanvasExportModal";
import { sanitizeHtml } from "../../../lib/noteHelpers";
import { renderEventDescriptionHtml } from "../../../lib/safeEventHtml";

describe("export/render sanitisation", () => {
  it("safeHref refuses script-capable URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref(" JaVaScRiPt:alert(1)")).toBe("");
    expect(safeHref("data:text/html,<script>1</script>")).toBe("");
    expect(safeHref("//evil.example")).toBe("");
    expect(safeHref("https://ok.example/x")).toBe("https://ok.example/x");
    expect(safeHref("/accounts/1")).toBe("/accounts/1");
  });

  it("sanitizeHtml strips scripts, handlers, javascript: and svg tricks", () => {
    const out = sanitizeHtml(
      '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>' +
      '<img src=x onerror=alert(1)><svg onload=alert(1)><script>1</script></svg><iframe src="//e"></iframe>' +
      '<style>body{background:url(javascript:1)}</style>',
    );
    expect(out).not.toMatch(/<script|onclick|onerror|onload|javascript:|<iframe|<style/i);
  });

  it("event descriptions keep only safe links", () => {
    const out = renderEventDescriptionHtml('<a href="javascript:alert(1)">x</a><a href="https://a.example">y</a><img src=x onerror=1>');
    expect(out).not.toMatch(/javascript:|onerror|<img/i);
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });
});
