import { useRef, useState, useEffect, useCallback } from "react";
import { useDroppable } from "@dnd-kit/core";
import DOMPurify from "dompurify";
import type { CanvasNode } from "./types";
import DraggableNode from "./DraggableNode";
import ResizableWrapper from "./ResizableWrapper";
import IconPicker from "./IconPicker";
import PhotoShapePicker from "./PhotoShapePicker";
import ProductShapePicker from "./ProductShapePicker";
import LucidchartIconPicker from "./LucidchartIconPicker";
import { ICON_REGISTRY } from "./iconRegistry";
import { PHOTO_SHAPE_REGISTRY } from "./photoShapeRegistry";
import { PRODUCT_SHAPE_REGISTRY } from "./productShapeRegistry";
import { LUCIDCHART_ICON_REGISTRY } from "./lucidchartIconRegistry";

// ── Inline text editor ────────────────────────────────────────────────────────
// Double-click to edit in place; Enter or blur commits. Shift+Enter = newline.
// Wraps any tag via `as` prop. Copy/paste/undo are native to contentEditable.
function InlineText({
  as: Tag = "span",
  value,
  onChange,
  style,
  className,
}: {
  as?: keyof JSX.IntrinsicElements;
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const committed = useRef(value);

  // Sync external value when NOT editing
  useEffect(() => {
    if (!editing && ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value, editing]);

  const commit = useCallback(() => {
    const next = ref.current?.textContent ?? "";
    committed.current = next;
    onChange(next);
    setEditing(false);
  }, [onChange]);

  return (
    <Tag
      ref={ref as React.RefObject<never>}
      contentEditable={editing}
      suppressContentEditableWarning
      style={{ ...style, outline: editing ? "2px solid var(--twilio-blue)" : undefined, outlineOffset: 2, cursor: editing ? "text" : "default" }}
      className={className}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
        // place cursor at end after paint
        requestAnimationFrame(() => {
          const el = ref.current;
          if (!el) return;
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          el.focus();
        });
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          // revert
          if (ref.current) ref.current.textContent = committed.current;
          setEditing(false);
        }
        // stop canvas keyboard shortcuts while editing
        e.stopPropagation();
      }}
      // prevent drag-start while editing
      onPointerDown={(e) => { if (editing) e.stopPropagation(); }}
    >
      {value}
    </Tag>
  );
}

interface Props {
  node: CanvasNode;
  selectedId: string | null;
  onSelect: (id: string, shift?: boolean) => void;
  onDelete: (id: string) => void;
  onResizeLive:   (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  onResizeCommit: (id: string, w: number | undefined, h: number | undefined, x?: number, y?: number) => void;
  onUpdateProps?: (id: string, props: Record<string, unknown>) => void;
  onImportTeamMembers?: (anchorNodeId: string) => void;
  onFetchTimelineMeetings?: (nodeId: string) => void;
  depth?: number;
}

function ChildDropZone({
  nodeId, children, isEmpty, style, width, height,
}: {
  nodeId: string;
  children: React.ReactNode;
  isEmpty: boolean;
  style?: React.CSSProperties;
  width?: number;
  height?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${nodeId}` });
  return (
    <div
      ref={setNodeRef}
      style={{
        position: "relative",
        overflow: "visible",
        width: width ? `${width}px` : "100%",
        height: height ? `${height}px` : undefined,
        minHeight: isEmpty ? 60 : undefined,
        ...style,
      }}
      className={`rounded transition-colors ${
        isOver ? "outline outline-2 outline-dashed outline-[var(--twilio-blue)] bg-indigo-50/40" : ""
      } ${isEmpty && !isOver ? "outline outline-1 outline-dashed outline-gray-200" : ""}`}
    >
      {isEmpty && !isOver && (
        <p className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--twilio-gray-40)] select-none pointer-events-none">
          Drop here
        </p>
      )}
      {children}
    </div>
  );
}

export default function NodeRenderer({ node, selectedId, onSelect, onDelete, onResizeLive, onResizeCommit, onUpdateProps, onImportTeamMembers, onFetchTimelineMeetings, depth = 0 }: Props) {
  const p = node.props;
  const isSelected = selectedId === node.id;
  const [showIconPicker, setShowIconPicker] = useState(false);
  const iconAnchorRef = useRef<HTMLElement | null>(null);
  const [showShapePicker, setShowShapePicker] = useState(false);
  const shapeAnchorRef = useRef<HTMLElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const outerClasses = `relative group/node cursor-pointer rounded transition-all overflow-visible ${
    isSelected
      ? "ring-2 ring-[var(--twilio-blue)]"
      : "hover:ring-1 hover:ring-[var(--twilio-blue)] hover:ring-opacity-40"
  }`;

  const childProps = { selectedId, onSelect, onDelete, onResizeLive, onResizeCommit, onUpdateProps, onImportTeamMembers, onFetchTimelineMeetings };

  const renderContent = () => {
    switch (node.type) {

      // ── Containers ──────────────────────────────────────────────────────────
      case "Container": {
        const w = p.width as number | undefined;
        const h = p.height as number | undefined;
        return (
          <ChildDropZone nodeId={node.id} isEmpty={node.children.length === 0} width={w} height={h} style={{
            background: (p.background as string) || "rgba(255,255,255,0.5)",
            border: (p.border as string) || "none",
            borderRadius: `${p.borderRadius ?? 8}px`,
          }}>
            {node.children.map((c) => <DraggableNode key={c.id} node={c} {...childProps} depth={depth + 1} isNested />)}
          </ChildDropZone>
        );
      }

      case "Row": {
        const w = p.width as number | undefined;
        const h = p.height as number | undefined;
        return (
          <ChildDropZone nodeId={node.id} isEmpty={node.children.length === 0} width={w} height={h} style={{
            background: (p.background as string) || "rgba(255,255,255,0.5)",
          }}>
            {node.children.map((c) => <DraggableNode key={c.id} node={c} {...childProps} depth={depth + 1} isNested />)}
          </ChildDropZone>
        );
      }

      case "Column": {
        const w = p.width as number | undefined;
        const h = p.height as number | undefined;
        return (
          <ChildDropZone nodeId={node.id} isEmpty={node.children.length === 0} width={w} height={h} style={{
            background: (p.background as string) || "rgba(255,255,255,0.5)",
          }}>
            {node.children.map((c) => <DraggableNode key={c.id} node={c} {...childProps} depth={depth + 1} isNested />)}
          </ChildDropZone>
        );
      }

      case "Card": {
        const w = p.width as number | undefined;
        const h = p.height as number | undefined;
        return (
          <ChildDropZone nodeId={node.id} isEmpty={node.children.length === 0} width={w} height={h} style={{
            background: (p.background as string) || "#FFFFFF",
            borderRadius: `${p.borderRadius ?? 12}px`,
            border: "1px solid #E1E3EA",
            boxShadow: (p.shadow as string) || "0 1px 3px 0 rgba(0,0,0,0.06)",
          }}>
            {node.children.map((c) => <DraggableNode key={c.id} node={c} {...childProps} depth={depth + 1} isNested />)}
          </ChildDropZone>
        );
      }

      case "Section": {
        const w = p.width as number | undefined;
        const h = p.height as number | undefined;
        return (
          <ChildDropZone nodeId={node.id} isEmpty={node.children.length === 0} width={w} height={h} style={{
            background: (p.background as string) || "rgba(255,255,255,0.5)",
            borderRadius: `${p.borderRadius ?? 16}px`,
            border: "1px solid #E1E3EA",
          }}>
            {node.children.map((c) => <DraggableNode key={c.id} node={c} {...childProps} depth={depth + 1} isNested />)}
          </ChildDropZone>
        );
      }

      // ── Content ─────────────────────────────────────────────────────────────
      case "Heading": {
        const Tag = (`h${p.level ?? 1}`) as keyof JSX.IntrinsicElements;
        const sizes: Record<number, string> = { 1: "1.875rem", 2: "1.5rem", 3: "1.25rem", 4: "1.125rem" };
        return (
          <InlineText
            as={Tag}
            value={p.text as string || "Heading"}
            onChange={(v) => onUpdateProps?.(node.id, { ...p, text: v })}
            style={{
              color: (p.color as string) || "#121C2D",
              fontWeight: (p.fontWeight as number) || 700,
              fontStyle: (p.fontStyle as string) || "normal",
              textDecoration: (p.textDecoration as string) || "none",
              verticalAlign: (p.verticalAlign as string) || "baseline",
              letterSpacing: (p.letterSpacing as string) || "0em",
              fontSize: sizes[(p.level as number) ?? 1],
              margin: 0, lineHeight: (p.lineHeight as number) ?? 1.25, display: "block",
            }}
          />
        );
      }

      case "Text":
        return (
          <InlineText
            as="p"
            value={p.text as string || "Text"}
            onChange={(v) => onUpdateProps?.(node.id, { ...p, text: v })}
            style={{
              color: (p.color as string) || "#39476A",
              fontSize: `${p.fontSize ?? 14}px`,
              fontWeight: (p.fontWeight as number) || 400,
              fontStyle: (p.fontStyle as string) || "normal",
              textDecoration: (p.textDecoration as string) || "none",
              verticalAlign: (p.verticalAlign as string) || "baseline",
              letterSpacing: (p.letterSpacing as string) || "0em",
              lineHeight: (p.lineHeight as number) ?? 1.5,
              margin: 0, whiteSpace: "pre-wrap",
            }}
          />
        );

      case "RichText":
        return (
          <div
            className="prose prose-sm max-w-none"
            style={{ color: (p.color as string) || "#39476A" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize((p.html as string) || "<p>Rich text…</p>") }}
          />
        );

      case "Label":
        return (
          <InlineText
            as="span"
            value={p.text as string || "LABEL"}
            onChange={(v) => onUpdateProps?.(node.id, { ...p, text: v })}
            style={{
              color: (p.color as string) || "#606B85",
              fontSize: `${p.fontSize ?? 10}px`,
              fontWeight: (p.fontWeight as number) || 600,
              fontStyle: (p.fontStyle as string) || "normal",
              textDecoration: (p.textDecoration as string) || "none",
              letterSpacing: (p.letterSpacing as string) || "0.08em",
              lineHeight: (p.lineHeight as number) ?? 1.2,
              textTransform: "uppercase",
            }}
          />
        );

      case "Divider":
        return (
          <hr style={{
            border: "none",
            borderTop: `${p.thickness ?? 1}px solid ${(p.color as string) || "#E1E3EA"}`,
            margin: `${p.margin ?? 8}px 0`,
          }} />
        );

      // ── Interactive ──────────────────────────────────────────────────────────
      case "Button": {
        const variant = (p.variant as string) || "primary";
        const base: React.CSSProperties = {
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: "8px 16px", fontSize: "0.875rem", fontWeight: 500,
          cursor: "pointer", border: "none", transition: "background 150ms",
          borderRadius: 9999,
          width: "100%", height: "100%",
        };
        const variantStyle: React.CSSProperties =
          variant === "secondary"
            ? { background: "#FFFFFF", color: "#374151", border: "1px solid #D1D5DB" }
            : variant === "destructive"
            ? { background: "#DC2626", color: "#FFFFFF" }
            : { background: (p.background as string) || "#0263E0", color: (p.color as string) || "#FFFFFF" };
        return (
          <button className="card-btn" style={{ ...base, ...variantStyle }}>
            <InlineText
              as="span"
              value={p.label as string || "Button"}
              onChange={(v) => onUpdateProps?.(node.id, { ...p, label: v })}
            />
          </button>
        );
      }

      case "Badge":
        return (
          <InlineText
            as="span"
            value={p.text as string || "Badge"}
            onChange={(v) => onUpdateProps?.(node.id, { ...p, text: v })}
            className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium"
            style={{
              background: (p.background as string) || "#E4F7FF",
              color: (p.color as string) || "#0263E0",
              borderRadius: 9999,
              fontStyle: (p.fontStyle as string) || "normal",
              textDecoration: (p.textDecoration as string) || "none",
              letterSpacing: (p.letterSpacing as string) || "0em",
            }}
          />
        );

      case "Pill":
        return (
          <InlineText
            as="span"
            value={p.text as string || "Pill"}
            onChange={(v) => onUpdateProps?.(node.id, { ...p, text: v })}
            className="inline-flex items-center px-3 py-1 text-xs font-semibold"
            style={{
              background: (p.background as string) || "#E8EAF4",
              color: (p.color as string) || "#2D3561",
              borderRadius: 9999,
              fontStyle: (p.fontStyle as string) || "normal",
              textDecoration: (p.textDecoration as string) || "none",
              letterSpacing: (p.letterSpacing as string) || "0em",
            }}
          />
        );

      // ── Data ────────────────────────────────────────────────────────────────
      case "StatCard":
        return (
          // Stat card: bg-white rounded-lg border border-gray-100 p-4
          <div style={{
            background: (p.background as string) || "#FFFFFF",
            borderRadius: `${p.borderRadius ?? 8}px`,
            border: "1px solid #F3F4F6",
            padding: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            width: "100%", height: "100%",
            display: "flex", flexDirection: "column", gap: "4px",
          }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#606B85", margin: 0 }}>
              {p.label as string || "Metric"}
            </p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#121C2D", margin: 0 }}>
              {p.value as string || "—"}
            </p>
          </div>
        );

      case "Table": {
        const cols = (p.columns as string[]) || ["Column 1", "Column 2"];
        const rows = (p.rows as string[][]) || [["—", "—"]];
        const headerRow = p.headerRow !== false; // default true
        const headerCol = p.headerCol === true;  // default false

        const setCol = (i: number, v: string) => {
          const next = cols.map((c, ci) => ci === i ? v : c);
          onUpdateProps?.(node.id, { ...p, columns: next });
        };
        const setCell = (ri: number, ci: number, v: string) => {
          const next = rows.map((row, r) => r === ri ? row.map((cell, c) => c === ci ? v : cell) : row);
          onUpdateProps?.(node.id, { ...p, rows: next });
        };
        const addRow = () => {
          const next = [...rows, cols.map(() => "—")];
          onUpdateProps?.(node.id, { ...p, rows: next });
        };
        const removeRow = () => {
          if (rows.length <= 1) return;
          onUpdateProps?.(node.id, { ...p, rows: rows.slice(0, -1) });
        };
        const addCol = () => {
          const nextCols = [...cols, `Column ${cols.length + 1}`];
          const nextRows = rows.map((row) => [...row, "—"]);
          onUpdateProps?.(node.id, { ...p, columns: nextCols, rows: nextRows });
        };
        const removeCol = () => {
          if (cols.length <= 1) return;
          const nextCols = cols.slice(0, -1);
          const nextRows = rows.map((row) => row.slice(0, -1));
          onUpdateProps?.(node.id, { ...p, columns: nextCols, rows: nextRows });
        };

        const thStyle: React.CSSProperties = {
          padding: "6px 12px", textAlign: "left", fontSize: 11, fontWeight: 700,
          color: "var(--twilio-gray-60)", textTransform: "uppercase", letterSpacing: "0.06em",
          background: "#F8FAFC", borderBottom: "2px solid #E1E3EA", whiteSpace: "nowrap",
        };
        const tdStyle: React.CSSProperties = {
          padding: "6px 12px", fontSize: 13, color: "var(--twilio-navy)",
          borderBottom: "1px solid #F3F4F6",
        };
        const firstColThStyle: React.CSSProperties = {
          ...thStyle, background: "#F1F5F9", borderRight: "2px solid #E1E3EA", borderBottom: "1px solid #F3F4F6",
        };

        return (
          <div style={{ position: "relative" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              {headerRow && (
                <thead>
                  <tr>
                    {cols.map((col, ci) => (
                      <th key={ci} style={ci === 0 && headerCol ? { ...thStyle, borderRight: "2px solid #E1E3EA" } : thStyle}>
                        <InlineText
                          as="span"
                          value={col}
                          onChange={(v) => setCol(ci, v)}
                          style={{ display: "block" }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 1 ? "#FAFBFC" : "#fff" }}>
                    {row.map((cell, ci) => {
                      const isHeaderCell = headerCol && ci === 0;
                      return isHeaderCell ? (
                        <th key={ci} style={firstColThStyle}>
                          <InlineText
                            as="span"
                            value={cell}
                            onChange={(v) => setCell(ri, ci, v)}
                            style={{ display: "block" }}
                          />
                        </th>
                      ) : (
                        <td key={ci} style={tdStyle}>
                          <InlineText
                            as="span"
                            value={cell}
                            onChange={(v) => setCell(ri, ci, v)}
                            style={{ display: "block" }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Row / col controls — only visible when selected */}
            {isSelected && (
              <div
                style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {[
                  { label: "+ row", fn: addRow },
                  { label: "− row", fn: removeRow, disabled: rows.length <= 1 },
                  { label: "+ col", fn: addCol },
                  { label: "− col", fn: removeCol, disabled: cols.length <= 1 },
                ].map(({ label, fn, disabled }) => (
                  <button
                    key={label}
                    onClick={fn}
                    disabled={disabled}
                    style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 4,
                      border: "1px solid #D1D5DB", background: "#fff",
                      color: disabled ? "#CBD5E1" : "#374151",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      }

      // ── Media ────────────────────────────────────────────────────────────────
      case "Avatar": {
        const avatarSz = Math.min(
          (p.width as number) ?? (p.size as number) ?? 40,
          (p.height as number) ?? (p.size as number) ?? 40,
        );
        return (
          <div className="inline-flex items-center justify-center text-sm font-semibold shrink-0" style={{
            width: `${avatarSz}px`,
            height: `${avatarSz}px`,
            background: (p.background as string) || "#0263E0",
            color: (p.color as string) || "#FFFFFF",
            borderRadius: 9999,
          }}>
            <InlineText
              as="span"
              value={p.initials as string || "AB"}
              onChange={(v) => onUpdateProps?.(node.id, { ...p, initials: v })}
            />
          </div>
        );
      }

      case "Icon": {
        const filename = p.icon as string | undefined;
        const entry = filename ? ICON_REGISTRY.find((ic) => ic.filename === filename) : null;
        const sz = Math.min(
          (p.width as number) ?? (p.size as number) ?? 24,
          (p.height as number) ?? (p.size as number) ?? 24,
        );
        return (
          <>
            {showIconPicker && (
              <IconPicker
                anchorRef={iconAnchorRef}
                onSelect={(f) => onUpdateProps?.(node.id, { ...node.props, icon: f })}
                onClose={() => setShowIconPicker(false)}
              />
            )}
            <span
              ref={iconAnchorRef as React.RefObject<HTMLSpanElement>}
              title="Click to choose icon"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node.id);
                setShowIconPicker((v) => !v);
              }}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: sz, height: sz,
                cursor: "pointer",
              }}
            >
              {entry ? (
                <img
                  src={entry.src}
                  alt={entry.name}
                  style={{ width: sz, height: sz, opacity: 0.8 }}
                  draggable={false}
                />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                  style={{ width: sz, height: sz, color: (p.color as string) || "#606B85" }}>
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M9 12h6M12 9v6" />
                </svg>
              )}
            </span>
          </>
        );
      }

      case "PhotoShape": {
        const shapeFilename = p.shape as string | undefined;
        const shapeEntry = shapeFilename
          ? PHOTO_SHAPE_REGISTRY.find((s) => s.filename === shapeFilename)
          : null;
        const sz = Math.min(
          (p.width as number) ?? (p.size as number) ?? 200,
          (p.height as number) ?? (p.size as number) ?? 200,
        );
        const fillColor = (p.fillColor as string) || "";
        const imageUrl = (p.imageUrl as string) || "";

        const maskStyle: React.CSSProperties = shapeEntry
          ? {
              maskImage: `url(${shapeEntry.src})`,
              WebkitMaskImage: `url(${shapeEntry.src})`,
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
            }
          : {};

        function handleDrop(e: React.DragEvent) {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);

          // Accept a dragged image file
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = () => {
              onUpdateProps?.(node.id, { ...node.props, imageUrl: reader.result as string });
            };
            reader.readAsDataURL(file);
            return;
          }
          // Accept a dragged image URL (from browser or other elements)
          const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
          if (url && /^https?:\/\//.test(url)) {
            onUpdateProps?.(node.id, { ...node.props, imageUrl: url });
          }
        }

        return (
          <>
            {showShapePicker && (
              <PhotoShapePicker
                anchorRef={shapeAnchorRef}
                onSelect={(f) => onUpdateProps?.(node.id, { ...node.props, shape: f })}
                onClose={() => setShowShapePicker(false)}
              />
            )}
            <div
              ref={shapeAnchorRef as React.RefObject<HTMLDivElement>}
              style={{ width: sz, height: sz, position: "relative", cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node.id);
                setShowShapePicker((v) => !v);
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.stopPropagation(); setIsDragOver(false); }}
              onDrop={handleDrop}
              title="Click to choose shape · Drag an image onto the shape"
            >
              {shapeEntry ? (
                /* Masked container — both fill layer and image are clipped to the shape */
                <div style={{ width: "100%", height: "100%", position: "relative", ...maskStyle }}>
                  {/* Fill color layer */}
                  {fillColor && (
                    <div style={{
                      position: "absolute", inset: 0,
                      background: fillColor,
                    }} />
                  )}
                  {/* Photo layer */}
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      draggable={false}
                    />
                  ) : (
                    /* Fallback: show the shape PNG itself as a tinted preview */
                    <img
                      src={shapeEntry.src}
                      alt={shapeEntry.name}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
                        opacity: isDragOver ? 0.5 : 1 }}
                      draggable={false}
                    />
                  )}
                  {/* Drag-over overlay */}
                  {isDragOver && (
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "rgba(2,99,224,0.25)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ fontSize: 28 }}>🖼</span>
                    </div>
                  )}
                </div>
              ) : (
                /* No shape selected yet — placeholder */
                <div style={{
                  width: "100%", height: "100%",
                  border: "2px dashed #CBD5E1",
                  borderRadius: 12,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 6,
                  background: isDragOver ? "#EEF4FF" : "#F8FAFC",
                  transition: "background 150ms",
                }}>
                  <span style={{ fontSize: 28, opacity: 0.35 }}>⬡</span>
                  <span style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", lineHeight: 1.3 }}>
                    Click to<br />choose shape
                  </span>
                </div>
              )}
            </div>
          </>
        );
      }

      // ── Product Shape ────────────────────────────────────────────────────────
      case "ProductShape": {
        const shapeFilename = p.shape as string | undefined;
        const shapeEntry = shapeFilename
          ? PRODUCT_SHAPE_REGISTRY.find((s) => s.filename === shapeFilename)
          : null;
        const sz = Math.min(
          (p.width as number) ?? (p.size as number) ?? 200,
          (p.height as number) ?? (p.size as number) ?? 200,
        );
        const tint = (p.tintColor as string) || "";

        return (
          <>
            {showShapePicker && (
              <ProductShapePicker
                anchorRef={shapeAnchorRef}
                onSelect={(f) => onUpdateProps?.(node.id, { ...node.props, shape: f })}
                onClose={() => setShowShapePicker(false)}
              />
            )}
            <div
              ref={shapeAnchorRef as React.RefObject<HTMLDivElement>}
              style={{ width: sz, height: sz, position: "relative", cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node.id);
                setShowShapePicker((v) => !v);
              }}
              title="Click to choose shape"
            >
              {shapeEntry ? (
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  {tint && (
                    <div style={{
                      position: "absolute", inset: 0,
                      background: tint,
                      mixBlendMode: "multiply",
                      borderRadius: 4,
                    }} />
                  )}
                  <img
                    src={shapeEntry.src}
                    alt={shapeEntry.name}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    draggable={false}
                  />
                </div>
              ) : (
                <div style={{
                  width: "100%", height: "100%",
                  border: "2px dashed #CBD5E1",
                  borderRadius: 12,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 6,
                  background: "#F8FAFC",
                }}>
                  <span style={{ fontSize: 28, opacity: 0.35 }}>⬟</span>
                  <span style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", lineHeight: 1.3 }}>
                    Click to<br />choose shape
                  </span>
                </div>
              )}
            </div>
          </>
        );
      }

      // ── Lucidchart / Twilio Icon ─────────────────────────────────────────────
      case "LucidchartIcon": {
        const iconFilename = p.icon as string | undefined;
        const iconEntry = iconFilename
          ? LUCIDCHART_ICON_REGISTRY.find((ic) => ic.filename === iconFilename)
          : null;
        const sz = Math.min(
          (p.width as number) ?? (p.size as number) ?? 80,
          (p.height as number) ?? (p.size as number) ?? 80,
        );

        return (
          <>
            {showIconPicker && (
              <LucidchartIconPicker
                anchorRef={iconAnchorRef}
                onSelect={(f) => onUpdateProps?.(node.id, { ...node.props, icon: f })}
                onClose={() => setShowIconPicker(false)}
              />
            )}
            <span
              ref={iconAnchorRef as React.RefObject<HTMLSpanElement>}
              title="Click to choose icon"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(node.id);
                setShowIconPicker((v) => !v);
              }}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: sz, height: sz, cursor: "pointer",
              }}
            >
              {iconEntry ? (
                <img
                  src={iconEntry.src}
                  alt={iconEntry.name}
                  style={{ width: sz, height: sz, objectFit: "contain" }}
                  draggable={false}
                />
              ) : (
                <div style={{
                  width: sz, height: sz,
                  border: "2px dashed #CBD5E1",
                  borderRadius: 8,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 4,
                  background: "#F8FAFC",
                }}>
                  <span style={{ fontSize: Math.max(16, sz * 0.3), opacity: 0.35 }}>⬡</span>
                  <span style={{ fontSize: 10, color: "#94A3B8", textAlign: "center" }}>
                    Click to pick
                  </span>
                </div>
              )}
            </span>
          </>
        );
      }

      // ── Twilio Font text block ───────────────────────────────────────────────
      case "TwilioFont": {
        const w = (p.fontWeight as number) ?? 400;
        return (
          <InlineText
            as="p"
            value={p.text as string || "Twilio Sans Mono"}
            onChange={(v) => onUpdateProps?.(node.id, { ...p, text: v })}
            style={{
              fontFamily: `'TwilioSansMono', 'Courier New', monospace`,
              fontWeight: w,
              fontStyle: (p.fontStyle as string) || "normal",
              textDecoration: (p.textDecoration as string) || "none",
              letterSpacing: (p.letterSpacing as string) || "0em",
              lineHeight: (p.lineHeight as number) ?? 1.3,
              fontSize: `${(p.fontSize as number) ?? 24}px`,
              color: (p.color as string) || "#121C2D",
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          />
        );
      }

      // ── AgentPM Components ───────────────────────────────────────────────────
      case "ActionItemCard": {
        const STATUS_COLORS: Record<string, string> = {
          Open: "#6366f1", "In Progress": "#F59E0B", Done: "#10B981", Blocked: "#EF4444", Backlogged: "#64748B",
        };
        const PRIORITY_COLORS: Record<string, string> = {
          Critical: "#EF4444", High: "#F97316", Normal: "#6366f1", Low: "#9CA3AF",
        };
        const accent = (p.accentColor as string) || "#0263E0";
        const status = (p.status as string) || "Open";
        const priority = (p.priority as string) || "Normal";
        return (
          <div style={{
            background: (p.background as string) || "#fff",
            borderRadius: (p.borderRadius as number) || 8,
            border: `1.5px solid ${accent}33`,
            borderLeft: `4px solid ${accent}`,
            padding: "10px 12px",
            fontFamily: "var(--font-base)",
            width: "100%", minHeight: 80,
            display: "flex", flexDirection: "column", gap: 6,
            boxSizing: "border-box",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLORS[priority] || "#6366f1", flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: STATUS_COLORS[status] || "#6366f1", background: `${STATUS_COLORS[status] || "#6366f1"}18`, padding: "1px 6px", borderRadius: 99 }}>
                {status}
              </span>
              {(p.dueDate as string) && (
                <span style={{ fontSize: 10, color: "#9CA3AF", marginLeft: "auto" }}>
                  📅 {p.dueDate as string}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#121C2D", lineHeight: 1.3, wordBreak: "break-word" }}>
              {(p.taskTitle as string) || "Action item title"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {(p.accountName as string) && (
                <span style={{ fontSize: 10, color: "#6B7280", background: "#F3F4F6", padding: "1px 6px", borderRadius: 99 }}>
                  {p.accountName as string}
                </span>
              )}
              {(p.assigneeName as string) && (
                <span style={{ fontSize: 10, color: "#fff", background: accent, padding: "1px 6px", borderRadius: 99, marginLeft: "auto" }}>
                  {p.assigneeName as string}
                </span>
              )}
            </div>
          </div>
        );
      }

      case "AccountCard": {
        const STATUS_COLORS: Record<string, string> = {
          active: "#10B981", prospect: "#6366f1", inactive: "#9CA3AF", churned: "#EF4444",
        };
        const accent = (p.accentColor as string) || "#0263E0";
        const status = (p.status as string) || "active";
        const initial = ((p.companyName as string) || "?")[0].toUpperCase();
        return (
          <div style={{
            background: (p.background as string) || "#fff",
            borderRadius: (p.borderRadius as number) || 8,
            border: `1.5px solid ${accent}33`,
            padding: "10px 12px",
            fontFamily: "var(--font-base)",
            width: "100%", minHeight: 70,
            display: "flex", flexDirection: "column", gap: 6,
            boxSizing: "border-box",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: `${accent}22`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#121C2D", wordBreak: "break-word" }}>
                  {(p.companyName as string) || "Company Name"}
                </div>
                {(p.industry as string) && (
                  <div style={{ fontSize: 10, color: "#6B7280" }}>{p.industry as string}</div>
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: STATUS_COLORS[status] || "#6B7280", background: `${STATUS_COLORS[status] || "#6B7280"}18`, padding: "2px 7px", borderRadius: 99, flexShrink: 0 }}>
                {status}
              </span>
            </div>
            {(p.arr as string) && (
              <div style={{ fontSize: 11, color: "#374151", background: "#F9FAFB", borderRadius: 6, padding: "4px 8px" }}>
                ARR: <strong>{p.arr as string}</strong>
              </div>
            )}
          </div>
        );
      }

      case "ReminderCard": {
        const accent = (p.accentColor as string) || "#F59E0B";
        return (
          <div style={{
            background: (p.background as string) || "#fff",
            borderRadius: (p.borderRadius as number) || 8,
            border: `1.5px solid ${accent}44`,
            borderTop: `3px solid ${accent}`,
            padding: "10px 12px",
            fontFamily: "var(--font-base)",
            width: "100%", minHeight: 60,
            display: "flex", flexDirection: "column", gap: 5,
            boxSizing: "border-box",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>🔔</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#121C2D", lineHeight: 1.3, wordBreak: "break-word" }}>
                {(p.title as string) || "Reminder title"}
              </span>
            </div>
            {(p.dueAt as string) && (
              <div style={{ fontSize: 10, color: accent, fontWeight: 600 }}>Due: {p.dueAt as string}</div>
            )}
            {(p.body as string) && (
              <div style={{ fontSize: 11, color: "#6B7280", lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {p.body as string}
              </div>
            )}
          </div>
        );
      }

      case "CalendarEventCard": {
        const accent = (p.accentColor as string) || "#7C3AED";
        return (
          <div style={{
            background: (p.background as string) || "#fff",
            borderRadius: (p.borderRadius as number) || 8,
            border: `1.5px solid ${accent}33`,
            padding: "10px 12px",
            fontFamily: "var(--font-base)",
            width: "100%", minHeight: 80,
            display: "flex", flexDirection: "column", gap: 5,
            boxSizing: "border-box",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: `${accent}18`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: accent, textTransform: "uppercase", lineHeight: 1 }}>
                  {(p.startDatetime as string) ? new Date(p.startDatetime as string).toLocaleString("en-US", { month: "short" }) : "EVT"}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: accent, lineHeight: 1 }}>
                  {(p.startDatetime as string) ? new Date(p.startDatetime as string).getDate() : "—"}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#121C2D", wordBreak: "break-word" }}>
                  {(p.title as string) || "Event Title"}
                </div>
                {(p.startDatetime as string) && (
                  <div style={{ fontSize: 10, color: "#6B7280" }}>
                    {new Date(p.startDatetime as string).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    {(p.endDatetime as string) && ` – ${new Date(p.endDatetime as string).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
                  </div>
                )}
              </div>
            </div>
            {(p.location as string) && (
              <div style={{ fontSize: 10, color: "#6B7280" }}>📍 {p.location as string}</div>
            )}
            {(p.attendeeCount as number) > 0 && (
              <div style={{ fontSize: 10, color: accent }}>👥 {p.attendeeCount as number} attendees</div>
            )}
          </div>
        );
      }

      case "TeamMemberCard": {
        const accent = (p.accentColor as string) || "#059669";
        const initials = ((p.fullName as string) || "?").split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();
        return (
          <div style={{ position: "relative" }}>
            <div style={{
              background: (p.background as string) || "#fff",
              borderRadius: (p.borderRadius as number) || 8,
              border: `1.5px solid ${accent}33`,
              padding: "10px 12px",
              fontFamily: "var(--font-base)",
              width: "100%", minHeight: 70,
              display: "flex", flexDirection: "column", gap: 5,
              boxSizing: "border-box",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#121C2D", wordBreak: "break-word" }}>
                    {(p.fullName as string) || "Full Name"}
                  </div>
                  {(p.title as string) && (
                    <div style={{ fontSize: 10, color: "#6B7280" }}>{p.title as string}</div>
                  )}
                </div>
                {(p.role as string) && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: "#fff", background: accent, padding: "2px 6px", borderRadius: 99, flexShrink: 0 }}>
                    {p.role as string}
                  </span>
                )}
              </div>
              {(p.email as string) && (
                <div style={{ fontSize: 10, color: "#6B7280" }}>✉ {p.email as string}</div>
              )}
            </div>
            {isSelected && onImportTeamMembers && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onImportTeamMembers(node.id); }}
                style={{
                  marginTop: 5, width: "100%", padding: "4px 0",
                  border: `1px dashed ${accent}66`, borderRadius: 6,
                  background: `${accent}08`, color: accent,
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}
              >
                <span style={{ fontSize: 13 }}>＋</span> Import team members
              </button>
            )}
          </div>
        );
      }

      case "Timeline": {
        const accent = (p.accentColor as string) || "#0263E0";
        const startDate = (p.startDate as string) || "";
        const endDate = (p.endDate as string) || "";
        const accountName = (p.accountName as string) || "";
        type MeetingItem = { id: number; title: string; start_datetime: string };
        const meetings = (p.meetings as MeetingItem[]) || [];

        const startMs = startDate ? new Date(startDate).getTime() : 0;
        const endMs = endDate ? new Date(endDate).getTime() : 0;
        const spanMs = endMs > startMs ? endMs - startMs : 0;

        function pct(dtStr: string) {
          if (!spanMs) return 0;
          const t = new Date(dtStr).getTime();
          return Math.min(100, Math.max(0, ((t - startMs) / spanMs) * 100));
        }

        const hasRange = startDate && endDate && endMs > startMs;

        return (
          <div style={{
            background: "#fff", borderRadius: (p.borderRadius as number) || 8,
            border: `1.5px solid ${accent}33`, padding: "12px 14px",
            fontFamily: "var(--font-base)", width: "100%", minHeight: 72,
            boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8,
          }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: "0.04em" }}>⟼ TIMELINE</span>
              {accountName && (
                <span style={{ fontSize: 10, color: "#fff", background: accent, padding: "1px 7px", borderRadius: 99, fontWeight: 600 }}>
                  {accountName}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {isSelected && onFetchTimelineMeetings && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onFetchTimelineMeetings(node.id); }}
                  style={{
                    padding: "3px 10px", borderRadius: 5, border: `1px solid ${accent}`,
                    background: `${accent}10`, color: accent, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {accountName ? "↻ Refresh" : "Fetch meetings…"}
                </button>
              )}
            </div>

            {/* Date range labels */}
            {hasRange && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
                <span>{new Date(startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <span>{new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>
            )}

            {/* Track */}
            {hasRange && (
              <div style={{ position: "relative", height: 6, background: `${accent}18`, borderRadius: 99, margin: "0 2px" }}>
                <div style={{ position: "absolute", inset: 0, background: `${accent}33`, borderRadius: 99 }} />
                {meetings.filter((m) => m.start_datetime).map((m) => {
                  const left = pct(m.start_datetime);
                  return (
                    <div
                      key={m.id}
                      title={`${m.title}\n${new Date(m.start_datetime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      style={{
                        position: "absolute",
                        left: `${left}%`,
                        top: -3,
                        width: 12, height: 12,
                        borderRadius: "50%",
                        background: accent,
                        border: "2px solid #fff",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                        transform: "translateX(-50%)",
                        cursor: "default",
                        zIndex: 1,
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Meeting list */}
            {meetings.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 120, overflowY: "auto" }}>
                {meetings.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: "#121C2D", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                    {m.start_datetime && (
                      <span style={{ color: "#9CA3AF", flexShrink: 0 }}>
                        {new Date(m.start_datetime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!hasRange && (
              <p style={{ fontSize: 11, color: "#9CA3AF", margin: 0 }}>Set a date range in the inspector, then fetch meetings.</p>
            )}
          </div>
        );
      }

      default:
        return <div className="text-xs text-[var(--twilio-gray-40)] p-2">[{node.type}]</div>;
    }
  };

  return (
    <ResizableWrapper
      width={p.width as number | undefined}
      height={p.height as number | undefined}
      x={p.x as number | undefined}
      y={p.y as number | undefined}
      isSelected={isSelected}
      onResizeLive={(w, h, nx, ny) => onResizeLive(node.id, w, h, nx, ny)}
      onResizeCommit={(w, h, nx, ny) => onResizeCommit(node.id, w, h, nx, ny)}
    >
      <div className={outerClasses} onClick={(e) => { e.stopPropagation(); onSelect(node.id, e.shiftKey); }}>
        <button
          className={`card-btn absolute -top-4 -right-4 z-30 h-6 w-6 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none items-center justify-center shadow-md ${
            isSelected ? "flex" : "hidden group-hover/node:flex"
          }`}
          onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
          title="Remove"
        >
          ✕
        </button>
        {renderContent()}
      </div>
    </ResizableWrapper>
  );
}
