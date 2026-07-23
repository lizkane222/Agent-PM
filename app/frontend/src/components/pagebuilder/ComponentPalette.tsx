import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { COMPONENT_REGISTRY, CATEGORIES, type ComponentCategory } from "./registry";
import { PRODUCT_SHAPE_REGISTRY } from "./productShapeRegistry";
import { LUCIDCHART_ICON_REGISTRY } from "./lucidchartIconRegistry";
import type { ComponentVariant } from "./variantStore";

// ── Fuzzy match ───────────────────────────────────────────────────────────────
// Returns null (no match) or { score, ranges } where ranges is an array of
// [start, end] index pairs covering matched characters in `target`.
function fuzzyMatch(query: string, target: string): { score: number; ranges: [number, number][] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return { score: 0, ranges: [] };

  let qi = 0;
  const indices: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { indices.push(ti); qi++; }
  }
  if (qi < q.length) return null; // not all chars matched

  // Score: reward consecutive runs and early matches
  let score = 0;
  let run = 1;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) { run++; score += run * 2; }
    else { run = 1; }
  }
  score += (t.length - indices[0]) * -0.1; // slight penalty for late first match

  // Collapse consecutive indices into ranges for highlighting
  const ranges: [number, number][] = [];
  let start = indices[0];
  let prev = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === prev + 1) { prev = indices[i]; }
    else { ranges.push([start, prev]); start = indices[i]; prev = indices[i]; }
  }
  ranges.push([start, prev]);

  return { score, ranges };
}

function HighlightedLabel({ label, ranges }: { label: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <span>{label}</span>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [s, e] of ranges) {
    if (s > cursor) parts.push(<span key={cursor}>{label.slice(cursor, s)}</span>);
    parts.push(
      <span key={s} className="text-[var(--twilio-blue)] font-bold">
        {label.slice(s, e + 1)}
      </span>
    );
    cursor = e + 1;
  }
  if (cursor < label.length) parts.push(<span key={cursor}>{label.slice(cursor)}</span>);
  return <>{parts}</>;
}

// ── Palette item ──────────────────────────────────────────────────────────────
function PaletteItem({
  type, label, icon, ranges,
}: {
  type: string;
  label: string;
  icon: string;
  ranges?: [number, number][];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: "palette", componentType: type },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-[#E4F7FF] hover:text-[var(--twilio-blue)] ${
        isDragging ? "opacity-40" : "text-[var(--twilio-navy)]"
      }`}
      title={`Drag to add ${label}`}
    >
      <span className="text-sm w-5 text-center shrink-0 opacity-60">{icon}</span>
      <span className="text-xs font-medium truncate">
        {ranges ? <HighlightedLabel label={label} ranges={ranges} /> : label}
      </span>
    </div>
  );
}

// ── Collapsible section header ────────────────────────────────────────────────
function CollapsibleSection({
  label, defaultOpen = false, children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-0.5 group"
      >
        <span className={`text-[9px] text-[var(--twilio-gray-40)] transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--twilio-gray-40)] group-hover:text-[var(--twilio-gray-60)]">
          {label}
        </span>
      </button>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  );
}

// ── Image-based palette items (shapes / icons) ───────────────────────────────

function ImagePaletteItem({
  dragId, dragData, src, label,
}: {
  dragId: string;
  dragData: Record<string, unknown>;
  src: string;
  label: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`Drag to add: ${label}`}
      className={`flex flex-col items-center gap-0.5 p-1 rounded-lg cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-[#E4F7FF] group ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <img
        src={src}
        alt={label}
        className="w-10 h-10 object-contain opacity-75 group-hover:opacity-100"
        draggable={false}
      />
      <span className="text-[9px] text-[var(--twilio-gray-60)] truncate w-full text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

// ── Variant palette item ──────────────────────────────────────────────────────
function VariantPaletteItem({
  variant,
  onTogglePin,
  onToggleHeart,
  onDelete,
}: {
  variant: ComponentVariant;
  onTogglePin: (id: string) => void;
  onToggleHeart: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:variant:${variant.id}`,
    data: { kind: "palette", componentType: variant.baseType, presetProps: variant.node.props },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-1.5 pl-5 pr-2 py-1 rounded-md cursor-grab hover:bg-[#E4F7FF] group select-none ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="text-[10px] text-[var(--twilio-gray-40)] mr-0.5">↳</span>
      <span className="text-[11px] truncate flex-1 text-[var(--twilio-navy)]">{variant.name}</span>
      <div className="hidden group-hover:flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => onTogglePin(variant.id)}
          title="Pin"
          className="text-[11px] opacity-60 hover:opacity-100 px-0.5"
          style={{ color: variant.pinned ? "#0263E0" : undefined }}
        >📌</button>
        <button
          onClick={() => onToggleHeart(variant.id)}
          title="Heart"
          className="text-[11px] opacity-60 hover:opacity-100 px-0.5"
          style={{ color: variant.hearted ? "#EF4444" : undefined }}
        >♥</button>
        <button
          onClick={() => onDelete(variant.id)}
          title="Delete"
          className="text-[11px] text-red-400 hover:text-red-600 px-0.5"
        >✕</button>
      </div>
    </div>
  );
}

// ── Palette ───────────────────────────────────────────────────────────────────
interface PaletteProps {
  variants?: ComponentVariant[];
  onToggleVariantPin?: (id: string) => void;
  onToggleVariantHeart?: (id: string) => void;
  onDeleteVariant?: (id: string) => void;
}

export default function ComponentPalette({
  variants = [],
  onToggleVariantPin = () => {},
  onToggleVariantHeart = () => {},
  onDeleteVariant = () => {},
}: PaletteProps) {
  const [activeCategory, setActiveCategory] = useState<ComponentCategory | "All">("All");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isSearching = query.trim().length > 0;

  const searchResults = isSearching
    ? COMPONENT_REGISTRY
        .map((c) => {
          const m = fuzzyMatch(query.trim(), c.label);
          return m ? { ...c, score: m.score, ranges: m.ranges } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b!.score - a!.score) as (typeof COMPONENT_REGISTRY[0] & { score: number; ranges: [number, number][] })[]
    : [];

  const categoryFiltered = activeCategory === "All"
    ? COMPONENT_REGISTRY
    : COMPONENT_REGISTRY.filter((c) => c.category === activeCategory);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 shrink-0">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-2">Components</p>
        <div className="relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--twilio-gray-40)] pointer-events-none"
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}
          >
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M11 11l3 3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components…"
            className="w-full pl-6 pr-6 py-1.5 rounded-lg border border-gray-200 text-[11px] text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-40)] focus:outline-none focus:ring-2 focus:ring-[var(--twilio-blue)] bg-gray-50"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] text-xs leading-none px-0.5"
              tabIndex={-1}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category filter */}
      {!isSearching && (
        <div className="flex flex-wrap gap-1 px-3 pb-2 border-b border-gray-100 shrink-0">
          {(["All", ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                activeCategory === cat
                  ? "bg-[var(--twilio-blue)] text-white"
                  : "bg-gray-100 text-[var(--twilio-gray-60)] hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Component + asset list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {isSearching ? (
          searchResults.length > 0 ? (
            searchResults.map((c) => (
              <PaletteItem key={c.type} type={c.type} label={c.label} icon={c.icon} ranges={c.ranges} />
            ))
          ) : (
            <p className="px-2 py-4 text-center text-[11px] text-[var(--twilio-gray-40)]">
              No components match "{query}"
            </p>
          )
        ) : activeCategory === "All" ? (
          <>
            {/* AgentPM section */}
            <div className="mb-2">
              <p className="px-2 text-[10px] font-bold uppercase tracking-widest text-[var(--twilio-gray-40)] mb-1">AgentPM</p>
              {COMPONENT_REGISTRY.filter((c) => c.category === "AgentPM").map((c) => {
                const nodeVariants = variants.filter((v) => v.baseType === c.type);
                return (
                  <div key={c.type}>
                    <PaletteItem type={c.type} label={c.label} icon={c.icon} />
                    {nodeVariants.map((v) => (
                      <VariantPaletteItem
                        key={v.id}
                        variant={v}
                        onTogglePin={onToggleVariantPin}
                        onToggleHeart={onToggleVariantHeart}
                        onDelete={onDeleteVariant}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
            {CATEGORIES.filter((c) => c !== "Shapes" && c !== "Brand" && c !== "AgentPM").map((cat) => {
              const items = COMPONENT_REGISTRY.filter((c) => c.category === cat);
              return (
                <div key={cat} className="mb-2">
                  <p className="px-2 text-[10px] font-bold uppercase tracking-widest text-[var(--twilio-gray-40)] mb-1">{cat}</p>
                  {items.map((c) => (
                    <PaletteItem key={c.type} type={c.type} label={c.label} icon={c.icon} />
                  ))}
                </div>
              );
            })}
            {/* Shapes thumbnail grid */}
            <CollapsibleSection label="Shapes">
              <ShapesGrid />
            </CollapsibleSection>
            {/* Brand thumbnail grid */}
            <CollapsibleSection label="Brand">
              {COMPONENT_REGISTRY.filter((c) => c.category === "Brand").map((c) => (
                <PaletteItem key={c.type} type={c.type} label={c.label} icon={c.icon} />
              ))}
              <CollapsibleSection label="Twilio Icons">
                <LucidchartIconsGrid />
              </CollapsibleSection>
            </CollapsibleSection>
          </>
        ) : activeCategory === "AgentPM" ? (
          <>
            {COMPONENT_REGISTRY.filter((c) => c.category === "AgentPM").map((c) => {
              const nodeVariants = variants.filter((v) => v.baseType === c.type);
              return (
                <div key={c.type}>
                  <PaletteItem type={c.type} label={c.label} icon={c.icon} />
                  {nodeVariants.map((v) => (
                    <VariantPaletteItem
                      key={v.id}
                      variant={v}
                      onTogglePin={onToggleVariantPin}
                      onToggleHeart={onToggleVariantHeart}
                      onDelete={onDeleteVariant}
                    />
                  ))}
                </div>
              );
            })}
          </>
        ) : activeCategory === "Shapes" ? (
          <CollapsibleSection label="Product Shapes">
            <ShapesGrid />
          </CollapsibleSection>
        ) : activeCategory === "Brand" ? (
          <>
            {COMPONENT_REGISTRY.filter((c) => c.category === "Brand").map((c) => (
              <PaletteItem key={c.type} type={c.type} label={c.label} icon={c.icon} />
            ))}
            <CollapsibleSection label="Twilio Icons">
              <LucidchartIconsGrid />
            </CollapsibleSection>
          </>
        ) : (
          categoryFiltered.map((c) => (
            <PaletteItem key={c.type} type={c.type} label={c.label} icon={c.icon} />
          ))
        )}
      </div>
    </div>
  );
}

function ShapesGrid() {
  return (
    <div className="grid grid-cols-4 gap-0.5">
      {PRODUCT_SHAPE_REGISTRY.map((s) => (
        <ImagePaletteItem
          key={s.filename}
          dragId={`palette:ProductShape:${s.filename}`}
          dragData={{ kind: "palette", componentType: "ProductShape", presetProps: { shape: s.filename, size: 200, tintColor: "" } }}
          src={s.src}
          label={s.name}
        />
      ))}
    </div>
  );
}

function LucidchartIconsGrid() {
  return (
    <div className="grid grid-cols-3 gap-0.5">
      {LUCIDCHART_ICON_REGISTRY.map((ic) => (
        <ImagePaletteItem
          key={ic.filename}
          dragId={`palette:LucidchartIcon:${ic.filename}`}
          dragData={{ kind: "palette", componentType: "LucidchartIcon", presetProps: { icon: ic.filename, size: 80 } }}
          src={ic.src}
          label={ic.name}
        />
      ))}
    </div>
  );
}
