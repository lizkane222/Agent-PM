import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CanvasZoomSlider, { zoomToSlider, sliderToZoom } from "../CanvasZoomSlider";
import { MIN_ZOOM, MAX_ZOOM } from "../useCanvasViewport";

describe("slider scale", () => {
  it("spans the full zoom range end to end", () => {
    expect(sliderToZoom(0)).toBeCloseTo(MIN_ZOOM, 6);
    expect(sliderToZoom(1000)).toBeCloseTo(MAX_ZOOM, 6);
  });

  it("round-trips a zoom through the slider position", () => {
    for (const zoom of [0.1, 0.5, 1, 2, 3.7, 5]) {
      expect(sliderToZoom(zoomToSlider(zoom))).toBeCloseTo(zoom, 2);
    }
  });

  it("is logarithmic, so 100% sits near the middle rather than at 18%", () => {
    // On a linear 0.1–5 track, 100% would land at (1-0.1)/4.9 ≈ 18% of the width
    // and everything below 100% would be crushed into the first fifth.
    const at100 = zoomToSlider(1) / 1000;
    expect(at100).toBeGreaterThan(0.5);
    expect(at100).toBeLessThan(0.65);
  });

  it("gives equal travel to equal ratios", () => {
    const halfToOne = zoomToSlider(1) - zoomToSlider(0.5);
    const oneToTwo = zoomToSlider(2) - zoomToSlider(1);
    expect(Math.abs(halfToOne - oneToTwo)).toBeLessThanOrEqual(1);
  });
});

describe("CanvasZoomSlider", () => {
  it("shows the zoom as a rounded percentage", () => {
    render(<CanvasZoomSlider zoom={1.234} onZoomTo={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText("123%")).toBeInTheDocument();
  });

  it("reports the zoom for the dragged position", () => {
    const onZoomTo = vi.fn();
    render(<CanvasZoomSlider zoom={1} onZoomTo={onZoomTo} onReset={vi.fn()} />);

    fireEvent.change(screen.getByRole("slider", { name: /canvas zoom/i }), {
      target: { value: String(zoomToSlider(3)) },
    });

    expect(onZoomTo).toHaveBeenCalledTimes(1);
    expect(onZoomTo.mock.calls[0][0]).toBeCloseTo(3, 2);
  });

  it("reflects the current zoom in the slider position", () => {
    render(<CanvasZoomSlider zoom={2} onZoomTo={vi.fn()} onReset={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: /canvas zoom/i }) as HTMLInputElement;
    expect(Number(slider.value)).toBe(zoomToSlider(2));
  });

  it("resets from the percentage button", () => {
    const onReset = vi.fn();
    render(<CanvasZoomSlider zoom={4} onZoomTo={vi.fn()} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /reset to 100%/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
