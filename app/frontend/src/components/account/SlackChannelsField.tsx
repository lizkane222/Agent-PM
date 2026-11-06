import { useState } from "react";
import type { SlackChannel, SlackChannelType } from "../../types/accounts";

const TYPE_META: Record<SlackChannelType, { badge: string; label: string; bg: string; fg: string }> = {
  customer_facing: { badge: "C#", label: "Customer Facing", bg: "rgba(2,99,224,0.12)", fg: "#0263E0" },
  account_team: { badge: "A#", label: "Account Team", bg: "rgba(124,58,237,0.12)", fg: "#6d28d9" },
};

const EMPTY: SlackChannel = { workspace: "", channel: "", url: "", type: "customer_facing" };
const inputCls = "w-full text-xs rounded border border-red-300 px-1.5 py-1 focus:outline-none focus:border-red-400";

function isHttpUrl(v: string): boolean {
  try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; }
}

function ChannelBadge({ entry }: { entry: SlackChannel }) {
  const meta = TYPE_META[entry.type] ?? TYPE_META.customer_facing;
  return (
    <span className="relative inline-block group/badge">
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${meta.label}: open #${entry.channel} in ${entry.workspace}`}
        className="text-[10px] font-bold px-1 py-0.5 rounded"
        style={{ background: meta.bg, color: meta.fg }}
      >{meta.badge}</a>
      {/* Hover/focus tooltip: full type label + the channel link. */}
      <span
        role="tooltip"
        className="hidden group-hover/badge:block group-focus-within/badge:block absolute left-0 top-full z-20 mt-0.5 w-44 rounded border bg-white p-1.5 text-[11px] shadow-md"
        style={{ borderColor: "var(--border, rgba(0,0,0,0.12))" }}
      >
        <span className="block font-semibold text-[var(--twilio-navy)]">{meta.label}</span>
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color: "var(--twilio-red, #e22)" }}>
          Open #{entry.channel}
        </a>
      </span>
    </span>
  );
}

function ChannelForm({ initial, onSave, onCancel }: {
  initial: SlackChannel; onSave: (c: SlackChannel) => Promise<void>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SlackChannel>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof SlackChannel>(k: K, v: SlackChannel[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function submit() {
    const next = { ...draft, workspace: draft.workspace.trim(), channel: draft.channel.trim().replace(/^#+/, "").trim(), url: draft.url.trim() };
    if (!next.workspace || !next.channel) { setError("Workspace and channel are required."); return; }
    if (!isHttpUrl(next.url)) { setError("URL must start with http:// or https://"); return; }
    setBusy(true); setError("");
    try { await onSave(next); } catch { setError("Could not save."); setBusy(false); }
  }

  return (
    <div data-testid="slack-channel-form" className="space-y-1 rounded border p-1.5" style={{ borderColor: "var(--border, rgba(0,0,0,0.12))" }}>
      <input className={inputCls} aria-label="Slack workspace" placeholder="Workspace" value={draft.workspace} onChange={(e) => set("workspace", e.target.value)} />
      <input className={inputCls} aria-label="Slack channel" placeholder="#channel" value={draft.channel} onChange={(e) => set("channel", e.target.value)} />
      <input className={inputCls} aria-label="Slack channel URL" placeholder="https://…" value={draft.url} onChange={(e) => set("url", e.target.value)} />
      <select className={inputCls} aria-label="Slack channel type" value={draft.type} onChange={(e) => set("type", e.target.value as SlackChannelType)}>
        <option value="customer_facing">Customer Facing (C#)</option>
        <option value="account_team">Account Team (A#)</option>
      </select>
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2 text-[11px]">
        <button type="button" disabled={busy} onClick={() => void submit()} className="font-semibold" style={{ color: "var(--twilio-red, #e22)" }}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={{ color: "var(--twilio-gray-60)" }}>Cancel</button>
      </div>
    </div>
  );
}

/** Sidebar "Slack # Channels": a bulleted list of `<workspace> · #channel` with a C#/A# badge. */
export default function SlackChannelsField({ channels, onChange }: {
  channels: SlackChannel[];
  /** Persist the full next list; reject to keep the form open. */
  onChange: (next: SlackChannel[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);

  async function save(index: number | "new", entry: SlackChannel) {
    const next = index === "new" ? [...channels, entry] : channels.map((c, i) => (i === index ? entry : c));
    await onChange(next);
    setEditing(null);
  }

  return (
    <div>
      <p className="text-[11px] text-[var(--twilio-gray-60)] uppercase tracking-wide mb-0.5">Slack # Channels</p>
      {channels.length === 0 && editing !== "new" && (
        <span style={{ color: "var(--twilio-gray-60)", fontStyle: "italic", fontSize: "0.75rem" }}>—</span>
      )}
      <ul className="list-disc pl-4 space-y-1">
        {channels.map((c, i) => (
          <li key={`${c.url}-${i}`} className="text-xs">
            {editing === i ? (
              <ChannelForm initial={c} onSave={(e) => save(i, e)} onCancel={() => setEditing(null)} />
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1">
                <span data-testid="slack-channel-label">{c.workspace} · #{c.channel}</span>
                <ChannelBadge entry={c} />
                <button type="button" aria-label={`Edit #${c.channel}`} title="Edit" className="opacity-50 hover:opacity-100" onClick={() => setEditing(i)}>✎</button>
                <button
                  type="button"
                  aria-label={`Remove #${c.channel}`}
                  title="Remove"
                  className="opacity-50 hover:opacity-100"
                  onClick={() => void onChange(channels.filter((_, j) => j !== i)).catch(() => {})}
                >×</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? (
        <div className="mt-1"><ChannelForm initial={EMPTY} onSave={(e) => save("new", e)} onCancel={() => setEditing(null)} /></div>
      ) : (
        <button type="button" className="mt-1 text-[11px] underline" style={{ color: "var(--twilio-red, #e22)" }} onClick={() => setEditing("new")}>+ Add channel</button>
      )}
    </div>
  );
}
