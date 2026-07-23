import { useEffect, useRef } from "react";

const AGENTPM_TYPES = new Set([
  "ActionItemCard",
  "AccountCard",
  "ReminderCard",
  "CalendarEventCard",
  "TeamMemberCard",
]);

interface Props {
  x: number;
  y: number;
  nodeId: string;
  nodeType: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCopy: (id: string) => void;
  onSaveVariant: (nodeId: string) => void;
}

export default function CanvasContextMenu({
  x, y, nodeId, nodeType, onClose, onDelete, onDuplicate, onCopy, onSaveVariant,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  const btnStyle: React.CSSProperties = {
    padding: "6px 14px",
    fontSize: 12,
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "block",
    color: "#374151",
  };

  const dividerStyle: React.CSSProperties = {
    height: 1,
    background: "#E5E7EB",
    margin: "2px 0",
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: "#fff",
        borderRadius: 8,
        border: "1px solid #E5E7EB",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        minWidth: 180,
        overflow: "hidden",
        zIndex: 9999,
      }}
    >
      <button
        style={btnStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F4F6")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={() => onDuplicate(nodeId)}
      >
        ⧉ Duplicate <span style={{ float: "right", opacity: 0.5, fontSize: 11 }}>⌘D</span>
      </button>
      <button
        style={btnStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F4F6")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={() => onCopy(nodeId)}
      >
        ⎘ Copy <span style={{ float: "right", opacity: 0.5, fontSize: 11 }}>⌘C</span>
      </button>
      <div style={dividerStyle} />
      <button
        style={{ ...btnStyle, color: "#EF4444" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#FEF2F2")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={() => onDelete(nodeId)}
      >
        ✕ Delete <span style={{ float: "right", opacity: 0.5, fontSize: 11 }}>⌫</span>
      </button>
      {AGENTPM_TYPES.has(nodeType) && (
        <>
          <div style={dividerStyle} />
          <button
            style={btnStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F4F6")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => onSaveVariant(nodeId)}
          >
            📌 Save as variant…
          </button>
        </>
      )}
    </div>
  );
}
