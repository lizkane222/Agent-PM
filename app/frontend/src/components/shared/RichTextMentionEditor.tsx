/**
 * RichTextMentionEditor — shared TipTap rich-text editor with @mention (team
 * member) and @#reference (any searchable record) autocomplete.
 *
 * Used everywhere a note or description needs rich text: account notes,
 * contact notes, meeting notes, action item descriptions, and comments.
 */
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { BulletList, OrderedList, ListItem, TaskList, TaskItem } from "@tiptap/extension-list";
// TipTap v3 moved Placeholder into @tiptap/extensions (named export). The old
// `@tiptap/extension-placeholder` package was never declared in package.json — it
// only existed as a stray folder in node_modules, so the build worked locally but
// any clean `npm ci` would have failed on it.
import { Placeholder } from "@tiptap/extensions";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { teamApi, searchApi, type SearchResult } from "../../lib/api";
import { plainToHtml } from "../../lib/noteHelpers";
import type { TeamMember, CommentReference } from "../../types";

export { plainToHtml };

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

// ── Mention / reference dropdown ──────────────────────────────────────────────

/** `search/views.py::global_search` short-circuits to [] below this length. */
const REF_MIN_QUERY = 2;
/** Rough dropdown height, used only to pick above/below placement. */
const MENU_EST_HEIGHT = 240;

interface UserItem { kind: "user"; id: number; label: string; member: TeamMember }
interface RefItem { kind: "ref"; id: string; label: string; href: string; result: SearchResult }
type MentionItem = UserItem | RefItem;

function MentionDropdown({
  items,
  activeIdx,
  onSelect,
  selectedIds,
  multiHeader,
  statusNode,
  placement,
}: {
  items: MentionItem[];
  activeIdx: number;
  onSelect: (item: MentionItem) => void;
  selectedIds?: Set<string>;
  multiHeader?: React.ReactNode;
  /** Shown instead of / above the list: "Searching…", "Type to search", "No
   * results". Without it a query that matches nothing renders nothing at all,
   * which reads as "@# is broken" rather than "nothing matched". */
  statusNode?: React.ReactNode;
  placement: "above" | "below";
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    // Optional call: scrollIntoView is absent in jsdom, and keeping the arrow
    // keys working matters more than the scroll.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIdx]);
  if (!items.length && !multiHeader && !statusNode) return null;
  return (
    <div
      data-mention-dropdown
      data-placement={placement}
      // z-[100] rather than z-50: this editor is mounted inside modals and side
      // panels that establish their own stacking contexts at z-50.
      className={`absolute left-0 z-[100] bg-white border border-gray-200 rounded-lg shadow-xl min-w-[220px] ${
        placement === "above" ? "bottom-full mb-1" : "top-full mt-1"
      }`}
    >
      {multiHeader}
      {statusNode}
      <div ref={listRef} className="max-h-44 overflow-y-auto">
        {items.map((item, i) => {
          const selected = selectedIds?.has(String(item.id));
          return (
            <button
              key={item.kind === "user" ? `u${item.id}` : `r${item.id}`}
              data-idx={i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-1.5 ${
                i === activeIdx ? "bg-indigo-50 text-indigo-700 font-semibold" : "hover:bg-gray-50"
              }`}
            >
              {selectedIds && (
                <span className={`flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${
                  selected ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                }`}>
                  {selected && (
                    <svg viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.8" className="w-2.5 h-2">
                      <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              )}
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

export interface RichTextMentionEditorHandle {
  clear: () => void;
}

export interface RichTextMentionEditorProps {
  value: string; // HTML (or legacy plain text — converted on mount)
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minHeightClassName?: string; // default "min-h-[80px]"
  onKeyDownCapture?: (e: React.KeyboardEvent) => void;
  /** When provided, a bare Enter submits (adds the note) and Shift+Enter
   * inserts a line break. Must go through a TipTap keyboard extension rather
   * than `onKeyDownCapture`: ProseMirror's own DOM listener runs before any
   * React handler on an ancestor, so `preventDefault()` there is too late to
   * stop a paragraph being inserted. Omit the prop to keep Enter as a newline
   * (description/detail fields). */
  onSubmit?: () => void;
  /** When true, @# opens a multiselect picker (Comments UX): pick several
   * records, then confirm to insert them all as bullet lines at once. */
  refMultiSelect?: boolean;
  /** Fired when the editor loses focus. Used by the notepads, which autosave on
   * blur. Picking a mention does NOT blur: the dropdown items preventDefault on
   * mousedown, so focus never leaves the contenteditable. */
  onBlur?: () => void;
  /** Fired when a user mention is inserted into the content. */
  onMentionSelect?: (member: TeamMember) => void;
  /** Fired once per record reference inserted (single mode: on select;
   * multiselect mode: once per item, when the selection is confirmed). */
  onReferenceSelect?: (result: SearchResult) => void;
  /** Fired with structured reference data when a record reference is inserted.
   * Only called when refMultiSelect is true (comment mode). */
  onReferenceInsert?: (reference: CommentReference) => void;
}

const RichTextMentionEditor = forwardRef<RichTextMentionEditorHandle, RichTextMentionEditorProps>(
  function RichTextMentionEditor(
    { value, onChange, placeholder, autoFocus, minHeightClassName, onKeyDownCapture, onSubmit, onBlur, refMultiSelect, onMentionSelect, onReferenceSelect, onReferenceInsert },
    ref
  ) {
    const [showLink, setShowLink] = useState(false);

    // @mention state
    type MentionMode = "user" | "ref" | null;
    const [mentionMode, setMentionMode] = useState<MentionMode>(null);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionAnchorPos, setMentionAnchorPos] = useState(0);
    const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
    const [allMembers, setAllMembers] = useState<TeamMember[]>([]);
    const [refResults, setRefResults] = useState<SearchResult[]>([]);
    const [refLoading, setRefLoading] = useState(false);
    const [pendingRefs, setPendingRefs] = useState<SearchResult[]>([]);
    // The dropdown opens upward by default, but an editor near the top of a
    // scroll container has no room there — flip it rather than render offscreen.
    const [placement, setPlacement] = useState<"above" | "below">("above");
    const editorAreaRef = useRef<HTMLDivElement>(null);

    // Load team members once
    useEffect(() => {
      teamApi.listMembers({ page_size: "200" })
        .then((r) => setAllMembers(r.data.results))
        .catch(() => {});
    }, []);

    const userItems: UserItem[] = mentionMode === "user"
      ? allMembers
          .filter((m) => {
            const q = mentionQuery.toLowerCase();
            return !q || m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
          })
          .map((m) => ({ kind: "user", id: m.id, label: m.full_name, member: m }))
      : [];

    const refItems: RefItem[] = mentionMode === "ref"
      ? refResults.map((r) => ({ kind: "ref", id: String(r.id), label: r.title, href: r.url ?? "", result: r }))
      : [];

    useEffect(() => { setMentionActiveIdx(0); }, [mentionMode, mentionQuery]);

    // Debounced record reference search. `search/views.py::global_search`
    // returns an empty list for a term under 2 characters, so gate here rather
    // than spending a request that can only come back empty.
    const refQueryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
      if (mentionMode !== "ref") { setRefResults([]); setRefLoading(false); return; }
      if (mentionQuery.trim().length < REF_MIN_QUERY) {
        setRefResults([]);
        setRefLoading(false);
        return;
      }
      if (refQueryRef.current) clearTimeout(refQueryRef.current);
      setRefLoading(true);
      refQueryRef.current = setTimeout(() => {
        searchApi.search(mentionQuery)
          .then((r) => setRefResults(r.data.results ?? []))
          .catch(() => setRefResults([]))
          .finally(() => setRefLoading(false));
      }, 200);
      return () => { if (refQueryRef.current) clearTimeout(refQueryRef.current); };
    }, [mentionMode, mentionQuery]);

    // Flip the dropdown below the editor when there isn't room above it.
    useEffect(() => {
      if (!mentionMode) return;
      const rect = editorAreaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      setPlacement(spaceAbove < MENU_EST_HEIGHT && spaceBelow > spaceAbove ? "below" : "above");
    }, [mentionMode, mentionQuery]);

    const dismissMention = useCallback(() => {
      setMentionMode(null);
      setMentionQuery("");
      setMentionAnchorPos(0);
      setPendingRefs([]);
    }, []);

    // The editor is built once, so the Enter shortcut reads both of these
    // through refs rather than closing over a stale render.
    const submitRef = useRef(onSubmit);
    useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
    const blurRef = useRef(onBlur);
    useEffect(() => { blurRef.current = onBlur; }, [onBlur]);
    const mentionOpenRef = useRef(false);
    useEffect(() => { mentionOpenRef.current = mentionMode !== null; }, [mentionMode]);

    const SubmitOnEnter = useMemo(() => Extension.create({
      name: "submitOnEnter",
      // Outrank ListItem/TaskItem (priority 100) so Enter adds the note even
      // mid-bullet, rather than splitting the list item.
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Enter: () => {
            // While the @mention dropdown is open it owns Enter (see
            // handleKeyDown). Swallow the key so selecting a mention can't
            // submit the note or leave a stray paragraph behind.
            if (mentionOpenRef.current) return true;
            if (!submitRef.current) return false;
            submitRef.current();
            return true;
          },
        };
      },
    }), []);

    const editor = useEditor({
      extensions: [
        SubmitOnEnter,
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
      autofocus: autoFocus ?? false,
      onBlur() {
        blurRef.current?.();
      },
      onUpdate({ editor }) {
        // Empty TipTap docs serialize to "<p></p>", which is truthy — send ""
        // so existing `if (value.task_details)`-style guards stay accurate.
        onChange(editor.isEmpty ? "" : editor.getHTML());

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

    useImperativeHandle(ref, () => ({
      clear: () => {
        editor?.commands.clearContent();
      },
    }), [editor]);

    // Sync external value changes (e.g. form reset)
    useEffect(() => {
      if (!editor) return;
      const html = plainToHtml(value);
      if (html !== editor.getHTML()) editor.commands.setContent(html, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const insertMentionUser = useCallback((item: UserItem) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      editor.chain()
        .deleteRange({ from: mentionAnchorPos, to: from })
        .insertContent(`@${item.label} `)
        .run();
      onMentionSelect?.(item.member);
      dismissMention();
    }, [editor, mentionAnchorPos, dismissMention, onMentionSelect]);

    const insertMentionRef = useCallback((item: RefItem) => {
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
      onReferenceSelect?.(item.result);
      if (onReferenceInsert && !refMultiSelect) {
        const ref: CommentReference = {
          resource_type: item.result.type as CommentReference["resource_type"],
          resource_id: typeof item.result.id === "number" ? item.result.id : parseInt(String(item.result.id), 10),
          label: item.result.title,
          url: item.result.url || "",
        };
        onReferenceInsert(ref);
      }
      dismissMention();
    }, [editor, mentionAnchorPos, dismissMention, onReferenceSelect, onReferenceInsert, refMultiSelect]);

    const togglePendingRef = useCallback((item: RefItem) => {
      setPendingRefs((prev) => {
        const exists = prev.find((r) => String(r.id) === item.id);
        return exists ? prev.filter((r) => String(r.id) !== item.id) : [...prev, item.result];
      });
    }, []);

    const confirmPendingRefs = useCallback(() => {
      if (!editor || pendingRefs.length === 0) { dismissMention(); return; }
      const { from } = editor.state.selection;
      const bulletsHtml = pendingRefs.map((r) => `<p>• ${r.title}</p>`).join("");
      editor.chain()
        .deleteRange({ from: mentionAnchorPos, to: from })
        .insertContent(bulletsHtml)
        .run();
      pendingRefs.forEach((r) => {
        onReferenceSelect?.(r);
        if (onReferenceInsert) {
          const ref: CommentReference = {
            resource_type: r.type as CommentReference["resource_type"],
            resource_id: typeof r.id === "number" ? r.id : parseInt(String(r.id), 10),
            label: r.title,
            url: r.url || "",
          };
          onReferenceInsert(ref);
        }
      });
      dismissMention();
    }, [editor, mentionAnchorPos, pendingRefs, dismissMention, onReferenceSelect, onReferenceInsert]);

    const selectRefItem = useCallback((item: RefItem) => {
      if (refMultiSelect) togglePendingRef(item);
      else insertMentionRef(item);
    }, [refMultiSelect, togglePendingRef, insertMentionRef]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      onKeyDownCapture?.(e);
      if (!mentionMode) return;
      const items: MentionItem[] = mentionMode === "user" ? userItems : refItems;
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionActiveIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0))); }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionActiveIdx((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = items[mentionActiveIdx];
        if (mentionMode === "ref" && refMultiSelect) {
          if (selected) togglePendingRef(selected as RefItem);
        } else if (selected) {
          if (mentionMode === "user") insertMentionUser(selected as UserItem);
          else insertMentionRef(selected as RefItem);
        }
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (mentionMode === "ref" && refMultiSelect) {
          confirmPendingRefs();
        } else {
          const selected = items[mentionActiveIdx];
          if (selected) {
            if (mentionMode === "user") insertMentionUser(selected as UserItem);
            else insertMentionRef(selected as RefItem);
          }
        }
      }
      if (e.key === "Escape") { e.preventDefault(); dismissMention(); }
    }, [
      onKeyDownCapture, mentionMode, userItems, refItems, mentionActiveIdx, refMultiSelect,
      togglePendingRef, insertMentionUser, insertMentionRef, confirmPendingRefs, dismissMention,
    ]);

    if (!editor) return null;

    const activeItems: MentionItem[] = mentionMode === "user" ? userItems : refItems;
    const selectedIds = mentionMode === "ref" && refMultiSelect
      ? new Set(pendingRefs.map((r) => String(r.id)))
      : undefined;
    const multiHeader = mentionMode === "ref" && refMultiSelect && pendingRefs.length > 0 ? (
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 bg-indigo-50">
        <span className="text-xs text-indigo-700 font-medium">{pendingRefs.length} selected</span>
        <button
          type="button"
          className="text-xs font-semibold text-white bg-indigo-600 rounded-lg px-3 py-1 hover:bg-indigo-700"
          onMouseDown={(e) => { e.preventDefault(); confirmPendingRefs(); }}
        >
          Add references — Tab
        </button>
      </div>
    ) : undefined;

    // @# always reports what it is doing. Without this the dropdown rendered
    // nothing until a query matched, so typing "@#" looked like a dead key.
    const refStatusNode = mentionMode === "ref" ? (
      refLoading ? (
        <p className="text-xs text-gray-400 px-3 py-2">Searching…</p>
      ) : mentionQuery.trim().length < REF_MIN_QUERY ? (
        <p className="text-xs text-gray-400 px-3 py-2">
          Type at least {REF_MIN_QUERY} characters to search records…
        </p>
      ) : refItems.length === 0 ? (
        <p className="text-xs text-gray-400 px-3 py-2">No results for “{mentionQuery}”</p>
      ) : undefined
    ) : undefined;

    return (
      // Deliberately no focus-within ring/border on the wrapper: the blue box
      // was painted here rather than on the contenteditable, so the index.css
      // text-entry focus reset can't reach it. The caret signals focus.
      <div className="relative border border-gray-200 rounded-lg overflow-visible bg-white">
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
        <div ref={editorAreaRef} className="relative" onKeyDown={handleKeyDown}>
          <EditorContent
            editor={editor}
            className={`prose prose-sm max-w-none px-3 py-2.5 text-sm text-[var(--twilio-navy)] [&_.is-empty::before]:text-gray-400 [&_.is-empty::before]:italic [&_.is-empty::before]:float-left [&_.is-empty::before]:pointer-events-none [&_.is-empty::before]:content-[attr(data-placeholder)] [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-1.5 ${minHeightClassName ?? "min-h-[80px]"}`}
          />

          {/* Mention dropdown */}
          {mentionMode && (activeItems.length > 0 || multiHeader || refStatusNode) && (
            <MentionDropdown
              items={activeItems}
              activeIdx={mentionActiveIdx}
              selectedIds={selectedIds}
              multiHeader={multiHeader}
              statusNode={refStatusNode}
              placement={placement}
              onSelect={(item) => {
                if (item.kind === "user") insertMentionUser(item);
                else selectRefItem(item);
              }}
            />
          )}
        </div>
      </div>
    );
  }
);

export default RichTextMentionEditor;
