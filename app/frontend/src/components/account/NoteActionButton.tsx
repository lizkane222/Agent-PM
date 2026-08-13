import React from "react";

export function NoteActionButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", color: danger ? "#9ca3af" : "#9ca3af", display: "flex", alignItems: "center" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = danger ? "#ef4444" : "var(--twilio-navy)"; (e.currentTarget as HTMLButtonElement).style.background = danger ? "#fef2f2" : "#f3f4f6"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}>
      {children}
    </button>
  );
}
