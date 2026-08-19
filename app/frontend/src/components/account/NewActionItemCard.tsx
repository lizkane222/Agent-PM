import { useState } from "react";
import { airtableApi } from "../../lib/api";
import type { AirtableActionItem, TeamMember } from "../../types";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { AccPillSelect, AccPillDate, AccPillNumber, AccPillUrl } from "../shared/PillInputs";

// ── Pill helpers for new action item form ─────────────────────────────────────

const NEW_AI_STATUS_COLORS: Record<string, string> = {
  "Open": "bg-gray-100 text-[var(--twilio-navy)]",
  "In Progress": "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  "Done": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "Blocked": "bg-red-50 text-red-700 ring-1 ring-red-200",
  "Backlogged": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

const NEW_AI_PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-50 text-red-700 ring-1 ring-red-200",
  High: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  Medium: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  Low: "bg-gray-100 text-[var(--twilio-navy)] ring-1 ring-gray-200",
};

const PRIORITY_ACCENT: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};

// ── New Action Item card — Unstaged-style, pinned right ──────────────────────

export const BLANK_NEW_FORM = (): Partial<AirtableActionItem> => ({
  task: "",
  task_details: "",
  status: "Open",
  priority: "Medium",
  due_date: null,
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  assignee_name: "",
  assignee_airtable_id: "",
});

export function NewActionItemCard({
  accountName,
  teamMembers,
  onSave,
}: {
  accountName: string;
  teamMembers: TeamMember[];
  onSave: (item: AirtableActionItem) => void;
}) {
  const currentUser = useCurrentUser();
  const { status: statusOptions } = useActionItemFieldOptions();
  const [form, setForm] = useState<Partial<AirtableActionItem>>(BLANK_NEW_FORM());
  const [saving, setSaving] = useState(false);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  const set = (patch: Partial<AirtableActionItem>) => setForm((f) => ({ ...f, ...patch }));
  const accentColor = form.priority ? PRIORITY_ACCENT[form.priority] : "#e5e7eb";

  async function handleSave() {
    if (saving || !form.task?.trim()) return;
    setSaving(true);
    try {
      const { data } = await airtableApi.createActionItem({
        ...form,
        account_name: accountName,
        assignee_name: form.assignee_name || currentUser?.display_name || "",
        assignee_airtable_id: form.assignee_airtable_id || currentUser?.airtable_collaborator_id || "",
      } as Parameters<typeof airtableApi.createActionItem>[0]);
      onSave(data);
      setForm(BLANK_NEW_FORM());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-xl flex flex-col overflow-hidden select-none"
      style={{ background: "#F4F4F6", width: "240px", flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
    >
      {/* Task title */}
      <div className="px-4 pt-3 pb-2">
        <input
          value={form.task ?? ""}
          onChange={(e) => set({ task: e.target.value })}
          placeholder="Name or short description"
          className="w-full text-xs font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-gray-200 focus:border-indigo-400 focus:outline-none pb-1 placeholder:text-[var(--twilio-gray-60)] placeholder:font-normal"
        />
      </div>

      {/* Badge row: priority + status pills */}
      <div className="px-4 pb-3 flex items-center gap-1.5 flex-wrap">
        <AccPillSelect
          value={form.priority}
          options={["Critical", "High", "Medium", "Low"] as const}
          colorMap={NEW_AI_PRIORITY_COLORS}
          placeholder="Priority"
          onChange={(v) => set({ priority: v })}
        />
        <AccPillSelect
          value={form.status}
          options={statusOptions as AirtableActionItem["status"][]}
          colorMap={NEW_AI_STATUS_COLORS}
          placeholder="Status"
          onChange={(v) => set({ status: v })}
        />
      </div>

      {/* Fields */}
      <div className="px-4 pb-3 flex-1 flex flex-col gap-2.5" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <textarea
          value={form.task_details ?? ""}
          onChange={(e) => set({ task_details: e.target.value })}
          rows={2}
          placeholder="Additional context or notes…"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100 transition-colors resize-none mt-3"
        />
        <div className="flex flex-wrap gap-1.5 items-center">
          <AccPillDate value={form.due_date} onChange={(v) => set({ due_date: v })} />
          <AccPillNumber value={form.estimated_time} label="Est." onChange={(v) => set({ estimated_time: v ?? 0 })} />
          <AccPillNumber value={form.time_spent} label="Spent" onChange={(v) => set({ time_spent: v ?? 0 })} />
          <AccPillNumber value={form.prep_time} label="Prep" onChange={(v) => set({ prep_time: v ?? 0 })} />
          <AccPillUrl value={form.slack_thread_url} onChange={(v) => set({ slack_thread_url: v })} />
        </div>
        {teamMembers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <AccPillSelect
              value={(form.assignee_name || "Unassigned") as string}
              options={memberNames as string[]}
              colorMap={{}}
              placeholder="Unassigned"
              onChange={(v) => {
                const member = teamMembers.find((m) => m.full_name === v);
                set({ assignee_airtable_id: member ? String(member.id) : "", assignee_name: member?.full_name ?? "" });
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: accentColor }}
        >
          + New
        </div>
        <button
          disabled={saving || !form.task?.trim()}
          onClick={() => void handleSave()}
          className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
