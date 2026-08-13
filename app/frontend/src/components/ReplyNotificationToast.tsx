import { useEffect, useRef } from "react";
import type { ReplyNotification } from "../hooks/useReplyNotifications";

interface Props {
  notifications: ReplyNotification[];
  onDismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 6_000;

function Toast({
  notification,
  onDismiss,
}: {
  notification: ReplyNotification;
  onDismiss: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        background: "var(--bg-card, #fff)",
        border: "1.5px solid #DB132A",
        borderRadius: "10px",
        boxShadow: "0 4px 18px rgba(0,0,0,0.13)",
        padding: "12px 14px",
        minWidth: "280px",
        maxWidth: "360px",
        pointerEvents: "auto",
        animation: "replyToastIn 0.25s ease",
      }}
    >
      {/* Twilio-red accent dot */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          marginTop: "3px",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "#DB132A",
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--text-primary, #111)",
            lineHeight: 1.4,
          }}
        >
          New reply
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: "0.75rem",
            color: "var(--text-secondary, #555)",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={notification.title}
        >
          {notification.title}
        </p>
      </div>

      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          padding: "0 0 0 4px",
          cursor: "pointer",
          color: "var(--text-secondary, #888)",
          fontSize: "1rem",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

export default function ReplyNotificationToast({ notifications, onDismiss }: Props) {
  if (notifications.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes replyToastIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          top: "16px",
          right: "16px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: "none",
        }}
        aria-label="Reply notifications"
      >
        {notifications.map((n) => (
          <Toast key={n.id} notification={n} onDismiss={() => onDismiss(n.id)} />
        ))}
      </div>
    </>
  );
}
