import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ReminderSnoozeMenu, { type SnoozeRequest } from "./calendar/ReminderSnoozeMenu";
import type { AppNotification } from "../types/team";

/** How many alerts are drawn at once; the rest are counted, never dropped. */
const MAX_SHOWN = 5;

/**
 * A reminder that has fired, on screen. It stays until the user answers it: **Acknowledge** to
 * say they have seen it, or **Snooze** to be reminded again at another time. There is no
 * timeout and no close button — unlike a confirmation, a reminder is something to act on, and
 * one that vanishes by itself is how it gets missed. Someone notified through a teammate's
 * reminder can only acknowledge (it isn't theirs to reschedule).
 */
export default function ReminderAlertToast({
  alerts,
  onAcknowledge,
  onSnooze,
}: {
  alerts: AppNotification[];
  onAcknowledge: (id: number) => void;
  onSnooze: (n: AppNotification, request: SnoozeRequest) => Promise<string | null>;
}) {
  const navigate = useNavigate();
  const [snoozing, setSnoozing] = useState<number | null>(null);
  const [menuNow, setMenuNow] = useState(() => new Date());
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, MAX_SHOWN);
  const link = "bg-transparent border-0 cursor-pointer p-0 text-xs font-semibold";

  return (
    <div
      aria-label="Reminders"
      style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10000,
               display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}
    >
      {shown.map((n) => (
        <div
          key={n.id}
          role="alert"
          className="rounded-lg px-3 py-2.5 shadow-lg"
          style={{ background: "var(--surface-card)", border: "1.5px solid #f59e0b", minWidth: 320, maxWidth: 460, pointerEvents: "auto" }}
        >
          <p className="m-0 text-[13px] font-semibold">{n.title}</p>
          {n.body && <p className="m-0 mt-0.5 text-xs whitespace-pre-line">{n.body}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <button
              type="button" className={link} style={{ color: "var(--ink-green)" }}
              onClick={() => { setSnoozing(null); onAcknowledge(n.id); }}
            >Acknowledge</button>
            {n.can_snooze && (
              <button
                type="button" className={link} style={{ color: "#b45309" }} aria-expanded={snoozing === n.id}
                onClick={() => { setMenuNow(new Date()); setSnoozing(snoozing === n.id ? null : n.id); }}
              >Snooze</button>
            )}
            {n.link && (
              <button type="button" className={link} style={{ color: "var(--text-gray-500)" }} onClick={() => navigate(n.link)}>View</button>
            )}
          </div>
          {snoozing === n.id && n.can_snooze && (
            <ReminderSnoozeMenu
              now={menuNow}
              hasAccount
              accent="#f59e0b"
              onClose={() => setSnoozing(null)}
              onSnooze={async (request) => {
                const message = await onSnooze(n, request);
                if (!message) setSnoozing(null);
                return message;
              }}
            />
          )}
        </div>
      ))}
      {alerts.length > MAX_SHOWN && (
        <p className="m-0 text-center text-xs font-semibold" style={{ color: "#b45309", pointerEvents: "auto" }}>
          + {alerts.length - MAX_SHOWN} more waiting
        </p>
      )}
    </div>
  );
}
