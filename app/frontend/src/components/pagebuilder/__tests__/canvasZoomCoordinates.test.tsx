import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PageBuilder from "../PageBuilder";
import ResizableWrapper from "../ResizableWrapper";
import CanvasViewContext from "../CanvasViewContext";
import { ExportProvider } from "../../../context/ExportContext";
import { CANVAS_DRAFT_KEY } from "../useCanvasState";
import { CANVAS_VIEW_KEY } from "../useCanvasViewport";
import type { CanvasNode } from "../types";

/**
 * Gestures arrive in screen pixels; the document stores content pixels. At any
 * zoom ≠ 1 the two differ by exactly `zoom`, and forgetting the division is a
 * silent wrong-position bug rather than a crash — hence these tests.
 */

function node(id: string, x: number, y: number, w: number, h: number): CanvasNode {
  return { id, type: "Text", props: { x, y, width: w, height: h, text: id }, children: [] };
}

function stubBox(el: HTMLElement, width = 800, height = 600) {
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, width, height, right: width, bottom: height,
    x: 0, y: 0, toJSON: () => "",
  }) as DOMRect;
}

/**
 * Give a rendered node the on-screen rect it would have at `zoom`.
 *
 * The marquee hit-tests live DOM rects rather than `props.x/y/w/h`, because a
 * nested node's stored coordinates are parent-relative and auto-height nodes have
 * no `height` prop at all. jsdom performs no layout, so every rect is zeros unless
 * stubbed — the same trap as `getBoundingClientRect` in the reorder tests.
 */
function stubNodeRect(id: string, contentRect: { x: number; y: number; w: number; h: number }, zoom: number) {
  const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
  const left = contentRect.x * zoom;
  const top = contentRect.y * zoom;
  const width = contentRect.w * zoom;
  const height = contentRect.h * zoom;
  el.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => "",
  }) as DOMRect;
}

describe("marquee selection at zoom", () => {
  beforeEach(() => localStorage.clear());

  it("reaches content that is further away than the band's pixel size suggests", () => {
    // Zoomed out to 50%: 100 screen px of marquee covers 200 content px.
    localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify({ zoom: 0.5, panX: 0, panY: 0 }));
    // "far" sits at content x=150 — beyond the band's 100px width, but well inside
    // it once the zoom is accounted for (its on-screen left edge is 75px).
    localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify([
      node("near", 0, 0, 100, 50),
      node("far", 150, 0, 40, 50),
    ]));

    render(<ExportProvider><PageBuilder /></ExportProvider>);
    const viewport = document.querySelector("[data-canvas-viewport]") as HTMLElement;
    stubBox(viewport);
    stubNodeRect("near", { x: 0, y: 0, w: 100, h: 50 }, 0.5);
    stubNodeRect("far", { x: 150, y: 0, w: 40, h: 50 }, 0.5);

    fireEvent.mouseDown(viewport, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);

    const near = document.querySelector('[data-node-id="near"]') as HTMLElement;
    const far = document.querySelector('[data-node-id="far"]') as HTMLElement;
    expect(near.style.outline).toContain("#818CF8");
    expect(far.style.outline).toContain("#818CF8");
  });

  it("counter-scales the multi-select outline so it stays a 2px rule on screen", () => {
    localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify({ zoom: 0.5, panX: 0, panY: 0 }));
    localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify([
      node("a", 0, 0, 100, 50),
      node("b", 150, 0, 40, 50),
    ]));

    render(<ExportProvider><PageBuilder /></ExportProvider>);
    const viewport = document.querySelector("[data-canvas-viewport]") as HTMLElement;
    stubBox(viewport);
    stubNodeRect("a", { x: 0, y: 0, w: 100, h: 50 }, 0.5);
    stubNodeRect("b", { x: 150, y: 0, w: 40, h: 50 }, 0.5);

    fireEvent.mouseDown(viewport, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);

    // 2 content px ÷ 0.5 zoom = 4px, which renders as 2 screen px.
    const a = document.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(a.style.outline).toBe("4px solid #818CF8");
  });

  it("still deselects on a bare background click", () => {
    localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify([node("solo", 10, 10, 80, 40)]));

    render(<ExportProvider><PageBuilder /></ExportProvider>);
    const viewport = document.querySelector("[data-canvas-viewport]") as HTMLElement;
    stubBox(viewport);

    fireEvent.click(screen.getByText("solo"));
    expect(screen.getByText("Properties")).toBeInTheDocument();

    fireEvent.mouseDown(viewport, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.mouseUp(window);

    expect(screen.getByText("Inspector")).toBeInTheDocument();
  });
});

describe("resize at zoom", () => {
  function renderResizable(zoom: number, onResizeLive = vi.fn()) {
    render(
      <CanvasViewContext.Provider value={{ zoom }}>
        <ResizableWrapper
          width={200}
          height={100}
          x={0}
          y={0}
          isSelected
          onResizeLive={onResizeLive}
          onResizeCommit={vi.fn()}
        >
          <div>content</div>
        </ResizableWrapper>
      </CanvasViewContext.Provider>
    );
    const handles = Array.from(document.querySelectorAll('[title="Drag to resize"]')) as HTMLElement[];
    return { onResizeLive, handles };
  }

  it("converts pointer travel to content pixels", () => {
    // 100 screen px dragged at 200% zoom is only 50 content px of growth.
    const { onResizeLive, handles } = renderResizable(2);
    const se = handles[4]; // nw, n, ne, e, se, ...

    fireEvent.mouseDown(se, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });

    expect(onResizeLive).toHaveBeenCalled();
    const [w, h] = onResizeLive.mock.calls[onResizeLive.mock.calls.length - 1];
    expect(w).toBe(250);
    expect(h).toBe(150);
  });

  it("is unchanged at 100%", () => {
    const { onResizeLive, handles } = renderResizable(1);

    fireEvent.mouseDown(handles[4], { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });

    const [w, h] = onResizeLive.mock.calls[onResizeLive.mock.calls.length - 1];
    expect(w).toBe(300);
    expect(h).toBe(200);
  });

  it("keeps handles a constant on-screen size", () => {
    const { handles } = renderResizable(4);
    expect(handles[0].style.width).toBe("2px");   // 8 ÷ 4 → 8 screen px
    expect(handles[0].style.height).toBe("2px");
    expect(handles[0].style.top).toBe("-1px");    // -4 ÷ 4
  });
});
