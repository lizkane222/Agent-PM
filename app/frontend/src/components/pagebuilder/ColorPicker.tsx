import { useState } from "react";

export const BRAND_PALETTE = [
  { group: "Brand", colors: [
    { name: "Twilio Red",       value: "#DB131A" },
    { name: "Red Dark",         value: "#B10F12" },
    { name: "Red Light",        value: "#FDECED" },
    { name: "Twilio Blue",      value: "#0263E0" },
    { name: "Blue Dark",        value: "#043CB5" },
    { name: "Blue Light",       value: "#E4F7FF" },
    { name: "Navy",             value: "#121C2D" },
    { name: "Navy Light",       value: "#1C2B45" },
    { name: "Slate",            value: "#354052" },
  ]},
  { group: "Gray", colors: [
    { name: "White",            value: "#FFFFFF" },
    { name: "Gray 10",          value: "#F4F4F6" },
    { name: "Gray 20",          value: "#E1E3EA" },
    { name: "Gray 40",          value: "#AEBBC1" },
    { name: "Gray 60",          value: "#606B85" },
    { name: "Gray 80",          value: "#39476A" },
    { name: "Gray 100",         value: "#000D25" },
    { name: "Slate 50",         value: "#F8FAFC" },
  ]},
  { group: "Semantic", colors: [
    { name: "Success",          value: "#22C55E" },
    { name: "Success Light",    value: "#DCFCE7" },
    { name: "Warning",          value: "#F59E0B" },
    { name: "Warning Light",    value: "#FEF3C7" },
    { name: "Error",            value: "#EF4444" },
    { name: "Error Light",      value: "#FEE2E2" },
  ]},
  { group: "Other", colors: [
    { name: "Transparent",      value: "transparent" },
  ]},
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export default function ColorPicker({ value, onChange, label }: Props) {
  const [custom, setCustom] = useState(value.startsWith("#") ? value : "#ffffff");

  const swatchStyle = (v: string) =>
    v === "transparent"
      ? { background: "repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0/10px 10px" }
      : { background: v };

  return (
    <div className="space-y-2">
      {label && <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">{label}</p>}

      {/* Current value */}
      <div className="flex items-center gap-2">
        <span
          className="h-6 w-6 rounded-full border border-gray-300 shrink-0"
          style={swatchStyle(value)}
        />
        <span className="text-xs font-mono text-[var(--twilio-navy)]">{value || "—"}</span>
      </div>

      {/* Palette groups */}
      {BRAND_PALETTE.map((group) => (
        <div key={group.group}>
          <p className="text-[10px] text-[var(--twilio-gray-60)] mb-1">{group.group}</p>
          <div className="flex flex-wrap gap-1">
            {group.colors.map((c) => (
              <button
                key={c.value}
                title={`${c.name} — ${c.value}`}
                onClick={() => onChange(c.value)}
                className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 shrink-0 ${
                  value === c.value ? "ring-2 ring-[var(--twilio-blue)] ring-offset-1 border-[var(--twilio-blue)]" : "border-gray-300"
                }`}
                style={swatchStyle(c.value)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Custom hex input */}
      <div className="flex items-center gap-1.5 pt-1">
        <input
          type="color"
          value={custom}
          onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
          className="h-6 w-8 rounded border border-gray-200 cursor-pointer p-0.5 shrink-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => { setCustom(e.target.value); onChange(e.target.value); }}
          placeholder="#hex or rgba(…)"
          className="flex-1 rounded border border-gray-200 px-2 py-1 text-[11px] font-mono"
        />
      </div>
    </div>
  );
}
