/**
 * AgentFeed — real-time list of agent actions powered by Twilio Sync.
 *
 * Subscribes to the Sync list named "agent-feed" and re-renders whenever
 * a new item is appended by the backend.
 */

import { useSyncList } from "../lib/sync";
import type { AgentActivityEvent } from "../types";

// Color scheme keyed on the verb prefix extracted from the title
const VERB_COLORS: Record<string, string> = {
  Created:   "bg-emerald-100 text-emerald-700",
  Updated:   "bg-blue-100 text-blue-700",
  Deleted:   "bg-red-100 text-red-600",
  Dismissed: "bg-gray-100 text-gray-600",
  Snoozed:   "bg-amber-100 text-amber-700",
  Synced:    "bg-cyan-100 text-cyan-700",
};

// Fallback colors for non-CRUD event types that don't use the **Verb** format
const EVENT_TYPE_COLORS: Record<string, string> = {
  tool_call:       "bg-blue-100 text-blue-700",
  tool_result:     "bg-green-100 text-green-700",
  message:         "bg-gray-100 text-[var(--twilio-gray-80)]",
  error:           "bg-red-100 text-red-700",
  voice_transcript:"bg-purple-100 text-purple-700",
};

/** Extract "**Verb**" from titles like "**Created** Account" → "Created" */
function extractVerb(title: string): string | null {
  const m = title.match(/^\*\*([^*]+)\*\*/);
  return m ? m[1] : null;
}

/** Render a title that may contain **bold** markers as React nodes */
function RichTitle({ title }: { title: string }) {
  const parts = title.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function EventBadge({ type, title }: { type: string; title: string }) {
  const verb = extractVerb(title);
  const color = verb
    ? (VERB_COLORS[verb] ?? "bg-gray-100 text-[var(--twilio-gray-80)]")
    : (EVENT_TYPE_COLORS[type] ?? "bg-gray-100 text-[var(--twilio-gray-80)]");
  const label = verb ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${color}`}>
      {label}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AgentFeed() {
  const { items, isLoading, error } = useSyncList<AgentActivityEvent>("agent-feed", 50);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-[var(--twilio-navy)]">
        Connecting to live feed…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-red-500">
        Unable to connect: {error.message}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-[var(--twilio-navy)]">
        No activity yet. Start a conversation to see the agent in action.
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="divide-y divide-gray-100">
        {[...items].reverse().map((event) => (
          <li key={event.id ?? event.created_at} className="py-3 flex gap-3 items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <EventBadge type={event.event_type} title={event.title} />
                <p className="text-sm text-[var(--twilio-navy)] truncate">
                  <RichTitle title={event.title} />
                </p>
              </div>
              {event.detail && (
                <p className="mt-0.5 text-xs text-[var(--twilio-gray-60)] line-clamp-2">{event.detail}</p>
              )}
            </div>
            <time
              className="shrink-0 text-xs text-[var(--twilio-gray-40)] tabular-nums"
              dateTime={event.created_at}
            >
              {formatRelativeTime(event.created_at)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
