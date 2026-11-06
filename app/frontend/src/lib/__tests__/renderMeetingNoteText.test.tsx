import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { renderMeetingNoteText } from "../noteHelpers";

function renderText(text: string) {
  return render(<p>{renderMeetingNoteText(text)}</p>);
}

describe("renderMeetingNoteText", () => {
  it("turns a bare URL into a hyperlink that opens in a new tab", () => {
    const { container } = renderText("Shareable link: https://twilio.zoom.us/rec/share/abc?pwd=xyz");
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://twilio.zoom.us/rec/share/abc?pwd=xyz");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("Shareable link: ");
  });

  it("shortens a long URL for display but keeps the full href", () => {
    const url = "https://twilio.zoom.us/rec/share/" + "A".repeat(150);
    const { container } = renderText(url);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe(url);
    expect(a.textContent!.length).toBeLessThan(60);
    expect(a.textContent).toMatch(/…$/);
  });

  it("leaves sentence punctuation outside the link", () => {
    const { container } = renderText("See https://example.com/doc.");
    expect(container.querySelector("a")!.getAttribute("href")).toBe("https://example.com/doc");
    expect(container.textContent).toBe("See example.com/doc.");
  });

  it("supports [label](url) links", () => {
    const { container } = renderText("Read [the plan](https://example.com/plan) first");
    const a = container.querySelector("a")!;
    expect(a.textContent).toBe("the plan");
    expect(a.getAttribute("href")).toBe("https://example.com/plan");
  });

  it("still highlights @mentions and leaves plain text untouched", () => {
    const { container } = renderText("Ask @Jane about it");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("span")!.textContent).toBe("@Jane");
    expect(renderText("Plain sentence, no links.").container.textContent).toBe("Plain sentence, no links.");
  });

  it("keeps a topic title with its colon in the rendered text", () => {
    const { container } = renderText("Debugger Navigation: The team showed the URL trick");
    expect(container.textContent).toBe("Debugger Navigation: The team showed the URL trick");
  });
});
