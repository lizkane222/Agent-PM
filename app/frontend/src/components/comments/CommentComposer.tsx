/**
 * CommentComposer — textarea with @ (user mention) and @# (record reference) triggers.
 *
 * - Type @ to open user mention picker — shows all team members immediately,
 *   filters by name/email as you continue typing
 * - Type @# to open record search (multiselect) — selected records become
 *   bullet point hyperlinks appended to the comment
 * - Pressing Enter (without Shift) submits
 */
import { useEffect, useRef, useState } from "react";
import { searchApi, teamApi, type SearchResult } from "../../lib/api";
import type { CommentMention, CommentReference, CommentResourceType, TeamMember } from "../../types";

interface Props {
  onSubmit: (opts: {
    content: string;
    references: CommentReference[];
    mentions: CommentMention[];
  }) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  initialContent?: string;
}

const MENTION_TRIGGER = /(?:^|[^@\w])@([^@\s#]*)$/;
const REF_TRIGGER = /(?:^|[^@\w])@#(\S*)$/;

function useDebounce<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function MemberAvatar({ member }: { member: TeamMember }) {
  const initials = member.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  if (member.avatar_url) {
    return <img src={member.avatar_url} alt={member.full_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <span className="w-7 h-7 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
      {initials}
    </span>
  );
}

export default function CommentComposer({ onSubmit, onCancel, placeholder, autoFocus, initialContent }: Props) {
  const [text, setText] = useState(initialContent ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [references, setReferences] = useState<CommentReference[]>([]);
  const [mentions, setMentions] = useState<CommentMention[]>([]);

  // All team members — loaded once, filtered client-side for @ picker
  const [allMembers, setAllMembers] = useState<TeamMember[]>([]);

  // Picker state
  const [pickerMode, setPickerMode] = useState<"mention" | "ref" | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [refResults, setRefResults] = useState<SearchResult[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [pickerIdx, setPickerIdx] = useState(0);
  const [pendingRefs, setPendingRefs] = useState<SearchResult[]>([]);

  const debouncedRefQuery = useDebounce(pickerQuery, 200);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load all team members once on mount
  useEffect(() => {
    teamApi.listMembers({ page_size: "200" })
      .then(({ data }) => setAllMembers(data.results))
      .catch(() => {});
  }, []);

  // Filtered members for @ picker — show all when query is empty
  const filteredMembers = pickerQuery.trim().length === 0
    ? allMembers
    : allMembers.filter((m) => {
        const q = pickerQuery.toLowerCase();
        return (
          m.full_name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.slack_handle && m.slack_handle.toLowerCase().includes(q)) ||
          (m.title && m.title.toLowerCase().includes(q))
        );
      });

  const displayedMembers = filteredMembers.slice(0, 8);

  // Fetch record search results for @# picker
  useEffect(() => {
    if (pickerMode !== "ref") { setRefResults([]); return; }
    if (debouncedRefQuery.length < 1) { setRefResults([]); return; }
    setRefLoading(true);
    searchApi.search(debouncedRefQuery)
      .then(({ data }) => { setRefResults(data.results.slice(0, 20)); setPickerIdx(0); })
      .catch(() => {})
      .finally(() => setRefLoading(false));
  }, [debouncedRefQuery, pickerMode]);

  // Detect triggers as user types
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);

    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);

    if (REF_TRIGGER.test(before)) {
      const m = before.match(REF_TRIGGER);
      setPickerMode("ref");
      setPickerQuery(m?.[1] ?? "");
      setPickerIdx(0);
    } else if (MENTION_TRIGGER.test(before)) {
      const m = before.match(MENTION_TRIGGER);
      setPickerMode("mention");
      setPickerQuery(m?.[1] ?? "");
      setPickerIdx(0);
    } else {
      setPickerMode(null);
      setPendingRefs([]);
    }
  }

  function replaceTrigger(replacement: string) {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const cleaned = pickerMode === "ref"
      ? before.replace(/@#\S*$/, "")
      : before.replace(/@[^@\s#]*$/, "");
    const newText = cleaned + replacement + after;
    setText(newText);
    setPickerMode(null);
    setPendingRefs([]);
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      const pos = cleaned.length + replacement.length;
      el.setSelectionRange(pos, pos);
      el.focus();
    });
  }

  function selectMention(member: TeamMember) {
    const mention: CommentMention = {
      user_id: member.user ?? member.id,
      username: member.email.split("@")[0],
      display_name: member.full_name,
    };
    setMentions((prev) => [...prev.filter((m) => m.user_id !== mention.user_id), mention]);
    replaceTrigger(`@${member.full_name} `);
  }

  function togglePendingRef(result: SearchResult) {
    setPendingRefs((prev) => {
      const exists = prev.find((r) => r.type === result.type && r.id === result.id);
      return exists ? prev.filter((r) => !(r.type === result.type && r.id === result.id)) : [...prev, result];
    });
  }

  function confirmRefs() {
    const newRefs: CommentReference[] = pendingRefs.map((r) => ({
      resource_type: r.type as CommentResourceType,
      resource_id: typeof r.id === "number" ? r.id : parseInt(String(r.id)),
      label: r.title,
      url: r.url,
    }));
    setReferences((prev) => {
      const merged = [...prev];
      for (const ref of newRefs) {
        if (!merged.find((x) => x.resource_type === ref.resource_type && x.resource_id === ref.resource_id)) {
          merged.push(ref);
        }
      }
      return merged;
    });
    const bullets = pendingRefs.map((r) => `• ${r.title}`).join("\n");
    replaceTrigger("\n" + bullets + "\n");
  }

  function removeRef(ref: CommentReference) {
    setReferences((prev) => prev.filter((r) => !(r.resource_type === ref.resource_type && r.resource_id === ref.resource_id)));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerMode === "mention") {
      const count = displayedMembers.length;
      if (e.key === "ArrowDown") { e.preventDefault(); setPickerIdx((i) => (count ? (i + 1) % count : 0)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setPickerIdx((i) => (count ? (i - 1 + count) % count : 0)); }
      if (e.key === "Escape") { e.preventDefault(); setPickerMode(null); }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const member = displayedMembers[pickerIdx];
        if (member) selectMention(member);
      }
      return;
    }

    if (pickerMode === "ref") {
      const count = refResults.length;
      if (e.key === "ArrowDown") { e.preventDefault(); setPickerIdx((i) => (count ? (i + 1) % count : 0)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setPickerIdx((i) => (count ? (i - 1 + count) % count : 0)); }
      if (e.key === "Escape") { e.preventDefault(); setPickerMode(null); }
      if (e.key === "Enter") {
        e.preventDefault();
        const r = refResults[pickerIdx];
        if (r) togglePendingRef(r);
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (pendingRefs.length > 0) confirmRefs();
        else setPickerMode(null);
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
    if (e.key === "Escape" && onCancel) {
      onCancel();
    }
  }

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ content: trimmed, references, mentions });
      setText("");
      setReferences([]);
      setMentions([]);
    } finally {
      setSubmitting(false);
    }
  }

  const showDropdown = pickerMode !== null;

  return (
    <div className="relative">
      {/* Picker dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-xl shadow-xl border border-gray-200 bg-white overflow-hidden">

          {/* ── @ user mention dropdown ── */}
          {pickerMode === "mention" && (
            <>
              <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1.5 bg-gray-50">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3 h-3 text-indigo-500 shrink-0">
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M9.5 7a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Mention a teammate</span>
                {pickerQuery && <span className="text-[10px] text-indigo-600 font-medium ml-1">"{pickerQuery}"</span>}
              </div>

              {displayedMembers.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-3 text-center">No teammates found</p>
              )}

              <div className="max-h-52 overflow-y-auto">
                {displayedMembers.map((member, i) => {
                  const isFocused = i === pickerIdx % Math.max(displayedMembers.length, 1);
                  return (
                    <div
                      key={member.id}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                        isFocused ? "bg-indigo-50" : "hover:bg-gray-50"
                      }`}
                      onMouseDown={(e) => { e.preventDefault(); selectMention(member); }}
                    >
                      <MemberAvatar member={member} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{member.full_name}</p>
                        <p className="text-[11px] text-gray-400 truncate">{member.title || member.email}</p>
                      </div>
                      {member.slack_handle && (
                        <span className="text-[10px] text-gray-400 shrink-0">@{member.slack_handle}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50">
                <p className="text-[10px] text-gray-400">
                  <kbd className="font-mono">↑↓</kbd> navigate · <kbd className="font-mono">Enter</kbd> or <kbd className="font-mono">Tab</kbd> select · <kbd className="font-mono">Esc</kbd> dismiss
                </p>
              </div>
            </>
          )}

          {/* ── @# record reference dropdown ── */}
          {pickerMode === "ref" && (
            <>
              {pendingRefs.length > 0 && (
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 bg-indigo-50">
                  <span className="text-xs text-indigo-700 font-medium">{pendingRefs.length} selected</span>
                  <button
                    className="text-xs font-semibold text-white bg-indigo-600 rounded-lg px-3 py-1 hover:bg-indigo-700"
                    onMouseDown={(e) => { e.preventDefault(); confirmRefs(); }}
                  >
                    Add references — Tab
                  </button>
                </div>
              )}
              {refLoading && <p className="text-xs text-gray-400 px-3 py-2">Searching…</p>}
              {!refLoading && refResults.length === 0 && pickerQuery.length >= 1 && (
                <p className="text-xs text-gray-400 px-3 py-2">No results for "{pickerQuery}"</p>
              )}
              {!refLoading && pickerQuery.length < 1 && (
                <p className="text-xs text-gray-400 px-3 py-2">Type to search records…</p>
              )}
              <div className="max-h-52 overflow-y-auto">
                {refResults.map((r, i) => {
                  const isFocused = i === pickerIdx % Math.max(refResults.length, 1);
                  const isSelected = pendingRefs.some((p) => p.type === r.type && p.id === r.id);
                  return (
                    <div
                      key={`${r.type}:${r.id}`}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                        isFocused ? "bg-indigo-50" : "hover:bg-gray-50"
                      }`}
                      onMouseDown={(e) => { e.preventDefault(); togglePendingRef(r); }}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isSelected ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                      }`}>
                        {isSelected && (
                          <svg viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.8" className="w-2.5 h-2">
                            <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: `${r.accent}18`, color: r.accent }}
                      >
                        {r.type_label}
                      </span>
                      <span className="font-medium text-gray-800 truncate">{r.title}</span>
                      {r.account && <span className="text-xs text-gray-400 truncate">{r.account}</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Attached reference chips */}
      {references.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {references.map((ref) => (
            <span
              key={`${ref.resource_type}:${ref.resource_id}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
            >
              {ref.label}
              <button
                onMouseDown={(e) => { e.preventDefault(); removeRef(ref); }}
                className="hover:text-red-500 ml-0.5"
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Write a comment… (@name to mention, @# to reference a record)"}
          className="flex-1 text-sm rounded-xl border border-gray-200 px-3 py-2 resize-none outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 bg-white transition-all"
          style={{ color: "var(--twilio-navy)" }}
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => void handleSubmit()}
            disabled={!text.trim() || submitting}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors"
            style={{ background: "var(--twilio-navy)" }}
          >
            {submitting ? "…" : "Post"}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-1">
        <kbd className="font-mono">Enter</kbd> to post · <kbd className="font-mono">Shift+Enter</kbd> newline · <kbd className="font-mono">@name</kbd> mention · <kbd className="font-mono">@#</kbd> reference record
      </p>
    </div>
  );
}
