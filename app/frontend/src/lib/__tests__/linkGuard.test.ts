import { describe, it, expect, afterEach } from "vitest";
import { installLinkGuard, isSafeLinkHref } from "../linkGuard";

describe("linkGuard", () => {
  it("classifies schemes", () => {
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("  JAVASCRIPT:alert(1)")).toBe(false);
    expect(isSafeLinkHref("data:text/html,x")).toBe(false);
    expect(isSafeLinkHref("vbscript:x")).toBe(false);
    expect(isSafeLinkHref("https://a.example")).toBe(true);
    expect(isSafeLinkHref("/accounts/1")).toBe(true);
    expect(isSafeLinkHref("mailto:a@b.co")).toBe(true);
  });

  describe("click handling", () => {
    let off: () => void;
    afterEach(() => { off?.(); document.body.innerHTML = ""; });

    function click(href: string) {
      document.body.innerHTML = `<a id="l" href="${href}"><span id="c">x</span></a>`;
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      document.getElementById("c")!.dispatchEvent(ev);
      return ev.defaultPrevented;
    }

    it("blocks script-capable links, including clicks on children", () => {
      off = installLinkGuard();
      expect(click("javascript:alert(1)")).toBe(true);
      expect(click("data:text/html,x")).toBe(true);
    });

    it("lets normal links through", () => {
      off = installLinkGuard();
      expect(click("https://a.example")).toBe(false);
      expect(click("/accounts/1")).toBe(false);
      expect(click("#top")).toBe(false);
    });
  });
});
