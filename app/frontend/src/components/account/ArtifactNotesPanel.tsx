import { useMemo, useState } from "react";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useAppError } from "../../context/AppErrorContext";
import type { UseArtifactNotesResult } from "../../hooks/useArtifactNotes";
import type { AccountArtifact, ArtifactNote, CommentReference } from "../../types";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import SensitiveText from "../shared/SensitiveText";
import { bulletPlainText, NoteBulletActions } from "./NoteBulletActions";

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** Thread the flat list: roots newest first (the server's order), replies oldest first. */
export interface NoteNode { note: ArtifactNote; replies: NoteNode[] }

export function buildNoteTree(notes: ArtifactNote[]): NoteNode[] {
  const children = new Map<number, ArtifactNote[]>();
  const ids = new Set(notes.map((n) => n.id));
  const roots: ArtifactNote[] = [];
  for (const n of notes) {
    // A reply whose parent is not in the list (it was deleted) is shown as a root, not lost.
    if (n.parent != null && ids.has(n.parent)) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
    else roots.push(n);
  }
  const build = (n: ArtifactNote): NoteNode => ({
    note: n,
    replies: (children.get(n.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id).map(build),
  });
  return roots.map(build);
}

const MAX_INDENT_LEVELS = 4;

function NoteComposer({ placeholder, autoFocus, submitLabel, initialHtml = "", onSubmit, onCancel }: {
  placeholder: string;
  autoFocus?: boolean;
  submitLabel: string;
  initialHtml?: string;
  onSubmit: (html: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const empty = !bulletPlainText(html);

  async function submit() {
    if (empty || busy) return;
    setBusy(true);
    try {
      await onSubmit(html);
      setHtml("");
      setResetKey((k) => k + 1);
    } catch {
      // The caller already told the user; keep what they typed so nothing is lost.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <RichTextMentionEditor
        key={resetKey}
        value={html}
        onChange={setHtml}
        placeholder={placeholder}
        autoFocus={autoFocus}
        minHeightClassName="min-h-[56px]"
        onSubmit={() => void submit()}
      />
      <div className="flex gap-2 items-center">
        <button type="button" disabled={empty || busy} onClick={() => void submit()}
          className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white disabled:opacity-50">
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button type="button" disabled={busy} onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>}
        <span className="ml-auto text-[10px] text-gray-400">Enter to send · Shift+Enter for a new line</span>
      </div>
    </div>
  );
}

function NoteItem({ node, depth, artifact, notes, ctx }: {
  node: NoteNode;
  depth: number;
  artifact: AccountArtifact;
  notes: UseArtifactNotesResult;
  ctx: Pick<Props, "accountName" | "airtableAccountId" | "onLinked">;
}) {
  const { note, replies } = node;
  const me = useCurrentUser();
  const { reportError } = useAppError();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(true);
  const mine = !!me && me.id === note.author;
  const canDelete = mine || me?.access_level === "admin";
  const count = (function countAll(ns: NoteNode[]): number { return ns.reduce((n, r) => n + 1 + countAll(r.replies), 0); })(replies);

  async function guarded(fn: () => Promise<unknown>, failure: string) {
    try { await fn(); } catch { reportError(failure); throw new Error(failure); }
  }

  return (
    <div
      data-testid={`artifact-note-${note.id}`}
      className="group"
      style={{ marginLeft: depth > 0 && depth <= MAX_INDENT_LEVELS ? 12 : 0, borderLeft: depth > 0 && depth <= MAX_INDENT_LEVELS ? "2px solid var(--border-subtle)" : undefined, paddingLeft: depth > 0 && depth <= MAX_INDENT_LEVELS ? 10 : 0 }}
    >
      <div className="py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {(note.author_display || "?")[0].toUpperCase()}
          </span>
          <span className="text-xs font-semibold text-gray-800">{note.author_display}</span>
          <span className="text-[10px] text-gray-400" title={new Date(note.created_at).toLocaleString()}>{timeAgo(note.created_at)}</span>
          {note.updated_at !== note.created_at && <span className="text-[10px] text-gray-300 italic">edited</span>}
          {!editing && (
            <span className="ml-auto flex items-center">
              <NoteBulletActions
                text={note.text || bulletPlainText(note.html)}
                copyable
                source={{ resourceType: "artifact", resourceId: artifact.id, label: artifact.name, url: artifact.file_url ?? artifact.url, accountId: artifact.account }}
                onLinked={ctx.onLinked}
                accountName={ctx.accountName}
                airtableAccountId={ctx.airtableAccountId}
              />
            </span>
          )}
        </div>

        {editing ? (
          <NoteComposer
            placeholder="Edit note…" autoFocus submitLabel="Save" initialHtml={note.html}
            onCancel={() => setEditing(false)}
            onSubmit={async (html) => { await guarded(() => notes.editNote(note.id, html), "Could not save the note."); setEditing(false); }}
          />
        ) : (
          <SensitiveText resourceType="artifact_note" resourceId={note.id} field="html" html={note.html} as="div"
            className="rich-text text-sm text-gray-700 leading-relaxed min-w-0" style={{ overflowWrap: "anywhere" }} />
        )}

        {!editing && (
          <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
            <button type="button" className="hover:text-indigo-600" onClick={() => setReplying((r) => !r)}>Reply</button>
            {mine && <button type="button" className="hover:text-indigo-600" onClick={() => setEditing(true)}>Edit</button>}
            {canDelete && (
              <button type="button" className="hover:text-red-500"
                onClick={() => { if (window.confirm(count ? `Delete this note and its ${count} repl${count === 1 ? "y" : "ies"}?` : "Delete this note?")) void guarded(() => notes.removeNote(note.id), "Could not delete the note.").catch(() => {}); }}>
                Delete
              </button>
            )}
            {count > 0 && (
              <button type="button" aria-expanded={open} className="ml-auto hover:text-indigo-600" onClick={() => setOpen((o) => !o)}>
                {open ? `Hide ${count} repl${count === 1 ? "y" : "ies"}` : `Show ${count} repl${count === 1 ? "y" : "ies"}`}
              </button>
            )}
          </div>
        )}

        {replying && (
          <div className="mt-2 pl-3 border-l-2 border-indigo-200">
            <p className="text-[10px] text-indigo-500 mb-1">Replying to {note.author_display}</p>
            <NoteComposer
              placeholder="Write a reply…" autoFocus submitLabel="Reply" onCancel={() => setReplying(false)}
              onSubmit={async (html) => { await guarded(() => notes.addNote(html, note.id), "Could not post the reply."); setReplying(false); setOpen(true); }}
            />
          </div>
        )}
      </div>

      {open && replies.map((r) => (
        <NoteItem key={r.note.id} node={r} depth={depth + 1} artifact={artifact} notes={notes} ctx={ctx} />
      ))}
    </div>
  );
}

interface Props {
  artifact: AccountArtifact;
  notes: UseArtifactNotesResult;
  accountName?: string | null;
  airtableAccountId?: number | null;
  /** A record one of the action buttons just linked to this artifact. */
  onLinked?: (ref: CommentReference) => void;
}

/** Notes on an artifact: history (newest first), compose, threaded replies, edit/delete, action buttons. */
export default function ArtifactNotesPanel({ artifact, notes, accountName, airtableAccountId, onLinked }: Props) {
  const { reportError } = useAppError();
  const tree = useMemo(() => buildNoteTree(notes.data), [notes.data]);
  const ctx = { accountName, airtableAccountId, onLinked };

  return (
    <div data-testid="artifact-notes">
      <NoteComposer
        placeholder="Add a note about this artifact…" submitLabel="Add note"
        onSubmit={async (html) => {
          try { await notes.addNote(html); } catch (e) { reportError("Could not add the note."); throw e; }
        }}
      />
      <div className="mt-3 divide-y divide-gray-100">
        {notes.loading && notes.data.length === 0 && <p className="text-xs text-gray-400 py-3 text-center">Loading…</p>}
        {notes.error && <p role="alert" className="text-xs text-red-500 py-3 text-center">Could not load the notes.</p>}
        {!notes.loading && !notes.error && tree.length === 0 && (
          <p className="text-xs text-gray-400 py-3 text-center italic">No notes yet.</p>
        )}
        {tree.map((node) => (
          <NoteItem key={node.note.id} node={node} depth={0} artifact={artifact} notes={notes} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
