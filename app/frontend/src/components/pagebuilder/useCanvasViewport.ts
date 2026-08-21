import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Viewport (view-only) state for the PageBuilder canvas: zoom + pan.
 *
 * Deliberately NOT part of `useCanvasState`. Zoom/pan are how you are *looking*
 * at the document, not part of the document — they must never enter the undo
 * stack, and undo must never move the camera.
 *
 * The canvas is infinite: panning is a CSS translate on a zero-size transform
 * layer, not scroll offsets on a finite scroller. There is no content extent to
 * run out of in any direction.
 *
 * Screen (viewport-relative) and content coordinates relate as:
 *     screen = pan + content * zoom
 *     content = (screen - pan) / zoom
 */

export const CANVAS_VIEW_KEY = "agentpm_canvas_view";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

/** Wheel sensitivity. Zoom is multiplicative: factor = exp(-deltaY * k). */
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/** Firefox and some mice report deltas in lines, not pixels. */
const LINE_HEIGHT_PX = 16;

export interface CanvasView {
  zoom: number;
  panX: number;
  panY: number;
}

const DEFAULT_VIEW: CanvasView = { zoom: 1, panX: 0, panY: 0 };

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Multiplicative zoom factor for one wheel event, normalised across deltaMode.
 * Multiplicative (rather than `1 - delta * k`) so that it is symmetric — a
 * scroll up then down returns to the same zoom — and can never go negative on
 * the very large deltaY values some mice and OS settings produce.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaY;
  return Math.exp(-px * WHEEL_ZOOM_SENSITIVITY);
}

function readStoredView(): CanvasView {
  try {
    const raw = localStorage.getItem(CANVAS_VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<CanvasView>;
    return {
      zoom: clampZoom(Number(parsed.zoom)),
      panX: Number.isFinite(Number(parsed.panX)) ? Number(parsed.panX) : 0,
      panY: Number.isFinite(Number(parsed.panY)) ? Number(parsed.panY) : 0,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function useCanvasViewport() {
  const [view, setView] = useState<CanvasView>(readStoredView);

  // Mirror into a ref so the wheel/drag handlers can read current values
  // without being re-created (and re-bound as native listeners) on every frame.
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    try {
      localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify(view));
    } catch {
      /* storage full or unavailable — zoom simply won't persist */
    }
  }, [view]);

  /**
   * Zoom by `factor`, keeping the content point currently under
   * (`anchorX`, `anchorY`) — viewport-relative pixels — pinned to that spot.
   * This is what makes wheel zoom feel like it is zooming *where you point*.
   */
  const zoomByAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    setView((prev) => {
      const next = clampZoom(prev.zoom * factor);
      if (next === prev.zoom) return prev;
      const contentX = (anchorX - prev.panX) / prev.zoom;
      const contentY = (anchorY - prev.panY) / prev.zoom;
      return {
        zoom: next,
        panX: anchorX - contentX * next,
        panY: anchorY - contentY * next,
      };
    });
  }, []);

  /** Jump to an absolute zoom, anchored at a viewport point (slider, keyboard). */
  const zoomToAt = useCallback((zoom: number, anchorX: number, anchorY: number) => {
    setView((prev) => {
      const next = clampZoom(zoom);
      if (next === prev.zoom) return prev;
      const contentX = (anchorX - prev.panX) / prev.zoom;
      const contentY = (anchorY - prev.panY) / prev.zoom;
      return {
        zoom: next,
        panX: anchorX - contentX * next,
        panY: anchorY - contentY * next,
      };
    });
  }, []);

  const panBy = useCallback((dx: number, dy: number) => {
    if (!dx && !dy) return;
    setView((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
  }, []);

  /** Back to 100% at the origin. */
  const resetView = useCallback(() => setView(DEFAULT_VIEW), []);

  return { ...view, view, viewRef, zoomByAt, zoomToAt, panBy, resetView };
}
