import { useEffect, useRef, useState } from "react";
import {
  EVENT_TYPE_META,
  PALETTES,
  borderFor,
  readableTextColor,
  type ColorableEventType,
} from "../../lib/eventColors";

/**
 * The Colors panel: one row per event type, each showing the type name rendered on
 * its current color. Clicking a row opens the full swatch grid grouped by palette;
 * picking a swatch applies it immediately so the calendar behind repaints live.
 */
export default function EventColorsPopover({
  colorFor,
  onSelect,
  onReset,
  onClose,
  error,
}: {
  colorFor: (type: ColorableEventType) => string;
  onSelect: (type: ColorableEventType, color: string) => void;
  onReset: () => void;
  onClose: () => void;
  error?: string | null;
}) {
  const [openType, setOpenType] = useState<ColorableEventType | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Event colors"
      className="absolute top-full right-0 mt-2 z-40 w-[268px] bg-white rounded-xl border border-gray-200 shadow-2xl p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-[var(--twilio-navy)]">Event colors</h3>
        <button
          onClick={onReset}
          className="text-[11px] text-gray-400 hover:text-indigo-600 transition-colors"
        >
          Reset
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-[11px] text-red-600">{error}</p>
      )}

      <div className="flex flex-col gap-1">
        {EVENT_TYPE_META.map(({ id, label }) => {
          const color = colorFor(id);
          const isOpen = openType === id;
          return (
            <div key={id}>
              {/* Preview chip — the type name on its own color, which is what the
                  calendar will show. Doubles as the button that opens the grid. */}
              <button
                onClick={() => setOpenType(isOpen ? null : id)}
                aria-expanded={isOpen}
                aria-label={`${label} color`}
                data-testid={`color-row-${id}`}
                data-color={color}
                className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-shadow hover:shadow-sm"
                style={{
                  backgroundColor: color,
                  color: readableTextColor(color),
                  border: `1px solid ${borderFor(color)}`,
                }}
              >
                <span className="truncate">{label}</span>
                <span className="opacity-60 text-[10px]">{isOpen ? "▴" : "▾"}</span>
              </button>

              {isOpen && (
                <div className="mt-1 mb-1.5 px-1 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
                  {PALETTES.map((palette) => (
                    <div key={palette.name} className="mb-1.5 last:mb-0">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 px-1 mb-1">
                        {palette.name}
                      </p>
                      <div className="flex items-center gap-1.5 px-1">
                        {palette.colors.map((swatch) => (
                          <button
                            key={swatch}
                            onClick={() => {
                              onSelect(id, swatch);
                              setOpenType(null);
                            }}
                            title={`${palette.name} ${swatch}`}
                            aria-label={`${palette.name} ${swatch}`}
                            data-testid={`swatch-${id}-${swatch}`}
                            className={[
                              "h-6 w-6 rounded-md transition-transform hover:scale-110",
                              swatch.toLowerCase() === color.toLowerCase()
                                ? "ring-2 ring-offset-1 ring-indigo-500"
                                : "",
                            ].join(" ")}
                            style={{
                              backgroundColor: swatch,
                              border: `1px solid ${borderFor(swatch)}`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
