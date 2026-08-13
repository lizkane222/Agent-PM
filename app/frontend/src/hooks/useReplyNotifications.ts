import { useCallback, useEffect, useRef, useState } from "react";
import { realtimeApi } from "../lib/api";
import { addBackendLog } from "../lib/appLog";

export interface ReplyNotification {
  id: number;
  title: string;
  metadata: {
    resource_type: string;
    resource_id: number;
    resource_label: string;
    reply_id: number;
    parent_id: number;
  };
  created_at: string;
}

const POLL_INTERVAL_MS = 45_000;
const LAST_POLL_KEY = "replyNotificationsLastPoll";

// Use "now" as the initial since-value so the first poll returns 0 events.
// Toasts are for live notifications only; historical replies surface via the
// activity log through syncLogsFromBackend().
function getLastPoll(): string {
  return localStorage.getItem(LAST_POLL_KEY) ?? new Date().toISOString();
}

function setLastPoll(iso: string): void {
  localStorage.setItem(LAST_POLL_KEY, iso);
}

export function useReplyNotifications(): {
  pending: ReplyNotification[];
  dismiss: (id: number) => void;
} {
  const [pending, setPending] = useState<ReplyNotification[]>([]);
  const lastPollRef = useRef<string>(getLastPoll());

  const poll = useCallback(async () => {
    const since = lastPollRef.current;
    // Advance lastPoll immediately so parallel polls can't double-fire
    const pollTime = new Date().toISOString();
    lastPollRef.current = pollTime;
    setLastPoll(pollTime);

    try {
      const resp = await realtimeApi.listActivity({
        event_type: "comment_reply",
        since,
      });
      // Client-side guard: only process genuine reply notifications even if the
      // backend filter fails to apply (e.g. server not yet restarted).
      const events = (resp.data.results ?? []).filter(
        (ev) => ev.event_type === "comment_reply"
      );
      if (events.length === 0) return;

      const notifications: ReplyNotification[] = events.map((ev) => ({
        id: ev.id,
        title: ev.title,
        metadata: ev.metadata as ReplyNotification["metadata"],
        created_at: ev.created_at,
      }));

      // Write to the activity log (deduplicated; no second backend call)
      for (const n of notifications) {
        addBackendLog({
          id: `reply-${n.id}`,
          ts: new Date(n.created_at).getTime(),
          category: "comment_reply",
          message: n.title,
        });
      }

      setPending((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const fresh = notifications.filter((n) => !existingIds.has(n.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    } catch {
      // Network errors during polling are silent — never block the UI
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const dismiss = useCallback((id: number) => {
    setPending((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { pending, dismiss };
}
