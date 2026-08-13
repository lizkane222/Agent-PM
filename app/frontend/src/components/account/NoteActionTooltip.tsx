import { useState, useRef } from "react";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { airtableApi, schedulerApi } from "../../lib/api";
import type { AirtableActionItem, TeamMember } from "../../types";

export function NoteActionTooltip({ kind, noteText, eventId, accountName, airtableAccountId, linkedMeetingId, mentionedMembers, anchorY, onDone, onCreated, onClose }: {
  kind: "action" | "reminder" | "calendar";
  noteText: string;
  eventId: number;
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
  const [remDate, setRemDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); });
  const [remTime, setRemTime] = useState("09:00");
  const tooltipElRef = useRef<HTMLDivElement>(null);
  const [openUpward] = useState(() => anchorY != null ? anchorY > window.innerHeight - 300 : false);
  const [calTitle, setCalTitle] = useState(noteText.slice(0, 80));
  const [calStart, setCalStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10,0,0,0); return d.toISOString().slice(0,16); });
  const [calEnd, setCalEnd] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11,0,0,0); return d.toISOString().slice(0,16); });
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
      } as Parameters<typeof airtableApi.createActionItem>[0]);
      onCreated?.(data);
      // Signal ActionItemsPage to reload so zone placement picks up account_name
      localStorage.setItem("actionItemsUpdated", String(Date.now()));
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
    } else if (kind === "reminder") {
      await schedulerApi.createReminder({ title: stripped.slice(0, 200) || "Note reminder", body: noteText, resource_type: "calendar_event", resource_id: eventId, due_at: new Date(`${remDate}T${remTime}:00`).toISOString(), notify_in_app: true } as Parameters<typeof schedulerApi.createReminder>[0]);
    } else {
      await schedulerApi.createEvent({ title: calTitle, description: `From meeting note: ${noteText}`, start_datetime: new Date(calStart).toISOString(), end_datetime: new Date(calEnd).toISOString() } as Parameters<typeof schedulerApi.createEvent>[0]);
    }
    setDone(true);
    onDone?.(kind);
    setTimeout(onClose, 1200);
  }

  const label = kind === "action" ? "Create Action Item" : kind === "reminder" ? "Set Reminder" : "Create Meeting";

  return (
    <div ref={tooltipElRef} style={{ position: "absolute", right: 0, ...(openUpward ? { bottom: "100%", marginBottom: "4px" } : { top: "100%", marginTop: "4px" }), zIndex: 9999, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "10px 12px", width: "240px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b7280", margin: 0 }}>{label}</p>
      <div style={{ fontSize: "0.75rem", background: "#f9fafb", borderRadius: "5px", padding: "4px 7px", color: "#374151", lineHeight: 1.4, maxHeight: "40px", overflow: "hidden" }}>{stripped}</div>
      {kind === "action" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Priority</p>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }}>
              {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Due date</p>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} />
          </div>
        </div>
      )}
      {kind === "reminder" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Date</p><input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Time</p><input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
        </div>
      )}
      {kind === "calendar" && (
        <>
          <div><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Title</p><input value={calTitle} onChange={(e) => setCalTitle(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: "6px" }}>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>Start</p><input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "#9ca3af", marginBottom: "3px" }}>End</p><input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid #e5e7eb", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          </div>
        </>
      )}
      <button onClick={() => void submit()} style={{ padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: done ? "#10b981" : "#6366f1", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}>
        {done ? "✓ Done" : label}
      </button>
    </div>
  );
}
