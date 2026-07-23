import { useEffect, useRef, useState } from "react";
import { ICON_REGISTRY } from "./iconRegistry";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (filename: string) => void;
  onClose: () => void;
}

export default function IconPicker({ anchorRef, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Position the panel next to the anchor element
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const panelW = 280;
      const left = Math.min(rect.left, window.innerWidth - panelW - 12);
      setPos({ top: rect.bottom + 6, left: Math.max(8, left) });
    }
    inputRef.current?.focus();
  }, [anchorRef]);

  // Close on outside click or Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointer(e: PointerEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }, [onClose, anchorRef]);

  const filtered = query.trim()
    ? ICON_REGISTRY.filter((ic) =>
        ic.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : ICON_REGISTRY;

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 280 }}
      className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-100">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--twilio-blue)]"
        />
      </div>

      {/* Grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
        {filtered.length === 0 ? (
          <p className="text-xs text-[var(--twilio-gray-40)] text-center py-6">No icons match "{query}"</p>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-gray-100">
            {filtered.map((ic) => (
              <button
                key={ic.filename}
                onClick={() => { onSelect(ic.filename); onClose(); }}
                className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-indigo-50 text-left transition-colors group"
              >
                <img
                  src={ic.src}
                  alt={ic.name}
                  className="w-5 h-5 shrink-0 opacity-70 group-hover:opacity-100"
                  draggable={false}
                />
                <span className="text-[11px] text-[var(--twilio-gray-80)] truncate leading-tight">
                  {ic.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-[var(--twilio-gray-40)] text-right">
        {filtered.length} icon{filtered.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
