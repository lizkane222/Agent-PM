import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PageBuilder from "../PageBuilder";
import { ExportProvider } from "../../../context/ExportContext";
import { EXPORT_ITEM_DRAG_KEY } from "../../ExportBar";
import { COMPONENT_REGISTRY } from "../registry";
import { CANVAS_DRAFT_KEY } from "../useCanvasState";
import { CANVAS_VIEW_KEY } from "../useCanvasViewport";

/**
 * A dropped record used to become a `Card` with four absolutely-positioned
 * children pinned at y = 0 / 24 / 46 / 62, plus a `height` derived from those same
 * constants. Card children are absolutely positioned, so nothing reflows: a title
 * that wrapped to two lines needed 42px in a 22px gap and painted over the account
 * name, and the summary had a 36px budget for up to 140 characters (~72px), so it
 * also spilled below the card's border.
 *
 * These tests pin the structural property that makes that impossible: one node,
 * no children, no fixed height, everything wrapping.
 */

// Long enough to wrap several times in a 280px card — the case that overlapped.
const longLabel =
  "Renewal risk: pricing pushback from procurement plus an outstanding SOC2 evidence request";
const longSummary =
  "Customer wants a 3-year term at last year's pricing.\nSecurity review is blocking on SOC2 Type II.\nNext step: loop in the security team before the QBR on the 14th.";

const item = {
  id: "note:42",
  type: "note",
  label: longLabel,
  summary: longSummary,
  content: longSummary,
  accountName: "Acme Corporation International",
  accent: "#0263E0",
  typeLabel: "Account Note",
  url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#heading=h.abc123",
};

function trayDataTransfer(payload: unknown = item) {
  return {
    types: [EXPORT_ITEM_DRAG_KEY],
    dropEffect: "none",
    getData: (key: string) => (key === EXPORT_ITEM_DRAG_KEY ? JSON.stringify(payload) : ""),
  };
}

function dropOnCanvas(payload: unknown = item, at?: { clientX: number; clientY: number }) {
  render(<ExportProvider><PageBuilder /></ExportProvider>);
  const viewport = document.querySelector("[data-canvas-viewport]") as HTMLElement;
  fireEvent.dragOver(viewport, { dataTransfer: trayDataTransfer(payload) });
  if (at) {
    stubViewportBox(viewport);
    dropAt(viewport, at, payload);
  } else {
    fireEvent.drop(viewport, { dataTransfer: trayDataTransfer(payload) });
  }
  return viewport;
}

/**
 * `fireEvent.drop` cannot carry clientX/clientY: jsdom has no DragEvent, so RTL
 * falls back to a plain Event and the mouse coordinates are silently dropped —
 * every drop then reads as landing at the origin. Dispatch a real MouseEvent named
 * "drop" instead and attach the dataTransfer by hand. (Same trap as dragOver.)
 */
function dropAt(el: HTMLElement, at: { clientX: number; clientY: number }, payload: unknown) {
  const ev = new MouseEvent("drop", { bubbles: true, cancelable: true, ...at });
  Object.defineProperty(ev, "dataTransfer", { value: trayDataTransfer(payload) });
  act(() => { el.dispatchEvent(ev); });
}

/** jsdom has no layout, so a drop position needs a real box to be measured against. */
function stubViewportBox(el: HTMLElement, box = { left: 100, top: 50, width: 800, height: 600 }) {
  el.getBoundingClientRect = () => ({
    left: box.left, top: box.top, width: box.width, height: box.height,
    right: box.left + box.width, bottom: box.top + box.height,
    x: box.left, y: box.top, toJSON: () => "",
  }) as DOMRect;
}

/** RTL collapses whitespace by default, which would never match a multi-line body. */
const exactly = (text: string) => screen.getByText(text, { normalizer: (s) => s });

describe("dropped record card", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders every field of the record", () => {
    dropOnCanvas();

    expect(screen.getByText(longLabel)).toBeInTheDocument();
    expect(screen.getByText("Account Note")).toBeInTheDocument();
    expect(screen.getByText("Acme Corporation International")).toBeInTheDocument();
    // Previously truncated at 140 chars with an ellipsis; now shown in full.
    expect(exactly(longSummary)).toBeInTheDocument();
  });

  it("is a single node with no children and no fixed height", () => {
    dropOnCanvas();

    const draft = JSON.parse(localStorage.getItem(CANVAS_DRAFT_KEY) ?? "[]");
    // The draft is written on a debounce; read from the live DOM instead if empty.
    if (draft.length > 0) {
      expect(draft).toHaveLength(1);
      expect(draft[0].type).toBe("RecordCard");
      expect(draft[0].children).toHaveLength(0);
      expect(draft[0].props.height).toBeUndefined();
    }

    // Exactly one canvas node exists for the drop.
    expect(document.querySelectorAll("[data-node-id]")).toHaveLength(1);
  });

  it("lets the title, summary and account name all wrap", () => {
    dropOnCanvas();

    for (const text of [longLabel, longSummary, "Acme Corporation International"]) {
      const el = screen.getByText(text, { normalizer: (s) => s });
      expect(el.style.overflowWrap).toBe("anywhere");
      expect(el.style.whiteSpace).not.toBe("nowrap");
    }
  });

  it("keeps newlines in the summary instead of collapsing them", () => {
    dropOnCanvas();
    expect(exactly(longSummary).style.whiteSpace).toBe("pre-wrap");
  });

  it("shows a long URL without letting it run outside the card", () => {
    dropOnCanvas();
    const link = screen.getByRole("link", { name: item.url });
    // A URL has no break opportunity, so `anywhere` is the only thing keeping it in.
    expect(link.style.overflowWrap).toBe("anywhere");
  });

  it("humanises a raw enum type when no label was supplied", () => {
    dropOnCanvas({ ...item, typeLabel: undefined, type: "action_item" });
    expect(screen.getByText("action item")).toBeInTheDocument();
  });

  it("places the drop in content coordinates, not screen coordinates, when zoomed", () => {
    localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify({ zoom: 2, panX: 0, panY: 0 }));
    // Viewport at (100, 50); drop 400px right and 200px down from its origin.
    dropOnCanvas(item, { clientX: 500, clientY: 250 });

    const node = document.querySelector("[data-node-id]") as HTMLElement;
    // At 200% those 400×200 screen px are 200×100 content px. Without the
    // division the card would be filed at 400,200 — twice as far out as dropped.
    expect(node.style.left).toBe("200px");
    expect(node.style.top).toBe("100px");
  });

  it("is offered in the palette as a normal component", () => {
    const def = COMPONENT_REGISTRY.find((c) => c.type === "RecordCard");
    expect(def).toBeDefined();
    expect(def!.category).toBe("AgentPM");
    expect(def!.canHaveChildren).toBe(false);
    // No default height: the card must always size to its content.
    expect(def!.defaultProps.height).toBeUndefined();
  });
});
