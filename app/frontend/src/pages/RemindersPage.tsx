import { useRef, useState } from "react";
import ScheduleIcon from "../assets/icons/Schedule.svg?react";
import { useNotificationDefaults } from "../context/NotificationDefaultsContext";
import type { ReminderResourceType } from "../types";
import { useExport, type ExportItem } from "../context/ExportContext";
import { useRightClickComment } from "../components/comments/CommentContext";
import CommentTrigger from "../components/comments/CommentTrigger";
import CommentPreviewList from "../components/comments/CommentPreviewList";
import { addLog } from "../lib/appLog";
import ActivityLogSection from "../components/ActivityLogSection";
import { useReminders } from "../hooks/useReminders";
import type { Reminder } from "../types/scheduler";

const CHANNEL_LABELS: { key: keyof Pick<Reminder, "notify_in_app" | "notify_slack" | "notify_push" | "notify_sms">; label: string }[] = [
  { key: "notify_in_app", label: "In-App" },
  { key: "notify_slack", label: "Slack" },
  { key: "notify_push", label: "Laptop" },
  { key: "notify_sms", label: "Phone" },
];

const RESOURCE_TYPES: { value: ReminderResourceType; label: string }[] = [
  { value: "general", label: "General" },
  { value: "account", label: "Account" },
  { value: "calendar_event", label: "Calendar Event" },
  { value: "action_item", label: "Action Item" },
  { value: "task", label: "Task" },
];

function statusColor(status: Reminder["status"]): string {
  if (status === "dismissed") return "rgba(0,0,0,0.25)";
  if (status === "sent") return "rgba(21,128,61,0.85)";
  if (status === "snoozed") return "rgba(217,119,6,0.85)";
  return "var(--twilio-red, #e22)";
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const absMin = Math.round(Math.abs(diff) / 60000);
  if (diff < 0 && absMin < 60) return `${absMin}m overdue`;
  if (diff < 0) return `${Math.round(absMin / 60)}h overdue`;
  if (absMin < 60) return `in ${absMin}m`;
  if (absMin < 1440) return `in ${Math.round(absMin / 60)}h`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const BLANK: Omit<Partial<Reminder>, "id" | "created_by" | "created_by_username" | "created_at" | "updated_at"> = {
  title: "",
  body: "",
  resource_type: "general",
  resource_id: null,
  resource_label: "",
  due_at: "",
  notify_in_app: true,
  notify_slack: false,
  notify_push: false,
  notify_sms: false,
};

function toLocalDatetimeValue(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeValue(val: string): string {
  if (!val) return "";
  return new Date(val).toISOString();
}

type FilterTab = "pending" | "all" | "dismissed";

export default function RemindersPage() {
  const [tab, setTab] = useState<FilterTab>("pending");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [voiceText, setVoiceText] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const { exportMode, toggleItem, isSelected } = useExport();
  const { defaults: notifDefaults, setDefaults: setNotifDefaults } = useNotificationDefaults();

  const { data: reminders, loading, createReminder, updateReminder, deleteReminder, dismissReminder } =
    useReminders({ tab });

  function openNew() {
    setEditId(null);
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const defaultDue = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
    setForm({
      ...BLANK,
      due_at: defaultDue,
      notify_in_app: notifDefaults.notify_default_in_app,
      notify_slack: notifDefaults.notify_default_slack,
      notify_push: notifDefaults.notify_default_push,
      notify_sms: notifDefaults.notify_default_sms,
    });
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  function openEdit(r: Reminder) {
    setEditId(r.id);
    setForm({
      title: r.title,
      body: r.body,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      resource_label: r.resource_label,
      due_at: toLocalDatetimeValue(r.due_at),
      notify_in_app: r.notify_in_app,
      notify_slack: r.notify_slack,
      notify_push: r.notify_push,
      notify_sms: r.notify_sms,
    });
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  async function save() {
    if (!form.title?.trim() || !form.due_at) return;
    setSaving(true);
    const payload = { ...form, due_at: fromLocalDatetimeValue(form.due_at as string) };
    try {
      if (editId !== null) {
        await updateReminder(editId, payload);
        addLog({
          category: "calendar",
          message: `Reminder "${form.title}" updated`,
          resource: { type: "reminder", id: editId },
        });
      } else {
        const data = await createReminder(payload as Parameters<typeof createReminder>[0]);
        addLog({
          category: "calendar",
          message: `Reminder "${data.title}" created`,
          resource: { type: "reminder", id: data.id },
        });
      }
      setShowForm(false);
      setEditId(null);
    } finally {
      setSaving(false);
    }
  }

  async function dismiss(id: number) {
    const rem = reminders.find((r) => r.id === id);
    await dismissReminder(id);
    if (rem) {
      addLog({
        category: "calendar",
        message: `Reminder "${rem.title}" dismissed`,
        resource: { type: "reminder", id: id },
      });
    }
  }

  async function del(id: number) {
    const rem = reminders.find((r) => r.id === id);
    await deleteReminder(id);
    if (rem) {
      addLog({
        category: "calendar",
        message: `Reminder "${rem.title}" deleted`,
        resource: { type: "reminder", id: id },
      });
    }
  }

  function parseVoice() {
    const text = voiceText.trim();
    if (!text) return;
    // Very simple NLP: extract time hints and set as title
    const lower = text.toLowerCase();
    let due = new Date(Date.now() + 60 * 60 * 1000);
    if (lower.includes("eod") || lower.includes("end of day")) {
      due = new Date(); due.setHours(17, 0, 0, 0);
      if (due < new Date()) due.setDate(due.getDate() + 1);
    } else if (lower.includes("tomorrow")) {
      due = new Date(); due.setDate(due.getDate() + 1); due.setHours(9, 0, 0, 0);
    } else if (lower.includes("1 hour") || lower.includes("in an hour")) {
      due = new Date(Date.now() + 60 * 60 * 1000);
    } else if (lower.includes("30 min")) {
      due = new Date(Date.now() + 30 * 60 * 1000);
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const dueVal = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
    setForm({
      ...BLANK,
      title: text,
      due_at: dueVal,
      notify_in_app: notifDefaults.notify_default_in_app,
      notify_slack: notifDefaults.notify_default_slack,
      notify_push: notifDefaults.notify_default_push,
      notify_sms: notifDefaults.notify_default_sms,
    });
    setVoiceText("");
    setEditId(null);
    setShowForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  const visible = tab === "all"
    ? reminders
    : tab === "pending"
      ? reminders.filter(r => r.status === "pending" || r.status === "snoozed")
      : reminders.filter(r => r.status === "dismissed");

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "var(--text-primary, #111)", display: "flex", alignItems: "center", gap: 8 }}><ScheduleIcon width={22} height={22} style={{ flexShrink: 0 }} />Reminders</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary, #888)", margin: "4px 0 0" }}>
            Stay on top of follow-ups and deadlines
          </p>
        </div>
        <button
          className="card-btn"
          onClick={openNew}
          style={{
            padding: "8px 18px",
            background: "var(--twilio-red, #e22)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          + New Reminder
        </button>
      </div>

      {/* Voice / chat input */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 20,
        background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
        borderRadius: 8, padding: "10px 14px",
      }}>
        <span style={{ fontSize: "1.125rem", lineHeight: 1 }}>💬</span>
        <input
          value={voiceText}
          onChange={e => setVoiceText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && parseVoice()}
          placeholder='Type a reminder, e.g. "remind me to review action items before EOD"'
          style={{
            flex: 1, border: "none", outline: "none", fontSize: "0.875rem",
            background: "transparent", color: "var(--text-primary, #111)",
          }}
        />
        {voiceText && (
          <button
            className="card-btn"
            onClick={parseVoice}
            style={{
              padding: "4px 12px", background: "var(--twilio-red, #e22)", color: "#fff",
              border: "none", borderRadius: 4, fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            Add
          </button>
        )}
      </div>

      {/* Notification defaults — inline, synced with Settings */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 16px",
        marginBottom: 20, padding: "10px 14px",
        background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
        borderRadius: 8,
      }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #9ca3af)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
          Default channels
        </span>
        {([
          { key: "notify_default_in_app", label: "In-App" },
          { key: "notify_default_slack", label: "Slack" },
          { key: "notify_default_push", label: "Laptop" },
          { key: "notify_default_sms", label: "Phone" },
        ] as const).map(ch => (
          <label key={ch.key} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: "0.8125rem", color: "var(--text-primary, #111)", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={notifDefaults[ch.key]}
              onChange={e => setNotifDefaults({ [ch.key]: e.target.checked })}
              style={{ width: 14, height: 14, accentColor: "var(--twilio-red, #DB131A)", cursor: "pointer" }}
            />
            {ch.label}
          </label>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {(["pending", "all", "dismissed"] as FilterTab[]).map(t => (
          <button
            key={t}
            className="card-btn"
            onClick={() => setTab(t)}
            style={{
              padding: "6px 14px", borderRadius: 4, border: "1px solid",
              borderColor: tab === t ? "var(--twilio-red, #e22)" : "var(--border, rgba(0,0,0,0.1))",
              background: tab === t ? "var(--twilio-red, #e22)" : "var(--surface, #fff)",
              color: tab === t ? "#fff" : "var(--text-secondary, #888)",
              fontSize: "0.8125rem", fontWeight: tab === t ? 600 : 400, cursor: "pointer",
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{
          background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.1))",
          borderRadius: 8, padding: 20, marginBottom: 24,
        }}>
          <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 600 }}>
            {editId ? "Edit Reminder" : "New Reminder"}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              ref={titleRef}
              value={form.title as string}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Reminder title *"
              style={inputStyle}
            />
            <textarea
              value={form.body as string}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Additional notes (optional)"
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={labelStyle}>Due date & time *</label>
                <input
                  type="datetime-local"
                  value={form.due_at as string}
                  onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={labelStyle}>Link to resource</label>
                <select
                  value={form.resource_type as string}
                  onChange={e => setForm(f => ({ ...f, resource_type: e.target.value as ReminderResourceType }))}
                  style={inputStyle}
                >
                  {RESOURCE_TYPES.map(rt => (
                    <option key={rt.value} value={rt.value}>{rt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {form.resource_type !== "general" && (
              <input
                value={form.resource_label as string}
                onChange={e => setForm(f => ({ ...f, resource_label: e.target.value }))}
                placeholder="Resource name (e.g. account or meeting name)"
                style={inputStyle}
              />
            )}
            <div>
              <label style={{ ...labelStyle, display: "block", marginBottom: 8 }}>Notify via</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {CHANNEL_LABELS.map(ch => (
                  <label key={ch.key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.875rem" }}>
                    <input
                      type="checkbox"
                      checked={form[ch.key] as boolean}
                      onChange={e => setForm(f => ({ ...f, [ch.key]: e.target.checked }))}
                    />
                    {ch.label}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                className="card-btn"
                onClick={() => { setShowForm(false); setEditId(null); }}
                style={{ ...ghostBtn }}
              >
                Cancel
              </button>
              <button
                className="card-btn"
                onClick={save}
                disabled={saving || !form.title?.toString().trim() || !form.due_at}
                style={{
                  padding: "7px 18px", background: "var(--twilio-red, #e22)", color: "#fff",
                  border: "none", borderRadius: 6, fontWeight: 600, fontSize: "0.875rem",
                  cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : editId ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p style={{ color: "var(--text-secondary, #888)", fontSize: "0.875rem" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-secondary, #888)" }}>
          <div style={{ fontSize: "2rem", marginBottom: 10 }}>🔔</div>
          <p style={{ fontSize: 15 }}>No {tab === "all" ? "" : tab + " "}reminders</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map(r => (
            <ReminderRow
              key={r.id}
              r={r}
              exportMode={exportMode}
              isSelected={isSelected}
              toggleItem={toggleItem}
              openEdit={openEdit}
              dismiss={dismiss}
              del={del}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderRow({
  r,
  exportMode,
  isSelected,
  toggleItem,
  openEdit,
  dismiss,
  del,
}: {
  r: Reminder;
  exportMode: boolean;
  isSelected: (key: string) => boolean;
  toggleItem: (item: ExportItem) => void;
  openEdit: (r: Reminder) => void;
  dismiss: (id: number) => void;
  del: (id: number) => void;
}) {
  const exportKey = `reminder:${r.id}`;
  const sel = exportMode && isSelected(exportKey);
  const { onContextMenu } = useRightClickComment("reminder", r.id, r.title);

  return (
            <div
              onClick={exportMode ? () => toggleItem({
                id: exportKey,
                type: "reminder",
                label: r.title,
                summary: `${r.status} · Due: ${r.due_at}`,
                content: `Reminder: ${r.title}\nStatus: ${r.status}\nDue: ${r.due_at}\nBody: ${r.body ?? ""}\nLinked to: ${r.resource_label ?? "N/A"}`,
              }) : undefined}
              onContextMenu={onContextMenu}
              style={{
                background: sel ? "rgba(226,35,26,0.04)" : "var(--surface, #fff)",
                border: sel ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.08))",
                borderLeft: sel ? "4px solid var(--twilio-red, #e22)" : `4px solid ${statusColor(r.status)}`,
                borderRadius: 8,
                padding: "14px 16px",
                opacity: r.status === "dismissed" ? 0.55 : 1,
                cursor: exportMode ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary, #111)" }}>{r.title}</span>
                    <span style={{
                      fontSize: "0.6875rem", fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                      background: statusColor(r.status), color: "#fff",
                    }}>{r.status}</span>
                  </div>
                  {r.body && (
                    <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)", margin: "4px 0 0" }}>{r.body}</p>
                  )}
                  <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
                      🕐 {formatDue(r.due_at)}
                    </span>
                    {r.resource_label && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
                        🔗 {r.resource_label}
                      </span>
                    )}
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
                      {[
                        r.notify_in_app && "In-App",
                        r.notify_slack && "Slack",
                        r.notify_push && "Laptop",
                        r.notify_sms && "Phone",
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                  <CommentTrigger resourceType="reminder" resourceId={r.id} resourceLabel={r.title} size="sm" />
                  {r.status !== "dismissed" && (
                    <>
                      <button className="card-btn" onClick={() => openEdit(r)} style={iconBtn} title="Edit">✏️</button>
                      <button className="card-btn" onClick={() => dismiss(r.id)} style={iconBtn} title="Dismiss">✓</button>
                    </>
                  )}
                  <button className="card-btn" onClick={() => del(r.id)} style={{ ...iconBtn, color: "#e22" }} title="Delete">🗑</button>
                </div>
              </div>
              <CommentPreviewList
                resourceType="reminder"
                resourceId={r.id}
                resourceLabel={r.title}
                variant="panel"
                className="mt-3"
              />
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
                <p style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary, #888)", marginBottom: 6 }}>
                  Activity Log
                </p>
                <ActivityLogSection resourceType="reminder" resourceId={r.id} variant="inline" />
              </div>
            </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6, fontSize: "0.875rem",
  border: "1px solid var(--border, rgba(0,0,0,0.15))",
  background: "var(--bg, #f5f5f5)", color: "var(--text-primary, #111)",
  boxSizing: "border-box" as const,
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)", textTransform: "uppercase" as const,
};

const ghostBtn: React.CSSProperties = {
  padding: "7px 14px", background: "transparent",
  border: "1px solid var(--border, rgba(0,0,0,0.15))", borderRadius: 6,
  fontSize: "0.875rem", cursor: "pointer", color: "var(--text-secondary, #888)",
};

const iconBtn: React.CSSProperties = {
  padding: "5px 8px", background: "transparent",
  border: "1px solid var(--border, rgba(0,0,0,0.1))", borderRadius: 6,
  fontSize: "0.875rem", cursor: "pointer",
};
