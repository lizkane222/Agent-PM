import React, { useState } from "react";
import { useExport, type ExportItem } from "../context/ExportContext";
import { addLog } from "../lib/appLog";

// Key used on dataTransfer so any drop target can read the item
export const EXPORT_ITEM_DRAG_KEY = "application/x-export-item";

interface DraggablePillProps {
  item: ExportItem;
  onRemove: (item: ExportItem) => void;
}

function DraggablePill({ item, onRemove }: DraggablePillProps) {
  const accentColor = item.accent || "#6366f1";
  const [dragging, setDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        setDragging(true);
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(EXPORT_ITEM_DRAG_KEY, JSON.stringify(item));
      }}
      onDragEnd={() => setDragging(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px 3px 6px",
        borderRadius: 99,
        background: "rgba(255,255,255,0.15)",
        border: "1px solid rgba(255,255,255,0.25)",
        borderLeft: `3px solid ${accentColor}`,
        cursor: dragging ? "grabbing" : "grab",
        opacity: dragging ? 0.5 : 1,
        fontSize: "0.75rem",
        fontFamily: "var(--font-base)",
        color: "#fff",
        whiteSpace: "nowrap",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.label}
      </span>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(item); }}
        title={`Remove ${item.label}`}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, borderRadius: "50%",
          background: "rgba(255,255,255,0.2)", border: "none", cursor: "pointer",
          color: "#fff", fontSize: "9px", padding: 0, flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

export default function ExportBar() {
  const { items, clearItems, toggleItem } = useExport();

  if (items.length === 0) return null;

  function handleSendToChat() {
    const text = [
      "I've selected the following content to export. Please ask me how I'd like to compile it:\n",
      ...items.map((item) => `## ${item.label} (${item.type})\n${item.content}`),
    ].join("\n\n---\n\n");

    const actionItems = items.filter((i) => i.type === "action_item");
    actionItems.forEach((exportItem) => {
      const airtableId = exportItem.id.replace(/^action_item:/, "");
      addLog({
        category: "action_item",
        message: `"${exportItem.label}" exported to chat`,
        links: [{ label: "View agent", path: "/agent" }],
        resource: { type: "action_item", id: airtableId },
      });
    });

    window.dispatchEvent(new CustomEvent("export-to-chat", { detail: { text } }));
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(219, 19, 26, 0.92)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.15)",
        minHeight: 44,
      }}
    >
      {/* Left: count chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          minWidth: 22, height: 22, borderRadius: 99,
          background: "rgba(255,255,255,0.25)", color: "#fff",
          fontSize: "0.6875rem", fontWeight: 700, padding: "0 5px",
        }}>
          {items.length}
        </span>
        <span style={{
          fontSize: "0.75rem", color: "rgba(255,255,255,0.85)",
          fontFamily: "var(--font-base)", whiteSpace: "nowrap",
        }}>
          items in export tray
        </span>
      </div>

      {/* Middle: scrollable pill row */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", gap: 6,
        overflowX: "auto", minWidth: 0,
        scrollbarWidth: "none",
        msOverflowStyle: "none" as React.CSSProperties["msOverflowStyle"],
      }}
        className="hide-scrollbar"
      >
        {items.map((item) => (
          <DraggablePill key={item.id} item={item} onRemove={toggleItem} />
        ))}
      </div>

      {/* Right: action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button
          onClick={handleSendToChat}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "5px 12px", borderRadius: 6,
            background: "rgba(255,255,255,0.2)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.35)", cursor: "pointer",
            fontSize: "0.75rem", fontWeight: 600, fontFamily: "var(--font-base)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.3)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Send to Chat
        </button>
        <button
          onClick={clearItems}
          style={{
            display: "flex", alignItems: "center",
            padding: "5px 10px", borderRadius: 6,
            background: "transparent", color: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer",
            fontSize: "0.75rem", fontFamily: "var(--font-base)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
