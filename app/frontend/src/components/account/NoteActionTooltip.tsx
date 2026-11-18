import { useState, useRef } from "react";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { airtableApi, schedulerApi } from "../../lib/api";
import type { AirtableActionItem, CommentReference, TeamMember } from "../../types";

import { localDateKey } from "../../lib/timelineDay";
import { toLocalDatetimeValue } from "../../lib/datetimeLocal";
/**
 * Where a note or comment came from when it is not a meeting: today, an artifact. The new
 * action item / reminder / meeting says so ("From artifact: …") and links back to it.
 */
export interface NoteSource {
  resourceType: "artifact";
  resourceId: number;
  label: string;
  /** Where the artifact lives (its file or link URL); lets an action item attach it. */
  url?: string | null;
  /** accounts.Account id of the artifact, so a new meeting is filed under it. */
  accountId?: number | null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function NoteActionTooltip({ kind, noteText, eventId, source, onLinked, accountName, airtableAccountId, linkedMeetingId, mentionedMembers, anchorY, onDone, onCreated, onClose }: {
  kind: "action" | "reminder" | "calendar";
  noteText: string;
  eventId?: number;
  source?: NoteSource;
  /** Called with a record the action just linked to `source` (so the sidebar can list it). */
  onLinked?: (ref: CommentReference) => void;
  accountName?: string | null;
  airtableAccountId?: number | null;
  linkedMeetingId?: number;
  mentionedMembers?: TeamMember[];
  anchorY?: number;
  onDone?: (kind: "action" | "reminder" | "calendar") => void;
  onCreated?: (item: AirtableActionItem) => void;
  onClose: () => void;
}) {
  const currentUser = useCurrentUser();
  const [priority, setPriority] = useState<"Low"|"Medium"|"High"|"Critical">("Medium");
  const [due, setDue] = useState("");
  const [remDate, setRemDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateKey(d); });
  const [remTime, setRemTime] = useState("09:00");
  const tooltipElRef = useRef<HTMLDivElement>(null);
  const [openUpward] = useState(() => anchorY != null ? anchorY > window.innerHeight - 300 : false);
  const [calTitle, setCalTitle] = useState(noteText.slice(0, 80));
  const [calStart, setCalStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10,0,0,0); return toLocalDatetimeValue(d.toISOString()); });
  const [calEnd, setCalEnd] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11,0,0,0); return toLocalDatetimeValue(d.toISOString()); });
  const [done, setDone] = useState(false);

  const stripped = noteText.replace(/@\S+/g, "").trim();
  // Use first mentioned member as assignee, fall back to current user
  const assignee = mentionedMembers?.[0];

  async function submit() {
    if (kind === "action") {
      const { data } = await airtableApi.createActionItem({
        task: stripped, status: "Open", priority, due_date: due || null,
        account: airtableAccountId ?? undefined,
        account_name: accountName ?? undefined,
        assignee_name: assignee?.full_name || currentUser?.display_name || "",
        assignee_airtable_id: assignee ? String(assignee.id) : currentUser?.airtable_collaborator_id || "",
        linked_meeting: linkedMeetingId ?? null,
        ...(source ? {
          task_details: `<p>From artifact: ${escapeHtml(source.label)}</p>`,
          references: [{
            resource_type: source.resourceType, resource_id: source.resourceId, label: source.label,
            url: source.accountId ? `/accounts/${source.accountId}` : "/accounts",
          }],
        } : {}),
      } as Parameters<typeof airtableApi.createActionItem>[0]);
      if (source?.url) {
        // Attach the artifact itself so it reports where it is used. The item already exists, so
        // a failure here must not undo or hide it.
        try { await airtableApi.addAttachmentLink(data.id, source.label, source.url, source.resourceId); } catch { /* best effort */ }
      }
      if (source) onLinked?.({ resource_type: "action_item", resource_id: data.id, label: data.task || stripped, url: "/action-items" });
      onCreated?.(data);
      // Signal ActionItemsPage to reload so zone placement picks up account_name
      localStorage.setItem("actionItemsUpdated", String(Date.now()));
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
    } else if (kind === "reminder") {
      const title = stripped.slice(0, 200) || "Note reminder";
      const dueAt = new Date(`${remDate}T${remTime}:00`).toISOString();
      if (source) {
        const { data } = await schedulerApi.createReminder({
          title, body: `${noteText}\n\nFrom artifact: ${source.label}`, due_at: dueAt,
          links: [{ resource_type: source.resourceType, resource_id: source.resourceId, resource_label: source.label }],
        } as Parameters<typeof schedulerApi.createReminder>[0]);
        onLinked?.({ resource_type: "reminder", resource_id: data.id, label: title, url: "/reminders" });
      } else {
        await schedulerApi.createReminder({ title, body: noteText, resource_type: "calendar_event", resource_id: eventId, due_at: dueAt } as Parameters<typeof schedulerApi.createReminder>[0]);
      }
    } else {
      const { data } = await schedulerApi.createEvent({
        title: calTitle,
        description: source ? `From artifact: ${source.label}\n${noteText}` : `From meeting note: ${noteText}`,
        start_datetime: new Date(calStart).toISOString(), end_datetime: new Date(calEnd).toISOString(),
        ...(source ? { artifact_ids: [source.resourceId], account: source.accountId ?? undefined } : {}),
      } as Parameters<typeof schedulerApi.createEvent>[0]);
      if (source && source.accountId) onLinked?.({ resource_type: "calendar_event", resource_id: data.id, label: calTitle, url: "/calendar" });
    }
    setDone(true);
    onDone?.(kind);
    setTimeout(onClose, 1200);
  }

  const label = kind === "action" ? "Create Action Item" : kind === "reminder" ? "Set Reminder" : "Create Meeting";

  return (
    <div ref={tooltipElRef} style={{ position: "absolute", right: 0, ...(openUpward ? { bottom: "100%", marginBottom: "4px" } : { top: "100%", marginTop: "4px" }), zIndex: 9999, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "10px", padding: "10px 12px", width: "240px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-gray-500)", margin: 0 }}>{label}</p>
      <div style={{ fontSize: "0.75rem", background: "var(--surface-subtle)", borderRadius: "5px", padding: "4px 7px", color: "var(--text-gray-700)", lineHeight: 1.4, maxHeight: "40px", overflow: "hidden" }}>{stripped}</div>
      {kind === "action" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Priority</p>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }}>
              {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Due date</p>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} />
          </div>
        </div>
      )}
      {kind === "reminder" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Date</p><input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Time</p><input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
        </div>
      )}
      {kind === "calendar" && (
        <>
          <div><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Title</p><input value={calTitle} onChange={(e) => setCalTitle(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: "6px" }}>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Start</p><input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>End</p><input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          </div>
        </>
      )}
      <button onClick={() => void submit()} style={{ padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: done ? "#10b981" : "#6366f1", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}>
        {done ? "✓ Done" : label}
      </button>
    </div>
  );
}
