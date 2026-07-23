import { useEffect, useRef, useState } from "react";
import { PRODUCT_SHAPE_REGISTRY, type ProductShapeKind } from "./productShapeRegistry";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (filename: string) => void;
  onClose: () => void;
}

const KINDS: { label: string; value: ProductShapeKind | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Shapes", value: "shape" },
  { label: "Lines", value: "line" },
];

export default function ProductShapePicker({ anchorRef, onSelect, onClose }: Props) {
  const [activeKind, setActiveKind] = useState<ProductShapeKind | "all">("all");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const panelW = 300;
      const left = Math.min(rect.left, window.innerWidth - panelW - 12);
      setPos({ top: rect.bottom + 6, left: Math.max(8, left) });
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

  const filtered = activeKind === "all"
    ? PRODUCT_SHAPE_REGISTRY
    : PRODUCT_SHAPE_REGISTRY.filter((s) => s.kind === activeKind);

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 300 }}
      className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Kind filter */}
      <div className="flex gap-1 px-3 py-2 border-b border-gray-100">
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setActiveKind(k.value)}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              activeKind === k.value
                ? "bg-[var(--twilio-blue)] text-white"
                : "bg-gray-100 text-[var(--twilio-gray-60)] hover:bg-gray-200"
            }`}
          >
            {k.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--twilio-gray-40)] self-center">{filtered.length}</span>
      </div>

      {/* Grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
        <div className="grid grid-cols-4 gap-1 p-2">
          {filtered.map((s) => (
            <button
              key={s.filename}
              onClick={() => { onSelect(s.filename); onClose(); }}
              title={s.name}
              className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors group"
            >
              <img
                src={s.src}
                alt={s.name}
                className="w-12 h-12 object-contain opacity-80 group-hover:opacity-100"
                draggable={false}
              />
              <span className="text-[9px] text-[var(--twilio-gray-60)] truncate w-full text-center leading-tight">
                {s.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
