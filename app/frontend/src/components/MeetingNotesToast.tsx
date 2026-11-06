import { useEffect } from "react";
import type { MeetingNotesNotification } from "../hooks/useMeetingNotesAutoCheck";

const AUTO_DISMISS_MS = 8_000;

function Toast({ n, onDismiss }: { n: MeetingNotesNotification; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg px-3 py-2.5 shadow-lg"
      style={{ background: "var(--bg-card, #fff)", border: "1.5px solid #16a34a", minWidth: 280, maxWidth: 360, pointerEvents: "auto" }}
    >
      <span aria-hidden="true" style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
      <div className="flex-1 min-w-0">
        <p className="m-0 text-[13px] font-semibold">
          {n.metadata.kind === "recording" ? "Recording link added" : "Meeting notes added"}
        </p>
        <p className="m-0 mt-0.5 text-xs truncate" title={n.title}>
          {n.title}
          {n.metadata.account_name ? ` · ${n.metadata.account_name}` : ""}
        </p>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss notification" style={{ background: "none", border: "none", cursor: "pointer" }}>
        ×
      </button>
    </div>
  );
}

export default function MeetingNotesToast({
  notifications,
  onDismiss,
}: {
  notifications: MeetingNotesNotification[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;
  return (
    <div
      aria-label="Meeting notes notifications"
      style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}
    >
      {notifications.map((n) => (
        <Toast key={n.id} n={n} onDismiss={() => onDismiss(n.id)} />
      ))}
    </div>
  );
}
