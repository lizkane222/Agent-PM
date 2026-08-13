import { useEffect, useRef, useState } from "react";
import type { AccountNote, AirtableActionItem, TeamMember } from "../../types";
import { accountsApi, airtableApi, schedulerApi, searchApi } from "../../lib/api";
import { renderNoteInline, handleLinkPaste } from "../../lib/noteHelpers";
import { useCurrentUser } from "../../context/CurrentUserContext";

// ── Account Notes helpers ─────────────────────────────────────────────────────

function _stripMentions(text: string) {
  return text.replace(/@\S+/g, "").replace(/\s{2,}/g, " ").trim();
}
function _extractMentions(text: string): string[] {
  return (text.match(/@(\S+)/g) ?? []).map((m) => m.slice(1));
}
function NoteIconChecklist({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function NoteIconCalendar({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>;
}
function NoteIconSchedule({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function NoteIconAgent({ className }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}><path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z" strokeLinejoin="round"/><path d="M7 9h6M7 12h4" strokeLinecap="round"/></svg>;
}

export function AccountNoteRow({
  note,
  accountId,
  accountName,
  airtableAccountId,
  teamMembers,
  onSave,
  onDelete,
  onCreatedActionItem,
}: {
  note: AccountNote;
  accountId: number;
  accountName: string;
  airtableAccountId?: number | null;
  teamMembers: TeamMember[];
  onSave: (n: AccountNote) => void;
  onDelete: (id: number) => void;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const currentUser = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.content);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionMode, setMentionMode] = useState<"user" | "ref" | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [refResults, setRefResults] = useState<Array<{ id: string; label: string; url: string }>>([]);
  const refTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openTooltip, setOpenTooltip] = useState<"action" | "calendar" | "reminder" | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const mentionsInNote = _extractMentions(note.content);
  const preselected = teamMembers.filter((m) =>
    mentionsInNote.some((name) => m.full_name.replace(/\s+/g, "").toLowerCase() === name.toLowerCase())
  );
  const [aiAssignees, setAiAssignees] = useState<TeamMember[]>([]);
  const [aiPriority, setAiPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [aiDue, setAiDue] = useState("");
  const [aiSaved, setAiSaved] = useState(false);
  const [calTitle, setCalTitle] = useState(_stripMentions(note.content).slice(0, 80) || "Follow-up Meeting");
  const [calStart, setCalStart] = useState("");
  const [calEnd, setCalEnd] = useState("");
  const [calSaved, setCalSaved] = useState(false);
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [remSaved, setRemSaved] = useState(false);
  const _acctNlsKey = `acct-note-actions::${note.id}`;
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(_acctNlsKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  function markDone(kind: "action" | "calendar" | "reminder") {
    setDoneActions((p) => { const n = new Set([...p, kind]); try { localStorage.setItem(_acctNlsKey, JSON.stringify([...n])); } catch {} return n; });
  }

  useEffect(() => {
    if (!openTooltip) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenTooltip(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTooltip]);

  useEffect(() => {
    if (openTooltip === "action") setAiAssignees(preselected);
    if (openTooltip === "calendar") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
      const end = new Date(tomorrow); end.setHours(11, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setCalStart(fmt(tomorrow)); setCalEnd(fmt(end));
      setCalTitle(_stripMentions(note.content).slice(0, 80) || "Follow-up Meeting");
    }
    if (openTooltip === "reminder") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      setRemDate(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTooltip]);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    const el = inputRef.current;
    el.focus();
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  useEffect(() => {
    const el = inputRef.current;
    if (!editing || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, editText]);

  useEffect(() => {
    if (mentionMode !== "ref" || !mentionQuery) { setRefResults([]); return; }
    if (refTimerRef.current) clearTimeout(refTimerRef.current);
    refTimerRef.current = setTimeout(() => {
      searchApi.search(mentionQuery)
        .then((r) => {
          setRefResults((r.data.results ?? []).map((sr) => ({ id: String(sr.id), label: sr.title, url: sr.url ?? "" })));
          setMentionIndex(0);
        })
        .catch(() => {});
    }, 200);
    return () => { if (refTimerRef.current) clearTimeout(refTimerRef.current); };
  }, [mentionMode, mentionQuery]);

  function handleChange(val: string) {
    setEditText(val);
    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0) {
      const afterAt = val.slice(atIdx + 1);
      if (!afterAt.includes(" ")) {
        if (afterAt.startsWith("#")) { setMentionMode("ref"); setMentionQuery(afterAt.slice(1).toLowerCase()); }
        else { setMentionMode("user"); setMentionQuery(afterAt.toLowerCase()); }
        setMentionIndex(0); return;
      }
    }
    setMentionMode(null); setMentionQuery("");
  }

  const mentionMatches = mentionMode === "user"
    ? teamMembers.filter((m) => m.full_name.toLowerCase().includes(mentionQuery) || m.email.toLowerCase().includes(mentionQuery))
    : [];

  function acceptMention(member: TeamMember) {
    const atIdx = editText.lastIndexOf("@");
    setEditText(editText.slice(0, atIdx) + `@${member.full_name.replace(/\s+/g, "")} `);
    setMentionMode(null); setMentionQuery(""); setMentionIndex(0);
    inputRef.current?.focus();
  }

  function acceptRef(ref: { label: string; url: string }) {
    const atIdx = editText.lastIndexOf("@");
    setEditText(editText.slice(0, atIdx) + (ref.url ? `[${ref.label}](${ref.url}) ` : `${ref.label} `));
    setMentionMode(null); setMentionQuery(""); setRefResults([]);
    inputRef.current?.focus();
  }

  function commitEdit() {
    setEditing(false); setMentionMode(null); setMentionQuery("");
    const trimmed = editText.trim();
    if (!trimmed || trimmed === note.content) return;
    accountsApi.updateNote(note.id, trimmed).then(({ data }) => onSave(data)).catch(() => {});
  }

  function submitActionItem() {
    const assignees = aiAssignees.length > 0 ? aiAssignees : preselected;
    const assigneeName = assignees[0]?.full_name || currentUser?.display_name || "";
    const assigneeId = assignees[0] ? "" : currentUser?.airtable_collaborator_id || "";
    airtableApi.createActionItem({
      task: _stripMentions(note.content),
      task_details: note.content,
      status: "Open",
      priority: aiPriority,
      due_date: aiDue || null,
      account: airtableAccountId ?? undefined,
      account_name: accountName,
      assignee_name: assigneeName,
      assignee_airtable_id: assigneeId,
    } as Parameters<typeof airtableApi.createActionItem>[0])
      .then(({ data }) => {
        onCreatedActionItem?.(data);
        setAiSaved(true);
        markDone("action");
        localStorage.setItem("actionItemsUpdated", String(Date.now()));
        window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
        setTimeout(() => { setAiSaved(false); setOpenTooltip(null); }, 1400);
      })
      .catch(() => {});
  }

  function submitMeeting() {
    if (!calStart || !calEnd) return;
    schedulerApi.createEvent({
      title: calTitle,
      description: `From account note: ${note.content}`,
      start_datetime: new Date(calStart).toISOString(),
      end_datetime: new Date(calEnd).toISOString(),
      attendees: aiAssignees.map((m) => ({ email: m.email, displayName: m.full_name, responseStatus: "needsAction" as const })),
    } as Parameters<typeof schedulerApi.createEvent>[0])
      .then(() => { setCalSaved(true); markDone("calendar"); setTimeout(() => { setCalSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  function submitReminder() {
    if (!remDate) return;
    const due = new Date(`${remDate}T${remTime}:00`);
    schedulerApi.createReminder({
      title: _stripMentions(note.content).slice(0, 200) || "Account note reminder",
      body: note.content,
      resource_type: "account",
      resource_id: accountId,
      resource_label: accountName,
      due_at: due.toISOString(),
      notify_in_app: true,
    } as Parameters<typeof schedulerApi.createReminder>[0])
      .then(() => { setRemSaved(true); markDone("reminder"); setTimeout(() => { setRemSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  return (
    <li
      className="group relative flex items-start gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("noteText", note.content);
        e.dataTransfer.setData("noteId", String(note.id));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-[var(--twilio-navy)] shrink-0 opacity-50 cursor-grab active:cursor-grabbing" />
      <div className="flex-1 min-w-0 relative">
        {editing ? (
          <div className="relative">
            <textarea
              ref={inputRef}
              value={editText}
              rows={1}
              onChange={(e) => handleChange(e.target.value)}
              onPaste={(e) => handleLinkPaste(e, editText, setEditText)}
              onBlur={() => { if (mentionMode === null) commitEdit(); }}
              onKeyDown={(e) => {
                const activeItems = mentionMode === "user" ? mentionMatches : mentionMode === "ref" ? refResults : [];
                if (mentionMode !== null && activeItems.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, activeItems.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    const sel = activeItems[mentionIndex];
                    if (sel) mentionMode === "user" ? acceptMention(sel as TeamMember) : acceptRef(sel as { label: string; url: string });
                    return;
                  }
                  if (e.key === "Escape") { setMentionMode(null); return; }
                }
                if (e.key === "Enter" && e.shiftKey) { return; }
                if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") { setEditing(false); setEditText(note.content); setMentionMode(null); setMentionQuery(""); }
              }}
              style={{ overflow: "hidden" }}
              className="w-full text-sm text-[var(--twilio-navy)] bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400 resize-none leading-relaxed"
            />
            {mentionMode === "user" && mentionMatches.length > 0 && (
              <ul className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-56 py-1 text-sm max-h-40 overflow-y-auto">
                {mentionMatches.map((m, i) => (
                  <li key={m.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === mentionIndex ? "bg-indigo-50 text-indigo-700" : "text-[var(--twilio-navy)] hover:bg-gray-50"}`}
                    onMouseDown={(e) => { e.preventDefault(); acceptMention(m); }}>
                    <span className="h-5 w-5 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0">{m.full_name[0]}</span>
                    <span className="truncate">{m.full_name}</span>
                  </li>
                ))}
              </ul>
            )}
            {mentionMode === "ref" && refResults.length > 0 && (
              <ul className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-64 py-1 text-sm max-h-40 overflow-y-auto">
                {refResults.map((r, i) => (
                  <li key={r.id} className={`px-3 py-1.5 cursor-pointer truncate ${i === mentionIndex ? "bg-indigo-50 text-indigo-700" : "text-[var(--twilio-navy)] hover:bg-gray-50"}`}
                    onMouseDown={(e) => { e.preventDefault(); acceptRef(r); }}>
                    {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-sm text-[var(--twilio-navy)] leading-relaxed cursor-text"
            onClick={() => { setEditing(true); setEditText(note.content); }}>
            {note.content.split("\n").map((line, li) => {
              const isSub = line.startsWith("- ");
              const content = isSub ? line.slice(2) : line;
              return (
                <div key={li} style={isSub ? { display: "flex", alignItems: "flex-start", gap: "5px", marginLeft: "12px", marginTop: li > 0 ? "2px" : undefined } : { marginTop: li > 0 ? "2px" : undefined }}>
                  {isSub && <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#9ca3af", flexShrink: 0, marginTop: "8px" }} />}
                  <span>{renderNoteInline(content)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!editing && (
        <div ref={tooltipRef} className="relative flex items-center gap-0.5 shrink-0 mt-[1px]">
          <button onClick={() => setOpenTooltip(openTooltip === "action" ? null : "action")} title="Create action item"
            className={`p-1 rounded transition-colors ${doneActions.has("action") ? "text-blue-600" : openTooltip === "action" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
            <NoteIconChecklist className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setOpenTooltip(openTooltip === "calendar" ? null : "calendar")} title="Create meeting"
            className={`p-1 rounded transition-colors ${doneActions.has("calendar") ? "text-blue-600" : openTooltip === "calendar" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
            <NoteIconCalendar className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setOpenTooltip(openTooltip === "reminder" ? null : "reminder")} title="Set reminder"
            className={`p-1 rounded transition-colors ${doneActions.has("reminder") ? "text-blue-600" : openTooltip === "reminder" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
            <NoteIconSchedule className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: note.content } }))} title="Send to agent chat"
            className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100">
            <NoteIconAgent className="w-3.5 h-3.5" />
          </button>
          <span className="h-3 w-px bg-gray-200 mx-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <button onClick={() => onDelete(note.id)} title="Delete note"
            className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-red-500 hover:bg-red-50">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
              <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {note.author_display && (
            <span className="text-[10px] text-[var(--twilio-gray-40)] ml-1 max-w-[60px] truncate" title={note.author_display}>{note.author_display}</span>
          )}

          {openTooltip === "action" && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Action Item</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{_stripMentions(note.content)}</div>
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Assign to</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}<button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" value=""
                  onChange={(e) => { const member = teamMembers.find((m) => String(m.id) === e.target.value); if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]); }}>
                  <option value="">+ Add assignee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.title ? ` — ${m.title}` : ""}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Priority</p>
                  <select value={aiPriority} onChange={(e) => setAiPriority(e.target.value as typeof aiPriority)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white">
                    {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Due date</p>
                  <input type="date" value={aiDue} onChange={(e) => setAiDue(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" />
                </div>
              </div>
              <button onClick={submitActionItem} disabled={aiSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${aiSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700"}`}>
                {aiSaved ? "✓ Created" : "Create Action Item"}
              </button>
            </div>
          )}

          {openTooltip === "calendar" && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Meeting</p>
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Title</p>
                <input value={calTitle} onChange={(e) => setCalTitle(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Start</p>
                  <input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">End</p>
                  <input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Invite</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}<button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" value=""
                  onChange={(e) => { const member = teamMembers.find((m) => String(m.id) === e.target.value); if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]); }}>
                  <option value="">+ Add attendee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
              <button onClick={submitMeeting} disabled={!calStart || !calEnd || calSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${calSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {calSaved ? "✓ Created" : "Create Meeting"}
              </button>
            </div>
          )}

          {openTooltip === "reminder" && (
            <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Set Reminder</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{_stripMentions(note.content)}</div>
              <div className="flex flex-wrap gap-1">
                {[{ label: "In 1 hour", mins: 60 }, { label: "Tomorrow 9am", mins: null }, { label: "In 2 days", mins: null, days: 2 }].map(({ label, mins, days }) => (
                  <button key={label} onClick={() => {
                    const d = new Date();
                    if (mins) { d.setMinutes(d.getMinutes() + mins); }
                    else if (days) { d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); }
                    else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
                    const pad = (n: number) => String(n).padStart(2, "0");
                    setRemDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
                    setRemTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                  }} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors">
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Date</p>
                  <input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Time</p>
                  <input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
              </div>
              <button onClick={submitReminder} disabled={!remDate || remSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${remSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {remSaved ? "✓ Reminder Set" : "Set Reminder"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
