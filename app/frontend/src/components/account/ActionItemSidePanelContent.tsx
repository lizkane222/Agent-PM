import { useState, useRef, useEffect } from "react";
import { airtableApi } from "../../lib/api";
import type { AirtableActionItem, ActionItemAttachment, TeamMember } from "../../types";
import { useActionItemFieldOptions } from "../../hooks/useActionItemFieldOptions";
import { AccPillSelect, AccPillDate, AccPillNumber, AccPillUrl } from "../shared/PillInputs";
import CorporateIcon from "../../assets/icons/Corporate.svg?react";
import { ActionItemCardOccurrences } from "./ActionItemCardOccurrences";

const PRIORITY_ACCENT: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#0ea5e9",
  Low: "#9ca3af",
};

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

export function ActionItemSidePanelContent({
  item,
  teamMembers = [],
  onUpdated,
}: {
  item: AirtableActionItem;
  teamMembers?: TeamMember[];
  onUpdated?: (updated: AirtableActionItem) => void;
}) {
  const { status: statusOptions } = useActionItemFieldOptions();
  const [form, setForm] = useState<Partial<AirtableActionItem>>({ ...item });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attachments, setAttachments] = useState<ActionItemAttachment[]>(item.attachments ?? []);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const memberNames = ["Unassigned", ...teamMembers.map((m) => m.full_name)] as string[];

  // Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0); // seconds this session
  const timerStartRef = useRef<number | null>(null);
  const timerRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (item.airtable_id.startsWith("local-")) return;
    airtableApi.listAttachments(item.id).then(({ data }) => setAttachments(data)).catch(() => {});
  }, [item.id, item.airtable_id]);

  // Re-sync form when item prop changes (e.g. parent re-fetched)
  useEffect(() => {
    setForm((f) => ({ ...item, ...f }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.airtable_id]);

  // Live timer tick
  useEffect(() => {
    if (!timerRunning) {
      if (timerRafRef.current) cancelAnimationFrame(timerRafRef.current);
      return;
    }
    function tick() {
      if (timerStartRef.current != null) {
        setTimerElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000));
      }
      timerRafRef.current = requestAnimationFrame(tick);
    }
    timerRafRef.current = requestAnimationFrame(tick);
    return () => { if (timerRafRef.current) cancelAnimationFrame(timerRafRef.current); };
  }, [timerRunning]);

  function handleTimerToggle() {
    if (timerRunning) {
      // Stop: accumulate elapsed seconds into time_spent
      const added = timerElapsed;
      const prev = form.time_spent ?? 0;
      setForm((f) => ({ ...f, time_spent: prev + added }));
      setTimerRunning(false);
      setTimerElapsed(0);
      timerStartRef.current = null;
    } else {
      timerStartRef.current = Date.now();
      setTimerElapsed(0);
      setTimerRunning(true);
    }
  }

  function fmtTimer(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const set = (patch: Partial<AirtableActionItem>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const { data } = await airtableApi.updateActionItemFields(item.airtable_id, form as Parameters<typeof airtableApi.updateActionItemFields>[1]);
      onUpdated?.(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleAttachFiles(files: FileList | File[]) {
    setUploadingAttachment(true);
    for (const f of Array.from(files)) {
      try {
        const { data } = await airtableApi.uploadAttachmentFile(item.id, f);
        setAttachments((prev) => [data, ...prev]);
      } catch { /* skip */ }
    }
    setUploadingAttachment(false);
  }

  async function handleDeleteAttachment(id: number) {
    await airtableApi.deleteAttachment(item.id, id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  const accent = PRIORITY_ACCENT[form.priority ?? item.priority] ?? "#9ca3af";

  return (
    <div className="flex flex-col gap-4">
      {/* Title */}
      <input
        value={form.task ?? ""}
        onChange={(e) => set({ task: e.target.value })}
        placeholder="Task name…"
        className="w-full text-sm font-semibold text-[var(--twilio-navy)] bg-transparent border-b border-transparent focus:border-indigo-400 focus:outline-none pb-0.5"
        style={{ borderBottom: `2px solid ${accent}` }}
      />

      {/* Status · Priority · Due date pills */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <AccPillSelect
          value={form.status}
          options={statusOptions as AirtableActionItem["status"][]}
          colorMap={NEW_AI_STATUS_COLORS}
          placeholder="Status"
          onChange={(v) => set({ status: v })}
        />
        <AccPillSelect
          value={form.priority}
          options={["Critical", "High", "Medium", "Low"] as const}
          colorMap={NEW_AI_PRIORITY_COLORS}
          placeholder="Priority"
          onChange={(v) => set({ priority: v })}
        />
        <AccPillDate value={form.due_date} onChange={(v) => set({ due_date: v })} />
      </div>

      {/* Details */}
      <textarea
        value={form.task_details ?? ""}
        onChange={(e) => set({ task_details: e.target.value })}
        rows={3}
        placeholder="Additional context, steps, or notes…"
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-60)] focus:bg-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100 transition-colors resize-none"
      />

      {/* Time tracking */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Time Tracking</p>
        {/* Live timer */}
        <div className="flex items-center gap-3">
          <span className={`font-mono text-lg tabular-nums font-semibold ${timerRunning ? "text-emerald-600" : "text-[var(--twilio-navy)]"}`}>
            {fmtTimer(timerElapsed)}
          </span>
          <button
            onClick={handleTimerToggle}
            className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${
              timerRunning
                ? "bg-red-50 text-red-700 hover:bg-red-100 ring-1 ring-red-200"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200"
            }`}
          >
            {timerRunning ? "Stop" : "Track"}
          </button>
          {timerRunning && (
            <span className="text-[10px] text-emerald-600 font-medium animate-pulse">● Recording</span>
          )}
        </div>
        {/* Est / Spent / Prep pills */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <AccPillNumber value={form.estimated_time} label="Est." onChange={(v) => set({ estimated_time: v ?? 0 })} />
          <AccPillNumber value={form.time_spent} label="Spent" onChange={(v) => set({ time_spent: v ?? 0 })} />
          <AccPillNumber value={form.prep_time} label="Prep" onChange={(v) => set({ prep_time: v ?? 0 })} />
        </div>
      </div>

      {/* Assignee */}
      {teamMembers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Assignee</span>
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

      {/* Slack URL */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Slack</span>
        <AccPillUrl value={form.slack_thread_url} onChange={(v) => set({ slack_thread_url: v })} />
      </div>

      {/* Account badge */}
      {item.account_name && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--twilio-gray-60)] shrink-0">Account</span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--twilio-navy)] bg-gray-100 px-2 py-0.5 rounded-full">
            <CorporateIcon width={10} height={10} className="shrink-0 opacity-60" />
            {item.account_name}
          </span>
        </div>
      )}

      {/* Calendar occurrences */}
      <ActionItemCardOccurrences airtableId={item.airtable_id} />

      {/* Attachments */}
      {!item.airtable_id.startsWith("local-") && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
              Attachments{attachments.length > 0 && ` (${attachments.length})`}
            </span>
            <div className="flex items-center gap-1">
              {uploadingAttachment && <span className="text-[11px] text-gray-400 animate-pulse">Uploading…</span>}
              <button
                onClick={() => attachFileRef.current?.click()}
                className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
              >+ File</button>
              <input ref={attachFileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void handleAttachFiles(e.target.files)} />
            </div>
          </div>
          {attachments.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No attachments yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {attachments.map((a) => {
                const href = a.file_url ?? a.url ?? "";
                return (
                  <div key={a.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                    <span className="shrink-0">📎</span>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="flex-1 truncate text-indigo-600 hover:underline">{a.name || href}</a>
                    ) : (
                      <span className="flex-1 truncate text-[var(--twilio-navy)]">{a.name}</span>
                    )}
                    <button onClick={() => void handleDeleteAttachment(a.id)} className="shrink-0 text-gray-300 hover:text-red-400 transition-colors">×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      <button
        disabled={saving}
        onClick={() => void handleSave()}
        className={`w-full py-2 text-sm font-semibold rounded-lg transition-colors ${
          saved
            ? "bg-emerald-600 text-white"
            : "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
        }`}
      >
        {saved ? "✓ Saved" : saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
