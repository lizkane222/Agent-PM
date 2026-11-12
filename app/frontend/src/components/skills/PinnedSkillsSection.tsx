import { useEffect, useRef, useState } from "react";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useAgentSkillList } from "../../hooks/useAgentSkillList";
import { usePagePins } from "../../hooks/usePagePins";
import { accessLevel } from "../../lib/permissions";
import type { PagePin, SkillPageKey } from "../../types/agents";
import { useSkillLauncher, type LaunchContext } from "./SkillLaunchButtons";

export type PinnedSkillsVariant = "row" | "column" | "collapsible";

const PIN_PATH = "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z";
const prettyName = (n: string) => n.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The Claude skills pinned to this page, with a dropdown to add more. Used on the calendar, action
 * items, reminders, every account page, layouts and the activity log.
 *
 * Chips keep the "Pinned to my page" look. Clicking one runs the skill in chat (the run dialog
 * first if it needs input); the mic starts a voice session. A non-admin's pins are theirs alone; an
 * admin can tick "Show for everyone", and only an admin can remove such a pin.
 */
export default function PinnedSkillsSection({
  page, variant, context, align = "start", chipBackground,
}: {
  page: SkillPageKey;
  variant: PinnedSkillsVariant;
  context?: LaunchContext;
  align?: "start" | "center";
  /** Override the chip background (the calendar row is white). */
  chipBackground?: string;
}) {
  const { data: pins, add, remove } = usePagePins(page);
  const { data: allSkills } = useAgentSkillList();
  const isAdmin = accessLevel(useCurrentUser()) === "admin";
  const [choice, setChoice] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);          // only the collapsible variant uses this

  const pinnedIds = new Set(pins.map((p) => p.skill.id));
  const options = allSkills.filter((s) => s.status === "approved" && !pinnedIds.has(s.id));
  const launchContext: LaunchContext = { ...context, page };

  async function addChosen() {
    if (!choice) return;
    setError(null);
    try {
      await add(Number(choice), isAdmin && everyone);
      setChoice(""); setEveryone(false);
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't pin that skill.");
    }
  }
  async function removePin(pin: PagePin) {
    setError(null);
    try { await remove(pin.id); } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't remove that pin.");
    }
  }

  const picker = (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, flexWrap: variant === "row" ? "nowrap" : "wrap" }}>
      <select aria-label="Pin a Claude Skill to this page" value={choice} onChange={(e) => setChoice(e.target.value)}
        className={PAGE_SELECT_CLASS[page]}
        style={{ maxWidth: variant === "row" ? "210px" : "100%", ...chevron }}>
        <option value="">{options.length ? "Pin a Claude Skill" : "No more skills to pin"}</option>
        {options.map((s) => <option key={s.id} value={s.id}>{prettyName(s.name)}</option>)}
      </select>
      {isAdmin && choice !== "" && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "var(--text-secondary, #666)", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Show for everyone
        </label>
      )}
      {choice !== "" && (
        <button type="button" onClick={addChosen} style={{ ...addBtn, borderRadius: "9999px", padding: "8px 16px", fontSize: "0.875rem" }}>Pin</button>
      )}
    </div>
  );

  const list = (
    <div data-testid={`pinned-skills-${page}`} data-variant={variant}
      style={variant === "row"
        ? { display: "flex", alignItems: "center", gap: "8px", overflowX: "auto", whiteSpace: "nowrap", paddingBottom: "4px",
            ...(align === "center" ? { width: "max-content", margin: "0 auto", maxWidth: "none" } : {}) }
        : { display: "flex", flexDirection: "column", gap: "8px", alignItems: "stretch" }}>
      {pins.length === 0 && (
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #999)", whiteSpace: "nowrap" }}>No Claude skills pinned here yet.</span>
      )}
      {pins.map((pin) => (
        <PinnedChip key={pin.id} pin={pin} context={launchContext} background={chipBackground}
          block={variant !== "row"} onRemove={() => removePin(pin)} />
      ))}
      {variant === "row" && picker}
    </div>
  );

  const errorNode = error && <p role="alert" style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>;

  if (variant === "row") {
    return (
      <div data-testid="pinned-skills-section" style={{ minWidth: 0 }}>
        {list}
        {errorNode}
      </div>
    );
  }

  const heading = (
    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-secondary, #888)" }}>
      Claude Skills{variant === "collapsible" ? ` (${pins.length})` : ""}
    </span>
  );

  return (
    <section data-testid="pinned-skills-section" aria-label="Claude Skills" style={{ minWidth: 0 }}>
      {variant === "collapsible" ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%", padding: 0, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
          <span aria-hidden style={{ fontSize: "0.625rem", color: "var(--text-secondary, #888)" }}>{open ? "▾" : "▸"}</span>
          {heading}
        </button>
      ) : heading}
      {(variant === "column" || open) && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {list}
          {picker}
          {errorNode}
        </div>
      )}
    </section>
  );
}

function PinnedChip({
  pin, context, background, block, onRemove,
}: {
  pin: PagePin;
  context: LaunchContext;
  background?: string;
  block: boolean;
  onRemove: () => void;
}) {
  const { go, busy, message, dialogNode } = useSkillLauncher({ kind: "agent-skill", skill: pin.skill }, context);
  const label = prettyName(pin.skill.name);
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLButtonElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    // The name button slides out of reach, so hand keyboard focus to the first action.
    if (open) { opened.current = true; runRef.current?.focus(); }
    else if (opened.current) { opened.current = false; if (document.activeElement === document.body) nameRef.current?.focus(); }
  }, [open]);

  const slide = "transform 200ms ease, visibility 0s linear";
  const panel = (shown: boolean, from: string): React.CSSProperties => ({
    gridArea: "1 / 1", transform: shown ? "translateX(0)" : `translateX(${from})`,
    visibility: shown ? "visible" : "hidden", transition: `${slide} ${shown ? "0s" : "200ms"}`,
  });
  const iconBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: "34px", height: "30px",
    border: "none", background: "transparent", color: "var(--twilio-red, #e22)", cursor: busy ? "not-allowed" : "pointer", borderRadius: "4px",
  };
  const act = (mode: "run" | "chat" | "voice") => { setOpen(false); void go(mode); };
  const hover = (on: boolean) => (e: React.SyntheticEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = on ? "rgba(226,35,26,0.14)" : "transparent";
  };
  const icons: Array<{ mode: "run" | "chat" | "voice"; text: string; title: string; ref?: React.Ref<HTMLButtonElement>; svg: React.ReactNode }> = [
    { mode: "run", text: `Run ${label}`, title: "Run now", ref: runRef,
      svg: <path d="M6 4l14 8-14 8z" fill="currentColor" /> },
    { mode: "chat", text: `Add ${label} to the chat box`, title: "Add to chat",
      svg: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" fill="none" /> },
    { mode: "voice", text: `Start a voice session with ${label}`, title: "Start a voice session",
      svg: <><rect x="9" y="3" width="6" height="11" rx="3" fill="none" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" /></> },
  ];

  return (
    <div role="group" aria-label={label} data-scope={pin.scope}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
      onBlur={(e) => { if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0, ...(block ? { width: "100%" } : {}) }}>
      <div data-testid="pinned-chip" data-open={open}
        style={{ display: "inline-grid", overflow: "hidden", borderRadius: "6px", background: background ?? "rgba(226,35,26,0.08)",
          border: "1px solid rgba(226,35,26,0.3)", color: "var(--twilio-red, #e22)", fontFamily: "var(--font-base)", flex: block ? 1 : undefined }}>
        <button ref={nameRef} type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(true)} disabled={busy !== null}
          title={`${pin.skill.description}${pin.scope === "everyone" ? " — pinned for everyone" : ""}`}
          style={{ ...panel(!open, "-100%"), display: "inline-flex", alignItems: "center", gap: "5px", padding: "6px 14px", border: "none",
            background: "transparent", color: "inherit", fontSize: "0.8125rem", fontWeight: 600, whiteSpace: "nowrap",
            justifyContent: block ? "flex-start" : "center", cursor: busy ? "not-allowed" : "pointer" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={PIN_PATH} /><circle cx="12" cy="10" r="3" fill="#fff" />
          </svg>
          {busy ? "…" : label}
          {pin.scope === "everyone" && <span style={{ fontSize: "0.625rem", opacity: 0.7, fontWeight: 500 }}>· everyone</span>}
        </button>
        <div data-testid="pinned-chip-actions" style={{ ...panel(open, "100%"), display: "flex", alignItems: "center", justifyContent: "center", gap: "2px", padding: "2px 4px" }}>
          {icons.map((i) => (
            <button key={i.mode} ref={i.ref} type="button" disabled={busy !== null} onClick={() => act(i.mode)}
              aria-label={i.text} title={i.title} style={iconBtn} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{i.svg}</svg>
            </button>
          ))}
        </div>
      </div>
      {pin.can_remove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label} from this page`} title="Remove from this page"
          style={{ border: "none", background: "transparent", color: "var(--text-secondary, #888)", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: "4px 6px" }}>×</button>
      )}
      {message && !message.ok && <span role="status" style={{ fontSize: "0.6875rem", color: "#dc2626" }}>{message.text}</span>}
      {dialogNode}
    </div>
  );
}

/** Each page's own dropdown look, so the picker reads as part of that page. */
const PILL_SELECT = "appearance-none pr-10 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm transition-colors hover:border-gray-400 focus:border-indigo-400 focus:outline-none cursor-pointer";
/** The same white pill as the calendar's Search / Action Items buttons, on every page. */
const PAGE_SELECT_CLASS: Record<SkillPageKey, string> = {
  "calendar": PILL_SELECT,
  "action-items": PILL_SELECT,
  "reminders": PILL_SELECT,
  "account-detail": `${PILL_SELECT} w-full`,
  "layouts": `${PILL_SELECT} w-full`,
  "activity-log": `${PILL_SELECT} w-full`,
};
const addBtn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600, border: "none",
  background: "var(--twilio-red, #e22)", color: "#fff", cursor: "pointer", fontFamily: "var(--font-base)",
};

/** A custom arrow, inset from the pill's rounded edge (the native one hugs the border). */
const chevron: React.CSSProperties = {
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center", backgroundSize: "14px 14px",
};
