import type { CanvasNode } from "./types";
import ColorPicker from "./ColorPicker";
import RichTextEditor from "./RichTextEditor";

// Nodes that expose the text format toolbar
const TEXT_TYPES = new Set(["Heading", "Text", "Label", "Badge", "Pill", "TwilioFont"]);

function FormatBtn({
  active, title, onClick, children,
}: { active?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, borderRadius: 4, border: "1px solid",
        borderColor: active ? "var(--twilio-red, #DB131A)" : "#D1D5DB",
        background: active ? "rgba(219,19,26,0.08)" : "#fff",
        color: active ? "var(--twilio-red, #DB131A)" : "#374151",
        cursor: "pointer", fontSize: 12, fontWeight: 700, flexShrink: 0,
        transition: "border-color 0.1s, background 0.1s",
      }}
    >
      {children}
    </button>
  );
}

const WEIGHT_OPTIONS = [
  { label: "Thin", value: 100 },
  { label: "Light", value: 300 },
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "SemiBold", value: 600 },
  { label: "Bold", value: 700 },
  { label: "ExtraBold", value: 800 },
  { label: "Black", value: 900 },
];

interface Props {
  node: CanvasNode;
  onChange: (id: string, props: Record<string, unknown>) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
    />
  );
}

function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
    />
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-gray-200 px-2 py-1 text-xs bg-white"
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function PropEditor({ node, onChange }: Props) {
  const p = node.props;
  const set = (key: string, value: unknown) => onChange(node.id, { ...p, [key]: value });

  return (
    <div className="space-y-3 px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--twilio-gray-60)]">{node.type}</p>

      {/* ── Text / label props ─────────────────────────────────────────── */}
      {"text" in p && (
        <Row label="Text">
          <TextInput value={p.text as string} onChange={(v) => set("text", v)} placeholder="Enter text…" />
        </Row>
      )}
      {"label" in p && node.type !== "StatCard" && (
        <Row label="Label">
          <TextInput value={p.label as string} onChange={(v) => set("label", v)} placeholder="Button label" />
        </Row>
      )}
      {"label" in p && node.type === "StatCard" && (
        <Row label="Metric Label">
          <TextInput value={p.label as string} onChange={(v) => set("label", v)} placeholder="Metric name" />
        </Row>
      )}
      {"value" in p && node.type === "StatCard" && (
        <Row label="Value">
          <TextInput value={p.value as string} onChange={(v) => set("value", v)} placeholder="—" />
        </Row>
      )}
      {"initials" in p && (
        <Row label="Initials">
          <TextInput value={p.initials as string} onChange={(v) => set("initials", v)} placeholder="AB" />
        </Row>
      )}
      {"glyph" in p && (
        <Row label="Icon glyph">
          <TextInput value={p.glyph as string} onChange={(v) => set("glyph", v)} placeholder="✦" />
        </Row>
      )}
      {"level" in p && (
        <Row label="Level">
          <SelectInput value={String(p.level)} onChange={(v) => set("level", Number(v))} options={["1", "2", "3", "4"]} />
        </Row>
      )}

      {/* ── Rich text ──────────────────────────────────────────────────── */}
      {node.type === "RichText" && (
        <Row label="Content">
          <RichTextEditor html={p.html as string || ""} onChange={(html) => set("html", html)} />
        </Row>
      )}

      {/* ── Layout props ───────────────────────────────────────────────── */}
      {"direction" in p && (
        <Row label="Direction">
          <SelectInput value={p.direction as string} onChange={(v) => set("direction", v)} options={["column", "row"]} />
        </Row>
      )}
      {"alignItems" in p && (
        <Row label="Align items">
          <SelectInput value={p.alignItems as string} onChange={(v) => set("alignItems", v)} options={["flex-start", "center", "flex-end", "stretch"]} />
        </Row>
      )}
      {"justifyContent" in p && (
        <Row label="Justify content">
          <SelectInput value={p.justifyContent as string} onChange={(v) => set("justifyContent", v)} options={["flex-start", "center", "flex-end", "space-between", "space-around"]} />
        </Row>
      )}
      {"gap" in p && (
        <Row label="Gap (px)">
          <NumberInput value={p.gap as number} onChange={(v) => set("gap", v)} min={0} max={128} />
        </Row>
      )}
      {"padding" in p && (
        <Row label="Padding (px)">
          <NumberInput value={p.padding as number} onChange={(v) => set("padding", v)} min={0} max={128} />
        </Row>
      )}
      {"borderRadius" in p && (
        <Row label="Border radius (px)">
          <NumberInput value={p.borderRadius as number} onChange={(v) => set("borderRadius", v)} min={0} max={999} />
        </Row>
      )}
      {"size" in p && (
        <Row label="Size (px)">
          <NumberInput value={p.size as number} onChange={(v) => set("size", v)} min={8} max={200} />
        </Row>
      )}
      {"fontSize" in p && (
        <Row label="Font size (px)">
          <NumberInput value={p.fontSize as number} onChange={(v) => set("fontSize", v)} min={8} max={96} />
        </Row>
      )}
      {"fontWeight" in p && (
        <Row label="Font weight">
          <select
            value={String(p.fontWeight ?? 400)}
            onChange={(e) => set("fontWeight", Number(e.target.value))}
            className="w-full rounded border border-gray-200 px-2 py-1 text-xs bg-white"
          >
            {WEIGHT_OPTIONS.map(({ label, value }) => (
              <option key={value} value={value}>{label} ({value})</option>
            ))}
          </select>
        </Row>
      )}

      {/* ── Text format toolbar ─────────────────────────────────────────── */}
      {TEXT_TYPES.has(node.type) && (
        <>
          <Row label="Format">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <FormatBtn
                title="Italic"
                active={(p.fontStyle as string) === "italic"}
                onClick={() => set("fontStyle", (p.fontStyle as string) === "italic" ? "normal" : "italic")}
              >
                <em>I</em>
              </FormatBtn>
              <FormatBtn
                title="Underline"
                active={String(p.textDecoration ?? "").includes("underline")}
                onClick={() => {
                  const cur = String(p.textDecoration ?? "none");
                  const has = cur.includes("underline");
                  const next = has ? cur.replace("underline", "").trim() || "none"
                    : cur === "none" ? "underline" : `${cur} underline`;
                  set("textDecoration", next);
                }}
              >
                <span style={{ textDecoration: "underline" }}>U</span>
              </FormatBtn>
              <FormatBtn
                title="Strikethrough"
                active={String(p.textDecoration ?? "").includes("line-through")}
                onClick={() => {
                  const cur = String(p.textDecoration ?? "none");
                  const has = cur.includes("line-through");
                  const next = has ? cur.replace("line-through", "").trim() || "none"
                    : cur === "none" ? "line-through" : `${cur} line-through`;
                  set("textDecoration", next);
                }}
              >
                <span style={{ textDecoration: "line-through" }}>S</span>
              </FormatBtn>
              <FormatBtn
                title="Superscript"
                active={(p.verticalAlign as string) === "super"}
                onClick={() => set("verticalAlign", (p.verticalAlign as string) === "super" ? "baseline" : "super")}
              >
                x<sup style={{ fontSize: 8 }}>²</sup>
              </FormatBtn>
              <FormatBtn
                title="Subscript"
                active={(p.verticalAlign as string) === "sub"}
                onClick={() => set("verticalAlign", (p.verticalAlign as string) === "sub" ? "baseline" : "sub")}
              >
                x<sub style={{ fontSize: 8 }}>₂</sub>
              </FormatBtn>
            </div>
          </Row>

          <Row label="Line height">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="range"
                min={0.8} max={3} step={0.05}
                value={(p.lineHeight as number) ?? 1.5}
                onChange={(e) => set("lineHeight", Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 11, minWidth: 28, textAlign: "right", color: "#6B7280" }}>
                {((p.lineHeight as number) ?? 1.5).toFixed(2)}
              </span>
            </div>
          </Row>

          <Row label="Letter spacing">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="range"
                min={-0.1} max={0.5} step={0.01}
                value={parseFloat(String(p.letterSpacing ?? "0")) || 0}
                onChange={(e) => set("letterSpacing", `${e.target.value}em`)}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 11, minWidth: 36, textAlign: "right", color: "#6B7280" }}>
                {String(p.letterSpacing ?? "0em")}
              </span>
            </div>
          </Row>
        </>
      )}

      {/* ── Color props ────────────────────────────────────────────────── */}
      {"background" in p && (
        <Row label="Background">
          <ColorPicker value={(p.background as string) || "transparent"} onChange={(v) => set("background", v)} />
        </Row>
      )}
      {"color" in p && (
        <Row label="Text / icon color">
          <ColorPicker value={(p.color as string) || "#121C2D"} onChange={(v) => set("color", v)} />
        </Row>
      )}
      {"shadow" in p && (
        <Row label="Box shadow">
          <TextInput value={p.shadow as string} onChange={(v) => set("shadow", v)} placeholder="0 1px 3px rgba(0,0,0,0.1)" />
        </Row>
      )}
      {"border" in p && (
        <Row label="Border">
          <TextInput value={p.border as string} onChange={(v) => set("border", v)} placeholder="1px solid #E1E3EA" />
        </Row>
      )}
      {"thickness" in p && (
        <Row label="Thickness (px)">
          <NumberInput value={p.thickness as number} onChange={(v) => set("thickness", v)} min={1} max={16} />
        </Row>
      )}

      {/* ── Photo Shape props ──────────────────────────────────────────── */}
      {"fillColor" in p && (
        <Row label="Fill color">
          <ColorPicker value={(p.fillColor as string) || "transparent"} onChange={(v) => set("fillColor", v)} />
        </Row>
      )}
      {"imageUrl" in p && (
        <Row label="Image URL">
          <div className="flex gap-1">
            <TextInput
              value={p.imageUrl as string}
              onChange={(v) => set("imageUrl", v)}
              placeholder="https://… or drag an image"
            />
            {(p.imageUrl as string) && (
              <button
                onClick={() => set("imageUrl", "")}
                className="shrink-0 px-1.5 rounded border border-gray-200 text-[10px] text-red-400 hover:text-red-600"
                title="Clear image"
              >✕</button>
            )}
          </div>
        </Row>
      )}

      {/* ── Product Shape props ────────────────────────────────────────── */}
      {"tintColor" in p && (
        <Row label="Tint color">
          <ColorPicker value={(p.tintColor as string) || "transparent"} onChange={(v) => set("tintColor", v)} />
        </Row>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {node.type === "Table" && (
        <>
          <Row label="Headers">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(["headerRow", "headerCol"] as const).map((key) => {
                const label = key === "headerRow" ? "Header row" : "Header column";
                const checked = key === "headerRow" ? p[key] !== false : p[key] === true;
                return (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => set(key, e.target.checked)}
                      style={{ accentColor: "var(--twilio-blue)" }}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </Row>
          <Row label="Columns">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {((p.columns as string[]) || []).map((col, i) => (
                <TextInput key={i} value={col} onChange={(v) => {
                  const next = (p.columns as string[]).map((c, ci) => ci === i ? v : c);
                  set("columns", next);
                }} placeholder={`Column ${i + 1}`} />
              ))}
            </div>
          </Row>
        </>
      )}

      {/* ── Timeline ──────────────────────────────────────────────────────── */}
      {node.type === "Timeline" && (
        <>
          <Row label="Start date">
            <input
              type="date"
              value={(p.startDate as string) || ""}
              onChange={(e) => set("startDate", e.target.value)}
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </Row>
          <Row label="End date">
            <input
              type="date"
              value={(p.endDate as string) || ""}
              onChange={(e) => set("endDate", e.target.value)}
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </Row>
          {"accentColor" in p && (
            <Row label="Accent color">
              <ColorPicker value={(p.accentColor as string) || "#0263E0"} onChange={(v) => set("accentColor", v)} />
            </Row>
          )}
          {(p.accountName as string) && (
            <Row label="Account">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#374151", flex: 1 }}>{p.accountName as string}</span>
                <button
                  onClick={() => set("accountId", 0) || set("accountName", "") || set("meetings", [])}
                  className="text-[10px] text-red-400 hover:text-red-600"
                >✕</button>
              </div>
            </Row>
          )}
          {Array.isArray(p.meetings) && (p.meetings as unknown[]).length > 0 && (
            <Row label="Meetings">
              <span style={{ fontSize: 12, color: "#6B7280" }}>{(p.meetings as unknown[]).length} fetched</span>
            </Row>
          )}
        </>
      )}

      {/* ── AgentPM record fields ────────────────────────────────────────────── */}
      {"taskTitle" in p && (
        <Row label="Task title">
          <TextInput value={p.taskTitle as string} onChange={(v) => set("taskTitle", v)} />
        </Row>
      )}
      {"companyName" in p && (
        <Row label="Company name">
          <TextInput value={p.companyName as string} onChange={(v) => set("companyName", v)} />
        </Row>
      )}
      {"fullName" in p && (
        <Row label="Full name">
          <TextInput value={p.fullName as string} onChange={(v) => set("fullName", v)} />
        </Row>
      )}
      {"title" in p && node.type === "TeamMemberCard" && (
        <Row label="Job title">
          <TextInput value={p.title as string} onChange={(v) => set("title", v)} />
        </Row>
      )}
      {"email" in p && node.type === "TeamMemberCard" && (
        <Row label="Email">
          <TextInput value={p.email as string} onChange={(v) => set("email", v)} />
        </Row>
      )}
      {"role" in p && node.type === "TeamMemberCard" && (
        <Row label="Role">
          <TextInput value={p.role as string} onChange={(v) => set("role", v)} />
        </Row>
      )}
      {"assigneeName" in p && (
        <Row label="Assignee">
          <TextInput value={p.assigneeName as string} onChange={(v) => set("assigneeName", v)} />
        </Row>
      )}
      {"accountName" in p && node.type === "ActionItemCard" && (
        <Row label="Account">
          <TextInput value={p.accountName as string} onChange={(v) => set("accountName", v)} />
        </Row>
      )}
      {"dueDate" in p && (
        <Row label="Due date">
          <TextInput value={p.dueDate as string} onChange={(v) => set("dueDate", v)} placeholder="2026-07-01" />
        </Row>
      )}
      {"status" in p && (node.type === "ActionItemCard" || node.type === "AccountCard" || node.type === "ReminderCard") && (
        <Row label="Status">
          <TextInput value={p.status as string} onChange={(v) => set("status", v)} />
        </Row>
      )}
      {"priority" in p && (
        <Row label="Priority">
          <SelectInput value={p.priority as string} onChange={(v) => set("priority", v)} options={["Critical", "High", "Normal", "Low"]} />
        </Row>
      )}
      {"arr" in p && (
        <Row label="ARR">
          <TextInput value={p.arr as string} onChange={(v) => set("arr", v)} placeholder="$1.2M" />
        </Row>
      )}
      {"industry" in p && (
        <Row label="Industry">
          <TextInput value={p.industry as string} onChange={(v) => set("industry", v)} />
        </Row>
      )}
      {"body" in p && node.type === "ReminderCard" && (
        <Row label="Body">
          <TextInput value={p.body as string} onChange={(v) => set("body", v)} />
        </Row>
      )}
      {"dueAt" in p && (
        <Row label="Due at">
          <TextInput value={p.dueAt as string} onChange={(v) => set("dueAt", v)} placeholder="2026-07-01T09:00" />
        </Row>
      )}
      {"startDatetime" in p && (
        <Row label="Start">
          <TextInput value={p.startDatetime as string} onChange={(v) => set("startDatetime", v)} placeholder="2026-07-01T09:00" />
        </Row>
      )}
      {"endDatetime" in p && (
        <Row label="End">
          <TextInput value={p.endDatetime as string} onChange={(v) => set("endDatetime", v)} placeholder="2026-07-01T10:00" />
        </Row>
      )}
      {"location" in p && (
        <Row label="Location">
          <TextInput value={p.location as string} onChange={(v) => set("location", v)} />
        </Row>
      )}
      {"attendeeCount" in p && (
        <Row label="Attendees">
          <NumberInput value={p.attendeeCount as number} onChange={(v) => set("attendeeCount", v)} min={0} />
        </Row>
      )}
      {"accentColor" in p && (
        <Row label="Accent color">
          <ColorPicker value={(p.accentColor as string) || "#0263E0"} onChange={(v) => set("accentColor", v)} />
        </Row>
      )}

    </div>
  );
}
