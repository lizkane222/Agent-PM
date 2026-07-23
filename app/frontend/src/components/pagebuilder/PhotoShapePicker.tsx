import { useEffect, useRef, useState } from "react";
import {
  PHOTO_SHAPE_REGISTRY,
  PHOTO_SHAPE_CATEGORIES,
  type PhotoShapeCategory,
} from "./photoShapeRegistry";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (filename: string) => void;
  onClose: () => void;
}

export default function PhotoShapePicker({ anchorRef, onSelect, onClose }: Props) {
  const [category, setCategory] = useState<PhotoShapeCategory>("Twilio");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const panelW = 300;
      const left = Math.min(rect.right + 8, window.innerWidth - panelW - 12);
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - 400));
      setPos({ top, left });
    }
  }, [anchorRef]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onPointer(e: PointerEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }, [onClose, anchorRef]);

  const items = PHOTO_SHAPE_REGISTRY.filter((e) => e.category === category);

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 300 }}
      className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between shrink-0">
        <p className="text-xs font-bold text-[var(--twilio-navy)]">Choose Photo Shape</p>
        <button onClick={onClose} className="text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] text-sm leading-none">✕</button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-gray-100 flex-wrap shrink-0">
        {PHOTO_SHAPE_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              category === cat
                ? "bg-[var(--twilio-blue)] text-white"
                : "bg-gray-100 text-[var(--twilio-gray-60)] hover:bg-gray-200"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-y-auto p-2" style={{ maxHeight: 340 }}>
        <div className="grid grid-cols-3 gap-2">
          {items.map((entry) => (
            <button
              key={entry.filename}
              onClick={() => { onSelect(entry.filename); onClose(); }}
              className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-indigo-50 transition-colors group"
              title={entry.name}
            >
              <img
                src={entry.src}
                alt={entry.name}
                className="w-16 h-16 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                draggable={false}
              />
              <span className="text-[10px] text-[var(--twilio-gray-60)] truncate w-full text-center leading-tight">
                {entry.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-[var(--twilio-gray-40)] text-right shrink-0">
        {items.length} shape{items.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
