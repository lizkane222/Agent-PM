import { useEffect, useRef, useState } from "react";
import { moveTo, nudge } from "./sectionLayout";

export interface SectionTile { id: string; label: string; icon: string }

interface ListProps {
  heading: string;
  tiles: readonly SectionTile[];
  /** Ids on the page, in page order. */
  order: readonly string[];
  accent: string;
  onChange: (next: string[]) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal: (id: string) => void;
  announce: (msg: string) => void;
}

const btn = (accent: string, filled = false): React.CSSProperties => ({
  width: 24, height: 24, borderRadius: 5, border: `1px solid ${accent}44`, background: filled ? accent : `${accent}12`,
  color: filled ? "#fff" : accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: "1rem", fontWeight: 700, flexShrink: 0, padding: 0,
});

/** One ordered list: sections on the page (drag to reorder, click to jump to, − to remove), then the rest (+ to add). */
function SectionList({ heading, tiles, order, accent, onChange, onAdd, onRemove, onReveal, announce }: ListProps) {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const onPage = order.filter((id) => byId.has(id));
  const available = tiles.filter((t) => !order.includes(t.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "added" | "removed" | "moved" } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flashRow = (id: string, kind: "added" | "removed" | "moved") => {
    setFlash({ id, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 1400);
  };
  const rowBg = (id: string) =>
    flash?.id === id ? (flash.kind === "removed" ? "rgba(220,38,38,0.12)" : "rgba(124,58,237,0.18)")
      : overId === id && dragId && dragId !== id ? "rgba(124,58,237,0.10)" : "var(--bg, #f9f9f9)";

  return (
    <div data-testid={`sections-list-${heading.toLowerCase().replace(/\W+/g, "-")}`} style={{ marginBottom: 14 }}>
      <p style={{ margin: "8px 4px 6px", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: accent }}>{heading}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {onPage.map((id, i) => {
          const tile = byId.get(id)!;
          return (
            <li
              key={id}
              data-testid={`section-row-${id}`}
              data-on-page="true"
              draggable
              onDragStart={(e) => { setDragId(id); e.dataTransfer?.setData("text/plain", id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(id); } }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== id) { onChange(moveTo(order, dragId, order.indexOf(id))); flashRow(dragId, "moved"); announce(`Moved ${byId.get(dragId)?.label ?? ""}`); }
                setDragId(null); setOverId(null);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.07))", background: rowBg(id), transition: "background 0.4s", opacity: dragId === id ? 0.5 : 1 }}
            >
              <span aria-hidden title="Drag to reorder" style={{ cursor: "grab", color: "var(--text-secondary, #aaa)", fontSize: "0.8rem", userSelect: "none" }}>⠿</span>
              <button type="button" onClick={() => onReveal(id)} title="Jump to this section" aria-label={`Go to ${tile.label}`}
                style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "var(--font-base)", fontSize: "0.8125rem", color: "var(--text-primary, #111)" }}>
                <span aria-hidden style={{ fontSize: "0.9rem", flexShrink: 0 }}>{tile.icon}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.label}</span>
              </button>
              <button type="button" aria-label={`Move ${tile.label} up`} disabled={i === 0}
                onClick={() => { onChange(nudge(order, id, -1)); flashRow(id, "moved"); }}
                style={{ ...btn(accent), opacity: i === 0 ? 0.3 : 1, fontSize: "0.7rem" }}>▲</button>
              <button type="button" aria-label={`Move ${tile.label} down`} disabled={i === onPage.length - 1}
                onClick={() => { onChange(nudge(order, id, 1)); flashRow(id, "moved"); }}
                style={{ ...btn(accent), opacity: i === onPage.length - 1 ? 0.3 : 1, fontSize: "0.7rem" }}>▼</button>
              <button type="button" aria-label={`Remove ${tile.label} from your page`} title="Remove from your page"
                onClick={() => { onRemove(id); announce(`Removed ${tile.label} from your page`); }}
                style={btn("#dc2626")}>−</button>
            </li>
          );
        })}
        {onPage.length === 0 && <li style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic", padding: "2px 6px" }}>Nothing here yet.</li>}
      </ul>

      {available.length > 0 && (
        <>
          <p style={{ margin: "10px 4px 6px", fontSize: "0.6875rem", color: "var(--text-secondary, #888)" }}>Not on your page</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            {available.map((tile) => (
              <li key={tile.id} data-testid={`section-row-${tile.id}`} data-on-page="false"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 22px", borderRadius: 8, border: "1px dashed var(--border, rgba(0,0,0,0.12))", background: "transparent" }}>
                <span aria-hidden style={{ fontSize: "0.9rem" }}>{tile.icon}</span>
                <span style={{ flex: 1, fontSize: "0.8125rem", color: "var(--text-secondary, #666)" }}>{tile.label}</span>
                <button type="button" aria-label={`Add ${tile.label} to your page`} title="Add to your page"
                  onClick={() => { onAdd(tile.id); flashRow(tile.id, "added"); announce(`Added ${tile.label} to your page`); }}
                  style={btn(accent)}>+</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export interface PageSectionsPanelProps {
  open: boolean;
  onClose: () => void;
  accent: string;
  text: string;
  main: { tiles: readonly SectionTile[]; order: readonly string[]; onChange: (next: string[]) => void };
  side: { tiles: readonly SectionTile[]; order: readonly string[]; onChange: (next: string[]) => void };
  /** Scroll to the section and glow it. The panel calls this when a name is clicked. */
  onReveal: (id: string) => void;
  /** Called after an add, so the page can reveal the new section once it has rendered. */
  onAdded: (id: string) => void;
}

export default function PageSectionsPanel({ open, onClose, accent, text, main, side, onReveal, onAdded }: PageSectionsPanelProps) {
  const [message, setMessage] = useState("");
  if (!open) return null;
  const list = (heading: string, group: PageSectionsPanelProps["main"]) => (
    <SectionList
      heading={heading}
      tiles={group.tiles}
      order={group.order}
      accent={accent}
      onChange={group.onChange}
      onAdd={(id) => { group.onChange([...group.order, id]); onAdded(id); }}
      onRemove={(id) => group.onChange(group.order.filter((x) => x !== id))}
      onReveal={onReveal}
      announce={setMessage}
    />
  );
  return (
    <div style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 280, background: "var(--surface, #fff)", borderLeft: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "-4px 0 24px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", zIndex: 30 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: text }}>Page Sections</span>
        <button type="button" aria-label="Close page sections" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", padding: 2 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p style={{ margin: "10px 16px 4px", fontSize: "0.75rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
        Drag to reorder (or use ▲ ▼). The order here is the order on your page. Click a name to jump to it.
      </p>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
        {list("Main column", main)}
        {list("Side column", side)}
      </div>
      {/* Read out by screen readers, and a visible confirmation for everyone. */}
      <div role="status" aria-live="polite" data-testid="sections-status"
        style={{ minHeight: 28, padding: "6px 16px", fontSize: "0.75rem", color: accent, borderTop: "1px solid var(--border, rgba(0,0,0,0.08))", background: message ? "rgba(124,58,237,0.06)" : "transparent" }}>
        {message}
      </div>
    </div>
  );
}
