import { MIN_ZOOM, MAX_ZOOM } from "./useCanvasViewport";

const STEPS = 1000;
const LOG_RANGE = Math.log(MAX_ZOOM / MIN_ZOOM);

/**
 * Slider position (0…STEPS) for a zoom level, and back.
 *
 * Logarithmic, not linear: the range is 10%…500%, so on a linear track 100%
 * would sit at 18% of the width and the whole zoomed-out half would be squeezed
 * into the first two pixels. On a log track each pixel is the same *ratio*
 * change, which is also how the wheel behaves.
 */
export function zoomToSlider(zoom: number): number {
  return Math.round((STEPS * Math.log(zoom / MIN_ZOOM)) / LOG_RANGE);
}

export function sliderToZoom(pos: number): number {
  return MIN_ZOOM * Math.exp((LOG_RANGE * pos) / STEPS);
}

export default function CanvasZoomSlider({
  zoom, onZoomTo, onReset,
}: {
  zoom: number;
  onZoomTo: (zoom: number) => void;
  onReset: () => void;
}) {
  const pct = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-1.5" data-testid="canvas-zoom-control">
      <input
        type="range"
        min={0}
        max={STEPS}
        value={zoomToSlider(zoom)}
        onChange={(e) => onZoomTo(sliderToZoom(Number(e.target.value)))}
        aria-label="Canvas zoom"
        title="Canvas zoom (⌘scroll over the canvas)"
        className="w-24 h-1 accent-[var(--twilio-blue)] cursor-pointer"
      />
      <button
        onClick={onReset}
        title="Reset zoom to 100% (⌘0)"
        aria-label={`Zoom ${pct}% — reset to 100%`}
        className="w-11 text-right text-xs font-semibold tabular-nums text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors"
      >
        {pct}%
      </button>
    </div>
  );
}
