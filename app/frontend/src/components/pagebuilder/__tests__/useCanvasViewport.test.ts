import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCanvasViewport,
  wheelZoomFactor,
  clampZoom,
  CANVAS_VIEW_KEY,
  MIN_ZOOM,
  MAX_ZOOM,
} from "../useCanvasViewport";

/** content point currently drawn at viewport pixel (vx, vy) */
function contentAt(view: { zoom: number; panX: number; panY: number }, vx: number, vy: number) {
  return { x: (vx - view.panX) / view.zoom, y: (vy - view.panY) / view.zoom };
}

describe("clampZoom", () => {
  it("clamps to the supported range", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("falls back to 1 on non-finite input", () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in on negative deltaY and out on positive", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
  });

  it("is symmetric — scroll up then down returns to the same zoom", () => {
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 10);
  });

  it("stays positive for absurdly large deltas", () => {
    // A linear `1 - deltaY * k` goes negative here, which would mirror the canvas.
    expect(wheelZoomFactor(100000)).toBeGreaterThan(0);
  });

  it("normalises line-mode deltas to pixels", () => {
    expect(wheelZoomFactor(1, 1)).toBeCloseTo(wheelZoomFactor(16, 0), 10);
  });
});

describe("useCanvasViewport", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts at 100% with no pan", () => {
    const { result } = renderHook(() => useCanvasViewport());
    expect(result.current.zoom).toBe(1);
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });

  it("keeps the content under the cursor pinned while zooming", () => {
    const { result } = renderHook(() => useCanvasViewport());

    const anchorX = 300;
    const anchorY = 200;
    const before = contentAt(result.current, anchorX, anchorY);

    act(() => result.current.zoomByAt(2, anchorX, anchorY));
    expect(result.current.zoom).toBe(2);
    let after = contentAt(result.current, anchorX, anchorY);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    // ...and again from an already-panned, already-zoomed state
    act(() => result.current.zoomByAt(1.7, 120, 480));
    const mid = contentAt(result.current, 120, 480);
    act(() => result.current.zoomByAt(0.4, 120, 480));
    after = contentAt(result.current, 120, 480);
    expect(after.x).toBeCloseTo(mid.x, 6);
    expect(after.y).toBeCloseTo(mid.y, 6);
  });

  it("pins the anchor for absolute zooms too (slider / keyboard)", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.panBy(-500, -250));

    const before = contentAt(result.current, 400, 300);
    act(() => result.current.zoomToAt(3.25, 400, 300));

    expect(result.current.zoom).toBe(3.25);
    const after = contentAt(result.current, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps zoom and leaves pan untouched once clamped", () => {
    const { result } = renderHook(() => useCanvasViewport());

    act(() => result.current.zoomToAt(MAX_ZOOM, 200, 200));
    const panAtMax = { x: result.current.panX, y: result.current.panY };

    act(() => result.current.zoomByAt(4, 200, 200));
    expect(result.current.zoom).toBe(MAX_ZOOM);
    expect(result.current.panX).toBe(panAtMax.x);
    expect(result.current.panY).toBe(panAtMax.y);

    act(() => result.current.zoomToAt(0.001, 200, 200));
    expect(result.current.zoom).toBe(MIN_ZOOM);
  });

  it("pans by a screen delta, unbounded in both directions", () => {
    const { result } = renderHook(() => useCanvasViewport());

    act(() => result.current.panBy(40, -60));
    expect(result.current.panX).toBe(40);
    expect(result.current.panY).toBe(-60);

    // No clamping: the canvas is infinite, so a huge pan is legal.
    act(() => result.current.panBy(-100000, 100000));
    expect(result.current.panX).toBe(-99960);
    expect(result.current.panY).toBe(99940);
  });

  it("resets zoom and pan together", () => {
    const { result } = renderHook(() => useCanvasViewport());

    act(() => result.current.zoomByAt(2.5, 100, 100));
    act(() => result.current.panBy(80, 90));
    act(() => result.current.resetView());

    expect(result.current.zoom).toBe(1);
    expect(result.current.panX).toBe(0);
    expect(result.current.panY).toBe(0);
  });

  it("persists the whole view and restores it on remount", () => {
    const first = renderHook(() => useCanvasViewport());
    act(() => first.result.current.zoomByAt(2, 0, 0));
    act(() => first.result.current.panBy(-120, 45));

    expect(JSON.parse(localStorage.getItem(CANVAS_VIEW_KEY)!)).toEqual({
      zoom: 2, panX: -120, panY: 45,
    });

    first.unmount();
    const second = renderHook(() => useCanvasViewport());
    expect(second.result.current.zoom).toBe(2);
    expect(second.result.current.panX).toBe(-120);
    expect(second.result.current.panY).toBe(45);
  });

  it("ignores corrupt or out-of-range stored state", () => {
    localStorage.setItem(CANVAS_VIEW_KEY, "not json");
    expect(renderHook(() => useCanvasViewport()).result.current.zoom).toBe(1);

    localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify({ zoom: 900, panX: "x" }));
    const { result } = renderHook(() => useCanvasViewport());
    expect(result.current.zoom).toBe(MAX_ZOOM);
    expect(result.current.panX).toBe(0);
  });
});
