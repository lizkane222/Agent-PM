import { useState } from "react";

interface Props {
  nodeId: string;
  baseType: string;
  onSave: (name: string, scope: "me" | "all") => void;
  onClose: () => void;
}

export default function SaveVariantModal({ baseType, onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"me" | "all">("me");

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, scope);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #E5E7EB",
          boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
          padding: "24px",
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#121C2D", margin: 0 }}>
            Save variant
          </p>
          <p style={{ fontSize: 11, color: "#6B7280", margin: "4px 0 0 0" }}>
            {baseType} · Give it a name
          </p>
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          placeholder="e.g. Urgent Red"
          autoFocus
          style={{
            padding: "8px 10px",
            fontSize: 13,
            border: "1px solid #D1D5DB",
            borderRadius: 6,
            outline: "none",
            width: "100%",
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          {(["me", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                flex: 1,
                padding: "6px 0",
                fontSize: 12,
                fontWeight: scope === s ? 700 : 400,
                border: `1.5px solid ${scope === s ? "#0263E0" : "#D1D5DB"}`,
                borderRadius: 6,
                background: scope === s ? "#EFF6FF" : "#fff",
                color: scope === s ? "#0263E0" : "#374151",
                cursor: "pointer",
              }}
            >
              {s === "me" ? "Just for me" : "Save for everyone"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              background: "#fff",
              color: "#374151",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            style={{
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 600,
              border: "none",
              borderRadius: 6,
              background: name.trim() ? "#0263E0" : "#D1D5DB",
              color: "#fff",
              cursor: name.trim() ? "pointer" : "not-allowed",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
