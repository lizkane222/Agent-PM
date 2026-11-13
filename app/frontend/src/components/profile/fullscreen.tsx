import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { plainToHtml, sanitizeHtml } from "../../lib/noteHelpers";

/**
 * Full-screen view for the sections of the profile page.
 *
 * - `ExpandableSection` wraps a section: a double-click on its body, or the expand icon at its
 *   bottom-right, opens `renderFull()` in a full-screen panel. Escape or the X (top right) closes it.
 * - `CardList` is the usual content of that panel: one card per record; clicking a card opens it to
 *   show everything about the record, and any number of cards can be open at once.
 * - `fieldsOf` turns a record into labelled rows so a card can show all of its data without each
 *   section hand-listing every field.
 */

// ── Opening ──────────────────────────────────────────────────────────────────

/** A double-click on any of these is for that control (edit a word, press a button), not for the section. */
const INTERACTIVE = "button, a, input, textarea, select, label, summary, [contenteditable], .ProseMirror, [role='button'], [data-no-fullscreen]";

export function ExpandableSection({ title, accent, renderFull, children, style, footer = true, sectionId }: {
  title: string;
  accent: string;
  renderFull: () => ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
  /** Show the expand icon row under the content. */
  footer?: boolean;
  /** Lets the Page Sections panel find this section to scroll to and glow it. */
  sectionId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-fullscreen-section={title}
      data-section-id={sectionId}
      style={style}
      onDoubleClick={e => {
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        setOpen(true);
      }}
    >
      {children}
      {footer && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Open ${title} in full screen`}
            title="Full screen (or double-click the section)"
            style={{ width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", color: accent, cursor: "pointer", padding: 0 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      )}
      {open && <FullscreenPanel title={title} accent={accent} onClose={() => setOpen(false)}>{renderFull()}</FullscreenPanel>}
    </div>
  );
}

export function FullscreenPanel({ title, accent, onClose, children }: {
  title: string; accent: string; onClose: () => void; children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Bubble phase, and ignore an Escape something else already handled (a dialog opened from a
    // card closes itself first, not this panel as well).
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — full screen`}
      data-testid="fullscreen-panel"
      style={{ position: "fixed", inset: 0, zIndex: 45, background: "var(--bg, #f6f7f9)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.1))", background: "var(--surface, #fff)" }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: "1rem", fontWeight: 700, color: accent }}>{title}</h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close full screen"
          title="Close (Esc)"
          style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "transparent", cursor: "pointer", color: "var(--text-secondary, #666)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        <div style={{ maxWidth: 1600, margin: "0 auto" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

export interface FullField { label: string; value: ReactNode }
export interface FullCard {
  id: string | number;
  title: ReactNode;
  /** One short line shown on the closed card. */
  subtitle?: ReactNode;
  fields: FullField[];
  /** Buttons / links shown when the card is open. */
  actions?: ReactNode;
}

/** One card per record. Click a card to open it; any number can be open at once. */
export function CardList({ cards, empty, accent }: { cards: FullCard[]; empty: string; accent: string }) {
  const [openIds, setOpenIds] = useState<Set<string | number>>(new Set());
  if (cards.length === 0) {
    return <p style={{ margin: 0, fontSize: "0.875rem", fontStyle: "italic", color: "var(--text-secondary, #888)" }}>{empty}</p>;
  }
  const toggle = (id: string | number) =>
    setOpenIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allOpen = openIds.size === cards.length;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>{cards.length} {cards.length === 1 ? "item" : "items"}</span>
        <button
          type="button"
          onClick={() => setOpenIds(allOpen ? new Set() : new Set(cards.map(c => c.id)))}
          style={{ fontSize: "0.75rem", fontWeight: 600, color: accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {/* A grid, not a single column: as many cards per row as fit. A card opens in place (and several can be open
          at once) without moving the others sideways. */}
      <div data-testid="card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12, alignItems: "start" }}>
        {cards.map(card => {
          const isOpen = openIds.has(card.id);
          return (
            <div key={card.id} data-testid="full-card" data-open={isOpen} style={{ background: "var(--surface, #fff)", border: `1px solid ${isOpen ? accent : "var(--border, rgba(0,0,0,0.1))"}`, borderRadius: 10, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => toggle(card.id)}
                aria-expanded={isOpen}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "12px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "inherit" }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                  style={{ transition: "transform 0.15s", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}><path d="M4 6l4 4 4-4" /></svg>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary, #111)" }}>{card.title}</span>
                  {card.subtitle && <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary, #888)", marginTop: 2 }}>{card.subtitle}</span>}
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: "4px 14px 14px 14px", borderTop: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
                  <dl style={{ margin: "10px 0 0", display: "grid", gridTemplateColumns: "minmax(84px, 130px) 1fr", gap: "6px 14px", fontSize: "0.8125rem" }}>
                    {card.fields.map(f => (
                      <div key={f.label} style={{ display: "contents" }}>
                        <dt style={{ color: "var(--text-secondary, #888)", fontWeight: 600 }}>{f.label}</dt>
                        <dd style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere", color: "var(--text-primary, #222)" }}>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {card.actions && <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>{card.actions}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Turning a record into rows ───────────────────────────────────────────────

const EMPTY = <span style={{ color: "var(--text-secondary, #bbb)" }}>—</span>;
const ISO = /^\d{4}-\d{2}-\d{2}(T|\s|$)/;

export function humanize(key: string): string {
  const s = key.replace(/_/g, " ").replace(/\bid\b/gi, "ID").replace(/\burl\b/gi, "URL");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return dateOnly
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtSeconds(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export function RichHtml({ html }: { html: string }) {
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(html)) }} />;
}

export interface FieldOptions {
  /** Keys holding HTML / rich text, rendered as formatted text. */
  html?: string[];
  /** Keys holding a number of seconds. */
  seconds?: string[];
  /** Keys to leave out (internal ids that mean nothing to a reader). */
  hide?: string[];
  /** Friendlier labels for specific keys. */
  labels?: Record<string, string>;
}

/** Every field of `record` as a labelled row; empty values show a dash rather than disappearing. */
export function fieldsOf(record: object, opts: FieldOptions = {}): FullField[] {
  const { html = [], seconds = [], hide = [], labels = {} } = opts;
  return Object.entries(record as Record<string, unknown>)
    .filter(([k]) => !hide.includes(k))
    .map(([k, v]) => ({ label: labels[k] ?? humanize(k), value: valueNode(k, v, html, seconds) }));
}

function valueNode(key: string, v: unknown, html: string[], seconds: string[]): ReactNode {
  if (v === null || v === undefined || v === "") return EMPTY;
  if (html.includes(key) && typeof v === "string") return <RichHtml html={v} />;
  if (seconds.includes(key) && typeof v === "number") return fmtSeconds(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (ISO.test(v)) return fmtDateTime(v);
    if (/^https?:\/\//.test(v)) return <a href={v} target="_blank" rel="noopener noreferrer" style={{ color: "#4f46e5" }}>{v}</a>;
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return EMPTY;
    return (
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {v.map((item, i) => <li key={i}>{typeof item === "object" && item !== null ? summarize(item) : String(item)}</li>)}
      </ul>
    );
  }
  return summarize(v);
}

function summarize(o: unknown): string {
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    const name = r.name ?? r.title ?? r.label ?? r.full_name ?? r.task ?? r.filename;
    if (typeof name === "string" && name) return name;
    return Object.entries(r).filter(([, x]) => x !== null && x !== "" && typeof x !== "object").slice(0, 4).map(([k, x]) => `${humanize(k)}: ${x}`).join(" · ");
  }
  return String(o);
}
