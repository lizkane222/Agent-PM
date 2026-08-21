import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PageBuilder from "../PageBuilder";
import { gridSpacingFor } from "../PageBuilder";
import { ExportProvider } from "../../../context/ExportContext";
import { CANVAS_VIEW_KEY } from "../useCanvasViewport";

function renderBuilder() {
  const utils = render(
    <ExportProvider>
      <PageBuilder />
    </ExportProvider>
  );
  const viewport = document.querySelector("[data-canvas-viewport]") as HTMLElement;
  const layer = document.querySelector("[data-canvas]") as HTMLElement;
  return { ...utils, viewport, layer };
}

/** jsdom has no layout; give the viewport a real box so anchor math is exercised. */
function stubViewportBox(el: HTMLElement, box = { left: 200, top: 100, width: 800, height: 600 }) {
  el.getBoundingClientRect = () => ({
    left: box.left, top: box.top, width: box.width, height: box.height,
    right: box.left + box.width, bottom: box.top + box.height,
    x: box.left, y: box.top, toJSON: () => "",
  }) as DOMRect;
}

/**
 * Dispatch a real WheelEvent. `fireEvent.wheel` can't be used: RTL would route
 * it through React's synthetic (passive) wheel handler, which is exactly the
 * path that cannot preventDefault — the bug under test. Dispatching natively
 * also means `act` has to be explicit, since RTL isn't doing the wrapping.
 */
function wheel(el: HTMLElement, init: WheelEventInit) {
  const ev = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

/** `translate(Xpx, Ypx) scale(Z)` → numbers */
function readTransform(layer: HTMLElement) {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(layer.style.transform);
  if (!m) throw new Error(`unexpected transform: ${layer.style.transform}`);
  return { panX: Number(m[1]), panY: Number(m[2]), zoom: Number(m[3]) };
}

describe("gridSpacingFor", () => {
  it("keeps dot spacing legible at every zoom", () => {
    for (const zoom of [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5]) {
      const s = gridSpacingFor(zoom);
      expect(s).toBeGreaterThanOrEqual(12);
      expect(s).toBeLessThanOrEqual(96);
    }
  });

  it("stays aligned to the 24px content grid (power-of-two multiples only)", () => {
    for (const zoom of [0.1, 0.3, 1, 2.2, 5]) {
      const ratio = gridSpacingFor(zoom) / (24 * zoom);
      expect(Math.log2(ratio) % 1).toBeCloseTo(0, 10);
    }
  });

  it("is 24px at 100%", () => {
    expect(gridSpacingFor(1)).toBe(24);
  });
});

describe("PageBuilder canvas zoom", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders an infinite grid on the viewport, not on a fixed-size canvas", () => {
    const { viewport, layer } = renderBuilder();

    // Grid lives on the clipping viewport so it always fills the visible area.
    expect(viewport.style.backgroundImage).toContain("radial-gradient");
    expect(viewport.style.backgroundSize).toBe("24px 24px");
    expect(viewport.style.overflow).toBe("hidden");

    // The transform layer has no extent of its own — nothing to run out of.
    expect(layer.style.width).toBe("0px");
    expect(layer.style.height).toBe("0px");
    expect(layer.style.transformOrigin).toBe("0 0");
  });

  it("zooms the canvas on ⌘/ctrl+wheel and prevents the browser's page zoom", () => {
    const { viewport, layer } = renderBuilder();
    stubViewportBox(viewport);

    const ev = wheel(viewport, { deltaY: -240, ctrlKey: true, clientX: 600, clientY: 400 });

    // defaultPrevented is the whole point: unprevented, ctrl+wheel zooms the
    // entire browser page instead of the canvas.
    expect(ev.defaultPrevented).toBe(true);
    expect(readTransform(layer).zoom).toBeGreaterThan(1);
    expect(screen.getByTestId("canvas-zoom-control").textContent).not.toBe("100%");
  });

  it("zooms toward the pointer, keeping that content point under the cursor", () => {
    const { viewport, layer } = renderBuilder();
    stubViewportBox(viewport);

    // Pointer at viewport-relative (400, 300).
    const clientX = 600;
    const clientY = 400;
    const vx = clientX - 200;
    const vy = clientY - 100;

    const before = readTransform(layer);
    const contentBefore = { x: (vx - before.panX) / before.zoom, y: (vy - before.panY) / before.zoom };

    wheel(viewport, { deltaY: -300, ctrlKey: true, clientX, clientY });

    const after = readTransform(layer);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect((vx - after.panX) / after.zoom).toBeCloseTo(contentBefore.x, 6);
    expect((vy - after.panY) / after.zoom).toBeCloseTo(contentBefore.y, 6);
  });

  it("pans on a plain wheel without changing zoom, and never scrolls the app shell", () => {
    const { viewport, layer } = renderBuilder();
    stubViewportBox(viewport);

    const ev = wheel(viewport, { deltaY: 120, deltaX: 40 });

    expect(ev.defaultPrevented).toBe(true);
    const t = readTransform(layer);
    expect(t.zoom).toBe(1);
    expect(t.panX).toBe(-40);
    expect(t.panY).toBe(-120);
  });

  it("moves the grid with the pan so it reads as one continuous surface", () => {
    const { viewport } = renderBuilder();
    stubViewportBox(viewport);

    wheel(viewport, { deltaY: 100, deltaX: -60 });

    expect(viewport.style.backgroundPosition).toBe("60px -100px");
  });

  it("rescales the grid when the zoom changes", () => {
    const { viewport, layer } = renderBuilder();
    stubViewportBox(viewport);

    wheel(viewport, { deltaY: -460, ctrlKey: true, clientX: 600, clientY: 400 });

    const { zoom } = readTransform(layer);
    expect(zoom).toBeGreaterThan(1);
    const expected = gridSpacingFor(zoom);
    expect(viewport.style.backgroundSize).toBe(`${expected}px ${expected}px`);
  });

  it("drives zoom from the toolbar slider and shows the percentage", () => {
    renderBuilder();
    const slider = screen.getByRole("slider", { name: /canvas zoom/i });

    fireEvent.change(slider, { target: { value: "766" } });

    expect(screen.getByText("200%")).toBeInTheDocument();
    const layer = document.querySelector("[data-canvas]") as HTMLElement;
    expect(readTransform(layer).zoom).toBeCloseTo(2, 2);
  });

  it("resets zoom and pan when the percentage is clicked", () => {
    const { viewport, layer } = renderBuilder();
    stubViewportBox(viewport);

    wheel(viewport, { deltaY: -300, ctrlKey: true, clientX: 600, clientY: 400 });
    wheel(viewport, { deltaY: 200 });
    expect(readTransform(layer)).not.toEqual({ panX: 0, panY: 0, zoom: 1 });

    fireEvent.click(screen.getByRole("button", { name: /reset to 100%/i }));

    expect(readTransform(layer)).toEqual({ panX: 0, panY: 0, zoom: 1 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("restores the last view on remount", () => {
    localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify({ zoom: 2.5, panX: -300, panY: 120 }));

    const { layer } = renderBuilder();

    expect(readTransform(layer)).toEqual({ panX: -300, panY: 120, zoom: 2.5 });
    expect(screen.getByText("250%")).toBeInTheDocument();
  });

  it("pans with a middle-button drag", () => {
    const { viewport, layer } = renderBuilder();
    stubViewportBox(viewport);

    fireEvent.mouseDown(viewport, { button: 1, clientX: 500, clientY: 400 });
    fireEvent.mouseMove(window, { clientX: 560, clientY: 370 });
    fireEvent.mouseUp(window);

    const t = readTransform(layer);
    expect(t.panX).toBe(60);
    expect(t.panY).toBe(-30);
    expect(t.zoom).toBe(1);
  });
});
