import { useState } from "react";
import { Link } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import HorizontalScroller from "./HorizontalScroller";
import type { NotificationChannel } from "../../types/team";

const CHANNELS: { id: "" | NotificationChannel; label: string }[] = [
  { id: "", label: "All" },
  { id: "in_app", label: "In app" },
  { id: "push", label: "Push" },
  { id: "slack", label: "Slack" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.filter((c) => c.id).map((c) => [c.id, c.label]));

export default function NotificationsSection({ accent }: { accent?: { border: string; bg: string; text: string } }) {
  const [channel, setChannel] = useState<"" | NotificationChannel>("");
  const { data, loading, error, markRead } = useNotifications({ channel: channel || undefined });
  const unread = data.filter((n) => !n.read_at).length;
  const border = accent?.border ?? "#0d1b2e";

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {CHANNELS.map((c) => (
          <button
            key={c.id || "all"}
            onClick={() => setChannel(c.id)}
            aria-pressed={channel === c.id}
            style={{ padding: "3px 10px", borderRadius: 14, fontSize: "0.75rem", cursor: "pointer", border: `1px solid ${channel === c.id ? border : "var(--border, rgba(0,0,0,0.12))"}`, background: channel === c.id ? (accent?.bg ?? "#eef") : "#fff", color: channel === c.id ? (accent?.text ?? "#111") : "var(--text-secondary, #666)", fontWeight: 600 }}
          >{c.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {unread > 0 && (
          <button onClick={() => void markRead()} style={{ background: "none", border: "none", cursor: "pointer", color: border, fontSize: "0.75rem", fontWeight: 600 }}>
            Mark {unread} as read
          </button>
        )}
      </div>

      {loading && <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>Loading notifications…</p>}
      {error && <p style={{ fontSize: "0.8125rem", color: "#b91c1c" }}>Could not load notifications.</p>}
      {!loading && !error && data.length === 0 && (
        <div style={{ padding: "16px 20px", borderRadius: 10, border: "1.5px dashed var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
          No notifications{channel ? ` on ${CHANNEL_LABEL[channel]}` : ""} yet.
        </div>
      )}

      {data.length > 0 && (
        <HorizontalScroller label="Notifications">
          {data.map((n) => {
            const row = (
              <div style={{ width: 260, flex: 1, boxSizing: "border-box", display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
                <span aria-label={n.read_at ? "Read" : "Unread"} style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0, background: n.read_at ? "transparent" : border }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: n.read_at ? 500 : 700, color: "var(--text-primary, #111)", overflowWrap: "anywhere" }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary, #666)", marginTop: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflowWrap: "anywhere" }}>{n.body}</div>}
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #999)", marginTop: 6 }}>
                    {CHANNEL_LABEL[n.channel] ?? n.channel}
                    {n.status !== "sent" && ` · ${n.status}`}
                    {" · "}{new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            );
            const card = n.link.startsWith("/")
              ? <Link key={n.id} to={n.link} style={{ textDecoration: "none", flexShrink: 0, display: "flex" }}>{row}</Link>
              : <div key={n.id} style={{ flexShrink: 0, display: "flex" }}>{row}</div>;
            return card;
          })}
        </HorizontalScroller>
      )}
    </div>
  );
}
