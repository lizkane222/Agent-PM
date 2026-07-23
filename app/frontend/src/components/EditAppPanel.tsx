/**
 * EditAppPanel — floating color/shadow editor injected into the sidebar.
 *
 * Usage:
 *   - Enable via the "Edit App" toggle in Settings.
 *   - When active, clicking any element on the page opens the panel with
 *     options to change its background color or box-shadow.
 *   - Colors drawn from CSS custom properties defined in index.css.
 *   - Changes are stored in localStorage under "editAppOverrides".
 *   - Export produces a JSON file; Reset clears the selected element's overrides.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ElementOverride {
  selector: string;       // unique CSS selector path recorded at click time
  label: string;          // human-readable label (tag + classes, truncated)
  page: string;           // window.location.pathname at time of click
  bg?: string;            // background-color override
  shadow?: string;        // box-shadow override
}

export type OverridesMap = Record<string, ElementOverride>; // keyed by selector

// ── Default palette — matches index.css CSS custom properties ─────────────────

const DEFAULT_PALETTE: { name: string; value: string }[] = [
  { name: "Twilio Red",        value: "#DB131A" },
  { name: "Twilio Red Dark",   value: "#B10F12" },
  { name: "Twilio Red Light",  value: "#FDECED" },
  { name: "Twilio Blue",       value: "#0263E0" },
  { name: "Twilio Blue Dark",  value: "#043CB5" },
  { name: "Twilio Blue Light", value: "#E4F7FF" },
  { name: "Navy",              value: "#121C2D" },
  { name: "Navy Light",        value: "#1C2B45" },
  { name: "Slate",             value: "#354052" },
  { name: "White",             value: "#FFFFFF" },
  { name: "Gray 10",           value: "#F4F4F6" },
  { name: "Gray 20",           value: "#E1E3EA" },
  { name: "Gray 40",           value: "#AEBBC1" },
  { name: "Gray 60",           value: "#606B85" },
  { name: "Gray 80",           value: "#39476A" },
  { name: "Gray 100",          value: "#000D25" },
  { name: "Slate 50",          value: "#F8FAFC" },
  { name: "Indigo 600",        value: "#0263E0" },
  { name: "Transparent",       value: "transparent" },
];

const SHADOW_PRESETS: { name: string; value: string }[] = [
  { name: "None",        value: "none" },
  { name: "Blue SM",     value: "0 0 6px 1px rgba(30,58,100,0.10)" },
  { name: "Blue MD",     value: "0 0 12px 2px rgba(30,58,100,0.14)" },
  { name: "Blue LG",     value: "0 0 20px 4px rgba(30,58,100,0.18)" },
  { name: "Gray SM",     value: "0 1px 3px 0 rgba(0,0,0,0.10)" },
  { name: "Gray MD",     value: "0 4px 12px -1px rgba(0,0,0,0.12)" },
  { name: "Warm SM",     value: "0 1px 4px 0 rgba(0,0,0,0.08)" },
];

const STORAGE_KEY = "editAppOverrides";
const PALETTE_KEY = "editAppPalette";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < 5) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) { part += `#${cur.id}`; parts.unshift(part); break; }
    const cls = Array.from(cur.classList).slice(0, 3).join(".");
    if (cls) part += `.${cls}`;
    const siblings = cur.parentElement
      ? Array.from(cur.parentElement.children).filter(
          (c) => c.tagName === cur!.tagName
        )
      : [];
    if (siblings.length > 1) {
      const idx = siblings.indexOf(cur) + 1;
      part += `:nth-of-type(${idx})`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = Array.from(el.classList).slice(0, 4).join(" ");
  return `<${tag}> ${cls}`.slice(0, 60);
}

function loadOverrides(): OverridesMap {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}

function saveOverrides(o: OverridesMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
}

function loadPalette(): { name: string; value: string }[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? "null");
    return Array.isArray(saved) ? saved : DEFAULT_PALETTE;
  } catch { return DEFAULT_PALETTE; }
}

function savePalette(p: { name: string; value: string }[]) {
  localStorage.setItem(PALETTE_KEY, JSON.stringify(p));
}

// Apply all stored overrides to the DOM via a <style> tag
function applyOverridesToDOM(overrides: OverridesMap) {
  let tag = document.getElementById("edit-app-overrides-style");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "edit-app-overrides-style";
    document.head.appendChild(tag);
  }
  const rules = Object.values(overrides)
    .map((o) => {
      const props: string[] = [];
      if (o.bg)     props.push(`background-color: ${o.bg} !important`);
      if (o.shadow) props.push(`box-shadow: ${o.shadow} !important`);
      return props.length ? `${o.selector} { ${props.join("; ")} }` : "";
    })
    .filter(Boolean);
  tag.textContent = rules.join("\n");
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EditAppPanel({ onClose }: { onClose: () => void }) {
  const [overrides, setOverrides] = useState<OverridesMap>(loadOverrides);
  const [palette, setPalette] = useState(loadPalette);
  const [selected, setSelected] = useState<ElementOverride | null>(null);
  const [editBg, setEditBg]         = useState(false);
  const [editShadow, setEditShadow] = useState(false);
  const [bgColor, setBgColor]       = useState("#FFFFFF");
  const [shadowValue, setShadowValue] = useState("none");
  const [newColorName, setNewColorName] = useState("");
  const [newColorValue, setNewColorValue] = useState("#000000");
  const [pickingElement, setPickingElement] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Apply overrides to DOM whenever they change
  useEffect(() => { applyOverridesToDOM(overrides); }, [overrides]);

  // Element picker
  useEffect(() => {
    if (!pickingElement) {
      if (overlayRef.current) { overlayRef.current.remove(); overlayRef.current = null; }
      if (highlightRef.current) { highlightRef.current.remove(); highlightRef.current = null; }
      return;
    }

    document.body.style.cursor = "crosshair";

    // Highlight box
    const highlight = document.createElement("div");
    highlight.style.cssText = `
      position:fixed; pointer-events:none; z-index:99998;
      outline: 2px solid #0263E0; background: rgba(2,99,224,0.06);
      transition: all 0.05s; border-radius:4px;
    `;
    document.body.appendChild(highlight);
    highlightRef.current = highlight;

    function onMove(e: MouseEvent) {
      const panel = document.getElementById("edit-app-panel");
      const target = e.target as Element;
      if (panel?.contains(target)) { highlight.style.display = "none"; return; }
      highlight.style.display = "block";
      const r = target.getBoundingClientRect();
      Object.assign(highlight.style, {
        top: r.top + "px", left: r.left + "px",
        width: r.width + "px", height: r.height + "px",
      });
    }

    function onClick(e: MouseEvent) {
      const panel = document.getElementById("edit-app-panel");
      const target = e.target as Element;
      if (panel?.contains(target)) return;
      e.preventDefault(); e.stopPropagation();

      const sel = buildSelector(target);
      const existing = overrides[sel];
      const computed = window.getComputedStyle(target);

      const override: ElementOverride = existing ?? {
        selector: sel,
        label: elementLabel(target),
        page: window.location.pathname,
      };

      setSelected(override);
      setBgColor(existing?.bg ?? computed.backgroundColor ?? "#FFFFFF");
      setShadowValue(existing?.shadow ?? computed.boxShadow ?? "none");
      setEditBg(!!existing?.bg);
      setEditShadow(!!existing?.shadow);
      setPickingElement(false);
      document.body.style.cursor = "";
    }

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      document.body.style.cursor = "";
      highlight.remove();
    };
  }, [pickingElement, overrides]);

  const applyChange = useCallback(() => {
    if (!selected) return;
    const updated: ElementOverride = { ...selected };
    if (editBg) updated.bg = bgColor; else delete updated.bg;
    if (editShadow) updated.shadow = shadowValue; else delete updated.shadow;

    const next = { ...overrides, [selected.selector]: updated };
    setOverrides(next);
    saveOverrides(next);
    setSelected(updated);
  }, [selected, editBg, bgColor, editShadow, shadowValue, overrides]);

  const resetSelected = useCallback(() => {
    if (!selected) return;
    const next = { ...overrides };
    delete next[selected.selector];
    setOverrides(next);
    saveOverrides(next);
    setSelected({ ...selected, bg: undefined, shadow: undefined });
    setEditBg(false);
    setEditShadow(false);
  }, [selected, overrides]);

  const exportChanges = useCallback(() => {
    const blob = new Blob([JSON.stringify(overrides, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "edit-app-overrides.json";
    a.click(); URL.revokeObjectURL(url);
  }, [overrides]);

  const addColor = useCallback(() => {
    if (!newColorName.trim() || !newColorValue) return;
    const next = [...palette, { name: newColorName.trim(), value: newColorValue }];
    setPalette(next); savePalette(next);
    setNewColorName(""); setNewColorValue("#000000");
  }, [newColorName, newColorValue, palette]);

  const removeColor = useCallback((idx: number) => {
    const next = palette.filter((_, i) => i !== idx);
    setPalette(next); savePalette(next);
  }, [palette]);

  const overrideCount = Object.keys(overrides).length;

  return (
    <div
      id="edit-app-panel"
      className="flex flex-col h-full overflow-y-auto text-[var(--twilio-navy)]"
      style={{ fontSize: "0.8125rem" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <span className="font-semibold text-sm">Edit App</span>
        <button onClick={onClose} className="text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] text-lg leading-none">✕</button>
      </div>

      {/* Pick element */}
      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <button
          onClick={() => setPickingElement((v) => !v)}
          className={`w-full py-2 rounded-lg text-sm font-semibold border transition-colors ${
            pickingElement
              ? "bg-[var(--twilio-blue)] text-white border-[var(--twilio-blue)]"
              : "bg-white border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50"
          }`}
        >
          {pickingElement ? "🎯 Click an element…" : "Pick element"}
        </button>
        {pickingElement && (
          <p className="text-xs text-[var(--twilio-gray-60)] mt-1 text-center">Click any element on the page to select it</p>
        )}
      </div>

      {/* Selected element + edit controls */}
      {selected && (
        <div className="px-4 py-3 border-b border-gray-100 space-y-3 shrink-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Selected</p>
            <p className="text-xs font-mono mt-0.5 text-[var(--twilio-navy)] break-all leading-relaxed">{selected.label}</p>
            <p className="text-[10px] text-[var(--twilio-gray-60)] mt-0.5">{selected.page}</p>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editBg} onChange={(e) => setEditBg(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600" />
              <span className="text-xs font-medium">Background color</span>
            </label>
            {editBg && (
              <div className="pl-5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input type="color" value={bgColor.startsWith("#") ? bgColor : "#ffffff"}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="h-7 w-10 rounded border border-gray-200 cursor-pointer p-0.5" />
                  <input type="text" value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs font-mono" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {palette.map((c) => (
                    <button key={c.value + c.name} title={c.name}
                      onClick={() => setBgColor(c.value)}
                      className="h-5 w-5 rounded-full border border-gray-200 hover:scale-110 transition-transform shrink-0"
                      style={{ background: c.value === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0/8px 8px" : c.value }}
                    />
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editShadow} onChange={(e) => setEditShadow(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600" />
              <span className="text-xs font-medium">Box shadow</span>
            </label>
            {editShadow && (
              <div className="pl-5 space-y-1.5">
                <input type="text" value={shadowValue}
                  onChange={(e) => setShadowValue(e.target.value)}
                  placeholder="e.g. 0 0 12px 2px rgba(30,58,100,0.14)"
                  className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono" />
                <div className="flex flex-col gap-1">
                  {SHADOW_PRESETS.map((p) => (
                    <button key={p.name} onClick={() => setShadowValue(p.value)}
                      className={`text-left px-2 py-1 rounded text-xs transition-colors ${
                        shadowValue === p.value ? "bg-indigo-50 text-indigo-700 font-semibold" : "hover:bg-gray-50"
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Apply / Reset */}
          <div className="flex gap-2 pt-1">
            <button onClick={applyChange}
              className="flex-1 py-1.5 rounded-lg bg-[var(--twilio-blue)] text-white text-xs font-semibold hover:bg-[var(--twilio-blue-dark)] transition-colors">
              Apply
            </button>
            <button onClick={resetSelected}
              className="flex-1 py-1.5 rounded-lg border border-gray-200 text-[var(--twilio-navy)] text-xs font-semibold hover:bg-gray-50 transition-colors">
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Applied overrides list */}
      {overrideCount > 0 && (
        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
              Applied ({overrideCount})
            </p>
            <button onClick={exportChanges}
              className="text-xs text-[var(--twilio-blue)] hover:underline font-medium">
              Export JSON
            </button>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {Object.values(overrides).map((o) => (
              <div key={o.selector}
                onClick={() => { setSelected(o); setBgColor(o.bg ?? "#ffffff"); setShadowValue(o.shadow ?? "none"); setEditBg(!!o.bg); setEditShadow(!!o.shadow); }}
                className="flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer group"
              >
                <div className="flex gap-1 shrink-0 mt-0.5">
                  {o.bg && <span className="h-3 w-3 rounded-full border border-gray-200" style={{ background: o.bg }} />}
                  {o.shadow && <span className="h-3 w-3 rounded-full border border-gray-200 bg-white" style={{ boxShadow: o.shadow }} />}
                </div>
                <p className="text-[11px] text-[var(--twilio-navy)] truncate flex-1 font-mono">{o.label}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); const n = { ...overrides }; delete n[o.selector]; setOverrides(n); saveOverrides(n); }}
                  className="shrink-0 text-[var(--twilio-gray-40)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Palette editor */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Color palette</p>
        <div className="flex flex-wrap gap-1">
          {palette.map((c, i) => (
            <div key={i} className="group relative">
              <button title={`${c.name}: ${c.value}`}
                onClick={() => { if (editBg) setBgColor(c.value); }}
                className="h-6 w-6 rounded-full border border-gray-200 hover:scale-110 transition-transform block"
                style={{ background: c.value === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0/8px 8px" : c.value }}
              />
              <button onClick={() => removeColor(i)}
                className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-500 text-white text-[8px] leading-none items-center justify-center hidden group-hover:flex">
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 items-center">
          <input type="color" value={newColorValue} onChange={(e) => setNewColorValue(e.target.value)}
            className="h-7 w-8 rounded border border-gray-200 cursor-pointer p-0.5 shrink-0" />
          <input type="text" value={newColorName} onChange={(e) => setNewColorName(e.target.value)}
            placeholder="Name" className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs" />
          <button onClick={addColor}
            className="px-2 py-1 rounded bg-[var(--twilio-blue)] text-white text-xs font-semibold hover:bg-[var(--twilio-blue-dark)] shrink-0">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
