import React, { useRef, useEffect } from "react";

const PIN_PATH = "M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 01.16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 01-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 010-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 011.013.16l3.134-3.133a2.772 2.772 0 01-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 01.353-.146z";

export function FocusPinBadge({ className }: { className?: string } = {}) {
  return (
    <span
      title="Pinned to Focus"
      className={`pointer-events-none select-none absolute flex items-center justify-center w-4 h-4 rounded-full bg-violet-500 text-white shadow-sm ${className ?? "top-1.5 right-1.5 z-20"}`}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" width="8" height="8">
        <path d={PIN_PATH} />
      </svg>
    </span>
  );
}

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const menuW = 200;
  const approxH = items.reduce((h, i) => h + (i.separator ? 9 : 32), 8);
  const left = x + menuW > window.innerWidth ? Math.max(4, x - menuW) : x;
  const top = y + approxH > window.innerHeight ? Math.max(4, y - approxH) : y;

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top, left, zIndex: 9999, minWidth: menuW }}
      className="bg-white rounded-lg border border-gray-200 shadow-lg py-1 text-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-gray-100" />
        ) : (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left whitespace-nowrap transition-colors ${
              item.danger
                ? "text-red-600 hover:bg-red-50"
                : "text-[var(--twilio-navy)] hover:bg-gray-50"
            }`}
          >
            {item.icon && (
              <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center opacity-60">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
