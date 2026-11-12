import { useEffect, useRef } from "react";
import type { SlashSkillsState } from "../../hooks/useSlashSkills";

/** Dropdown of skills for the "/" lookup. Renders above the composer; the parent must be `position: relative`. */
export default function SlashSkillMenu({ menu }: { menu: SlashSkillsState }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [menu.highlight, menu.open]);

  if (!menu.open) return null;
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Skills"
      style={{
        position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
        background: "var(--surface-card, #fff)", border: "1px solid var(--border-subtle, rgba(0,0,0,0.12))",
        borderRadius: "10px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 50,
        overflowY: "auto", maxHeight: "260px",
      }}
    >
      {menu.items.map((s, i) => (
        <button
          key={s.key}
          type="button"
          role="option"
          aria-selected={i === menu.highlight}
          onMouseDown={(e) => { e.preventDefault(); menu.select(s); }}
          onMouseEnter={() => menu.setHighlight(i)}
          style={{
            display: "flex", flexDirection: "column", width: "100%", textAlign: "left",
            padding: "8px 14px", border: "none", cursor: "pointer",
            background: i === menu.highlight ? "rgba(226,35,26,0.08)" : "transparent",
            borderLeft: i === menu.highlight ? "3px solid var(--twilio-red, #e22)" : "3px solid transparent",
          }}
        >
          <span style={{ fontSize: "0.8125rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--twilio-red, #e22)" }}>
            /{s.name}
            {s.kind === "twilio" && <span style={{ marginLeft: 8, fontSize: "0.6875rem", fontWeight: 500, color: "var(--text-secondary, #888)" }}>Twilio</span>}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)", marginTop: "1px", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.description}
          </span>
        </button>
      ))}
    </div>
  );
}
