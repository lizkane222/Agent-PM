import { useEffect, useRef, useState } from "react";
import type { AccountNote, AirtableActionItem, TeamMember } from "../../types";
import { accountsApi, searchApi } from "../../lib/api";
import { handleLinkPaste } from "../../lib/noteHelpers";
import { AccountNoteRow } from "./AccountNoteRow";

// ── Account Meeting Notes ─────────────────────────────────────────────────────

export function AccountMeetingNotes({
  accountId,
  accountName,
  airtableAccountId,
  notes,
  teamMembers,
  onAdd,
  onUpdate,
  onDelete,
  onCreatedActionItem,
}: {
  accountId: number;
  accountName: string;
  airtableAccountId?: number | null;
  notes: AccountNote[];
  teamMembers: TeamMember[];
  onAdd: (note: AccountNote) => void;
  onUpdate: (id: number, content: string) => void;
  onDelete: (id: number) => void;
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [mentionMode, setMentionMode] = useState<"user" | "ref" | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [refResults, setRefResults] = useState<Array<{ id: string; label: string; url: string }>>([]);
  const refTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = draftInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

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

  function handleDraftChange(val: string) {
    setDraft(val);
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

  function acceptDraftMention(member: TeamMember) {
    const atIdx = draft.lastIndexOf("@");
    setDraft(draft.slice(0, atIdx) + `@${member.full_name.replace(/\s+/g, "")} `);
    setMentionMode(null); setMentionQuery(""); setMentionIndex(0);
    draftInputRef.current?.focus();
  }

  function acceptDraftRef(ref: { label: string; url: string }) {
    const atIdx = draft.lastIndexOf("@");
    setDraft(draft.slice(0, atIdx) + (ref.url ? `[${ref.label}](${ref.url}) ` : `${ref.label} `));
    setMentionMode(null); setMentionQuery(""); setRefResults([]);
    draftInputRef.current?.focus();
  }

  async function handleAddNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const { data } = await accountsApi.createNote(accountId, text);
      onAdd(data);
      setDraft("");
    } catch { /* best effort */ } finally {
      setSaving(false);
    }
  }

  function handleSaveEdit(updated: AccountNote) {
    onUpdate(updated.id, updated.content);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className={`relative flex items-start gap-2 px-3 py-2 ${notes.length > 0 ? "border-b border-gray-100" : ""}`}>
        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
        <textarea
          ref={draftInputRef}
          value={draft}
          rows={1}
          onChange={(e) => handleDraftChange(e.target.value)}
          onPaste={(e) => handleLinkPaste(e, draft, setDraft)}
          onKeyDown={(e) => {
            const activeItems = mentionMode === "user" ? mentionMatches : mentionMode === "ref" ? refResults : [];
            if (mentionMode !== null && activeItems.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, activeItems.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const sel = activeItems[mentionIndex];
                if (sel) mentionMode === "user" ? acceptDraftMention(sel as TeamMember) : acceptDraftRef(sel as { label: string; url: string });
                return;
              }
              if (e.key === "Escape") { setMentionMode(null); return; }
            }
            if (e.key === "Enter" && e.shiftKey) { return; }
            if (e.key === "Enter") { e.preventDefault(); void handleAddNote(); }
          }}
          placeholder="Add a note… (type @ to mention, Shift+Enter for new line)"
          style={{ overflow: "hidden" }}
          className="flex-1 text-sm text-[var(--twilio-navy)] placeholder-gray-400 bg-transparent outline-none py-0.5 resize-none leading-relaxed"
          disabled={saving}
        />
        {draft.trim() && (
          <button onClick={() => void handleAddNote()} disabled={saving}
            className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 shrink-0 transition-colors self-start mt-0.5">
            Add
          </button>
        )}
        {mentionMode === "user" && mentionMatches.length > 0 && (
          <ul className="absolute left-6 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-56 py-1 text-sm max-h-40 overflow-y-auto">
            {mentionMatches.map((m, i) => (
              <li key={m.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${i === mentionIndex ? "bg-indigo-50 text-indigo-700" : "text-[var(--twilio-navy)] hover:bg-gray-50"}`}
                onMouseDown={(e) => { e.preventDefault(); acceptDraftMention(m); }}>
                <span className="h-5 w-5 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0">{m.full_name[0]}</span>
                <span className="truncate">{m.full_name}</span>
              </li>
            ))}
          </ul>
        )}
        {mentionMode === "ref" && refResults.length > 0 && (
          <ul className="absolute left-6 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-64 py-1 text-sm max-h-40 overflow-y-auto">
            {refResults.map((r, i) => (
              <li key={r.id} className={`px-3 py-1.5 cursor-pointer truncate ${i === mentionIndex ? "bg-indigo-50 text-indigo-700" : "text-[var(--twilio-navy)] hover:bg-gray-50"}`}
                onMouseDown={(e) => { e.preventDefault(); acceptDraftRef(r); }}>
                {r.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {notes.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {notes.map((note) => (
            <AccountNoteRow
              key={note.id}
              note={note}
              accountId={accountId}
              accountName={accountName}
              airtableAccountId={airtableAccountId}
              teamMembers={teamMembers}
              onSave={handleSaveEdit}
              onDelete={onDelete}
              onCreatedActionItem={onCreatedActionItem}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
