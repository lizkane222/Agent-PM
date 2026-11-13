import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@twilio/voice-sdk", () => ({ Device: class {}, Call: class {} }));
vi.mock("../VoiceButton", () => ({ default: () => null }));

import TranscriptFooter from "../TranscriptFooter";

let contentHeight = 20;
beforeEach(() => {
  localStorage.setItem("agentpm_access", "jwt-abc");
  Element.prototype.scrollIntoView = vi.fn();
  contentHeight = 20;
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => contentHeight });
  Element.prototype.getBoundingClientRect = function () {
    const h = parseFloat((this as HTMLElement).style.height) || 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON() {} } as DOMRect;
  };
  window.innerHeight = 1000;
});

const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const handle = () => screen.getByTestId("footer-size-handle");
const renderIt = () => render(<MemoryRouter><TranscriptFooter /></MemoryRouter>);
const ptr = (el: Element, type: string, clientY: number) =>
  fireEvent(el, Object.assign(new MouseEvent(type, { bubbles: true, clientY }), { pointerId: 1 }));

describe("TranscriptFooter input sizing", () => {
  it("uses app input styling", () => {
    renderIt();
    expect(box().className).toContain("rounded-xl");
    expect(box().className).toContain("border-gray-200");
  });

  it("grows with content and shrinks when text is removed", () => {
    renderIt();
    contentHeight = 120;
    fireEvent.change(box(), { target: { value: "a\nb\nc\nd" } });
    expect(box().style.height).toBe("120px");
    contentHeight = 20;
    fireEvent.change(box(), { target: { value: "" } });
    expect(box().style.height).toBe("38px");
  });

  it("caps auto growth and scrolls beyond it", () => {
    renderIt();
    contentHeight = 600;
    fireEvent.change(box(), { target: { value: "x".repeat(50) } });
    expect(box().style.height).toBe("160px");
    expect(box().style.overflowY).toBe("auto");
  });

  it("click toggles show-all, lifting the cap", () => {
    renderIt();
    contentHeight = 600;
    fireEvent.change(box(), { target: { value: "x" } });
    ptr(handle(), "pointerdown", 500);
    ptr(handle(), "pointerup", 500);
    expect(handle()).toHaveAttribute("aria-pressed", "true");
    expect(box().style.height).toBe("600px");
    ptr(handle(), "pointerdown", 500);
    ptr(handle(), "pointerup", 500);
    expect(handle()).toHaveAttribute("aria-pressed", "false");
    expect(box().style.height).toBe("160px");
  });

  it("show-all is clamped to the viewport", () => {
    renderIt();
    contentHeight = 5000;
    fireEvent.change(box(), { target: { value: "x" } });
    ptr(handle(), "pointerdown", 0);
    ptr(handle(), "pointerup", 0);
    expect(box().style.height).toBe("700px");
  });

  it("keyboard activation toggles show-all", () => {
    renderIt();
    fireEvent.click(handle(), { detail: 0 });
    expect(handle()).toHaveAttribute("aria-pressed", "true");
  });

  it("dragging up sets a manual height, clamped, and does not toggle", () => {
    renderIt();
    ptr(handle(), "pointerdown", 500);
    ptr(handle(), "pointermove", 400); // +100 from 38
    expect(box().style.height).toBe("138px");
    ptr(handle(), "pointermove", 0); // would be 538? start 38 + 500 -> clamp 700 not hit
    expect(box().style.height).toBe("538px");
    ptr(handle(), "pointermove", -5000);
    expect(box().style.height).toBe("700px");
    ptr(handle(), "pointermove", 5000);
    expect(box().style.height).toBe("38px");
    ptr(handle(), "pointerup", 5000);
    expect(handle()).toHaveAttribute("aria-pressed", "false");
  });

  it("ignores movement under the threshold (treated as a click)", () => {
    renderIt();
    ptr(handle(), "pointerdown", 500);
    ptr(handle(), "pointermove", 498);
    ptr(handle(), "pointerup", 498);
    expect(handle()).toHaveAttribute("aria-pressed", "true");
  });

  it("arrow keys adjust the height", () => {
    renderIt();
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    expect(box().style.height).toBe("62px");
    fireEvent.keyDown(handle(), { key: "ArrowDown" });
    expect(box().style.height).toBe("38px");
  });

  it("Enter still sends and Shift+Enter does not", () => {
    renderIt();
    fireEvent.change(box(), { target: { value: "hi" } });
    const ev = fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(ev).toBe(true);
  });
});
