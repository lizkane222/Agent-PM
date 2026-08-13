import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { BulletList, OrderedList, ListItem, TaskList, TaskItem } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useRef, useState } from "react";
import { teamApi, searchApi } from "../../lib/api";
import type { TeamMember } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert legacy plain-text task_details to HTML for TipTap */
export function plainToHtml(text: string): string {
  if (!text.trim()) return "";
  if (text.trimStart().startsWith("<")) return text; // already HTML
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function TBtn({
  active, onMouseDown, title, children,
}: {
  active?: boolean;
  onMouseDown: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      title={title}
      className={`px-1.5 py-0.5 rounded text-xs font-medium leading-none transition-colors select-none ${
        active
          ? "bg-indigo-600 text-white"
          : "text-[var(--twilio-navy)] hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

// ── Link popover ──────────────────────────────────────────────────────────────

function LinkPopover({ onSet, onClose }: { onSet: (url: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState("https://");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  return (
    <div
      className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1.5 items-center min-w-[280px]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSet(url); }
          if (e.key === "Escape") onClose();
        }}
        placeholder="https://…"
        className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400"
      />
      <button
        type="button"
        onClick={() => onSet(url)}
        className="text-xs font-semibold px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700"
      >
        Set
      </button>
      <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕</button>
    </div>
  );
}

// ── Mention dropdown ──────────────────────────────────────────────────────────

function MentionDropdown<T extends { id: string | number; label: string }>({
  items,
  activeIdx,
  onSelect,
}: {
  items: T[];
  activeIdx: number;
  onSelect: (item: T) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);
  if (!items.length) return null;
  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl max-h-44 overflow-y-auto min-w-[200px]"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          data-idx={i}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
          className={`w-full text-left px-3 py-1.5 text-sm ${i === activeIdx ? "bg-indigo-50 text-indigo-700 font-semibold" : "hover:bg-gray-50"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface Props {
  value: string; // HTML (or legacy plain text — converted on mount)
  onChange: (html: string) => void;
  placeholder?: string;
}

export default function ActionItemDescriptionEditor({ value, onChange, placeholder }: Props) {
  const [showLink, setShowLink] = useState(false);

  // @mention state
  type MentionMode = "user" | "ref" | null;
  const [mentionMode, setMentionMode] = useState<MentionMode>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionAnchorPos, setMentionAnchorPos] = useState(0);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
  const [teamMembers, setTeamMembers] = useState<Array<{ id: number; label: string }>>([]);
  const [allMembers, setAllMembers] = useState<TeamMember[]>([]);
  const [refResults, setRefResults] = useState<Array<{ id: string; label: string; href: string }>>([]);

  // Load team members once
  useEffect(() => {
    teamApi.listMembers({ page_size: "200" })
      .then((r) => {
        setAllMembers(r.data.results);
      })
      .catch(() => {});
  }, []);

  // Filter team members by mentionQuery
  useEffect(() => {
    if (mentionMode !== "user") { setTeamMembers([]); return; }
    const q = mentionQuery.toLowerCase();
    setTeamMembers(
      allMembers
        .filter((m) => m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
        .map((m) => ({ id: m.id, label: m.full_name }))
    );
    setMentionActiveIdx(0);
  }, [mentionMode, mentionQuery, allMembers]);

  // Debounced record reference search
  const refQueryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mentionMode !== "ref" || !mentionQuery) { setRefResults([]); return; }
    if (refQueryRef.current) clearTimeout(refQueryRef.current);
    refQueryRef.current = setTimeout(() => {
      searchApi.search(mentionQuery)
        .then((r) => {
          const results = r.data.results ?? [];
          setRefResults(results.map((sr) => ({ id: String(sr.id), label: sr.title, href: sr.url ?? "" })));
          setMentionActiveIdx(0);
        })
        .catch(() => {});
    }, 200);
    return () => { if (refQueryRef.current) clearTimeout(refQueryRef.current); };
  }, [mentionMode, mentionQuery]);

  const dismissMention = useCallback(() => {
    setMentionMode(null);
    setMentionQuery("");
    setMentionAnchorPos(0);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, link: false }),
      BulletList,
      OrderedList,
      ListItem,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-indigo-600 underline",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Add details, context, steps, or links…" }),
    ],
    content: plainToHtml(value),
    onUpdate({ editor }) {
      onChange(editor.getHTML());

      // Detect @mention / @# reference trigger
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 80), from, "\n", "\0");
      const atIdx = textBefore.lastIndexOf("@");
      if (atIdx !== -1) {
        const afterAt = textBefore.slice(atIdx + 1);
        // Only trigger if no space after @
        if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
          if (afterAt.startsWith("#")) {
            const query = afterAt.slice(1);
            setMentionMode("ref");
            setMentionQuery(query);
            setMentionAnchorPos(from - afterAt.length - 1);
            return;
          } else {
            setMentionMode("user");
            setMentionQuery(afterAt);
            setMentionAnchorPos(from - afterAt.length - 1);
            return;
          }
        }
      }
      dismissMention();
    },
  });

  // Sync external value changes (e.g. form reset)
  useEffect(() => {
    if (!editor) return;
    const html = plainToHtml(value);
    if (html !== editor.getHTML()) editor.commands.setContent(html, { emitUpdate: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const insertMentionUser = useCallback((item: { id: number; label: string }) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    editor.chain()
      .deleteRange({ from: mentionAnchorPos, to: from })
      .insertContent(`@${item.label} `)
      .run();
    dismissMention();
  }, [editor, mentionAnchorPos, dismissMention]);

  const insertMentionRef = useCallback((item: { id: string; label: string; href: string }) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    editor.chain()
      .deleteRange({ from: mentionAnchorPos, to: from })
      .insertContent(
        item.href
          ? `<a href="${item.href}" target="_blank" rel="noopener noreferrer">${item.label}</a> `
          : `${item.label} `
      )
      .run();
    dismissMention();
  }, [editor, mentionAnchorPos, dismissMention]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!mentionMode) return;
    const items = mentionMode === "user" ? teamMembers : refResults;
    if (e.key === "ArrowDown") { e.preventDefault(); setMentionActiveIdx((i) => Math.min(i + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setMentionActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const selected = items[mentionActiveIdx];
      if (selected) {
        if (mentionMode === "user") insertMentionUser(selected as { id: number; label: string });
        else insertMentionRef(selected as { id: string; label: string; href: string });
      }
    }
    if (e.key === "Escape") { e.preventDefault(); dismissMention(); }
  }, [mentionMode, teamMembers, refResults, mentionActiveIdx, insertMentionUser, insertMentionRef, dismissMention]);

  if (!editor) return null;

  const activeMentionItems = mentionMode === "user" ? teamMembers : refResults;

  return (
    <div className="relative border border-gray-200 rounded-lg overflow-visible bg-white focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-100">
      {/* Toolbar */}
      <div className="relative flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-[#F4F4F6]">
        <TBtn active={editor.isActive("bold")} onMouseDown={() => editor.chain().focus().toggleBold().run()} title="Bold"><strong>B</strong></TBtn>
        <TBtn active={editor.isActive("italic")} onMouseDown={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></TBtn>
        <TBtn active={editor.isActive("strike")} onMouseDown={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></TBtn>
        <span className="w-px h-4 bg-gray-300 mx-0.5" />
        <TBtn active={editor.isActive("bulletList")} onMouseDown={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">• List</TBtn>
        <TBtn active={editor.isActive("orderedList")} onMouseDown={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">1. List</TBtn>
        <TBtn active={editor.isActive("taskList")} onMouseDown={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">
          <span className="flex items-center gap-0.5">
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="1" width="10" height="10" rx="2"/><path d="M3.5 6l2 2 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>Steps</span>
          </span>
        </TBtn>
        <span className="w-px h-4 bg-gray-300 mx-0.5" />
        <div className="relative">
          <TBtn
            active={editor.isActive("link") || showLink}
            onMouseDown={() => { setShowLink((v) => !v); }}
            title="Insert link"
          >
            <span className="flex items-center gap-0.5">
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 7a3 3 0 0 0 4.243 0l1.414-1.414a3 3 0 0 0-4.243-4.243L5 2.757"/><path d="M7 5a3 3 0 0 0-4.243 0L1.343 6.414a3 3 0 0 0 4.243 4.243L7 9.243"/></svg>
              Link
            </span>
          </TBtn>
          {showLink && (
            <LinkPopover
              onSet={(url) => {
                const sanitized = url.match(/^https?:\/\//) ? url : `https://${url}`;
                editor.chain().focus().setLink({ href: sanitized }).run();
                setShowLink(false);
              }}
              onClose={() => setShowLink(false)}
            />
          )}
        </div>
        {editor.isActive("link") && (
          <TBtn active={false} onMouseDown={() => editor.chain().focus().unsetLink().run()} title="Remove link">
            Unlink
          </TBtn>
        )}
        <span className="w-px h-4 bg-gray-300 mx-0.5" />
        <span className="text-[10px] text-[var(--twilio-gray-60)] select-none">@ mentions · @# records</span>
      </div>

      {/* Editor */}
      <div className="relative" onKeyDown={handleKeyDown}>
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none px-3 py-2.5 min-h-[80px] text-sm text-[var(--twilio-navy)] [&_.is-empty::before]:text-gray-400 [&_.is-empty::before]:italic [&_.is-empty::before]:float-left [&_.is-empty::before]:pointer-events-none [&_.is-empty::before]:content-[attr(data-placeholder)] [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-1.5"
        />

        {/* Mention dropdown */}
        {mentionMode && activeMentionItems.length > 0 && (
          <MentionDropdown
            items={activeMentionItems as Array<{ id: string | number; label: string }>}
            activeIdx={mentionActiveIdx}
            onSelect={(item) => {
              if (mentionMode === "user") insertMentionUser(item as { id: number; label: string });
              else insertMentionRef(item as { id: string; label: string; href: string });
            }}
          />
        )}
      </div>
    </div>
  );
}
