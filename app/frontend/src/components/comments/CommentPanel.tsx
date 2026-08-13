/**
 * CommentPanel — tooltip-style panel that shows threaded comments for any resource.
 *
 * Renders as a floating popover anchored to the trigger element.
 * Top-level comments scroll; replies are indented below each parent.
 * "Reply" button opens an inline reply composer.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Comment, CommentResourceType } from "../../types";
import { useComments } from "./useComments";
import { useCurrentUser } from "../../context/CurrentUserContext";
// useCurrentUser returns UserProfile | null directly
import CommentComposer from "./CommentComposer";

interface Props {
  resourceType: CommentResourceType;
  resourceId: number;
  resourceLabel?: string;
  anchorEl?: HTMLElement | null;
  onClose: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function CommentRow({
  comment,
  onReply,
  onEdit,
  onDelete,
  currentUserId,
  depth = 0,
}: {
  comment: Comment;
  onReply: (parentId: number) => void;
  onEdit: (id: number, content: string) => void;
  onDelete: (id: number) => void;
  currentUserId: number | null;
  depth?: number;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const isMine = currentUserId === comment.author;

  return (
    <div
      className="group"
      style={{ marginLeft: depth > 0 ? "1.5rem" : 0, borderLeft: depth > 0 ? "2px solid #e5e7eb" : undefined, paddingLeft: depth > 0 ? "0.75rem" : 0 }}
    >
      <div className="py-2">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {(comment.author_display || "?")[0].toUpperCase()}
          </span>
          <span className="text-xs font-semibold text-gray-800">{comment.author_display}</span>
          <span className="text-[10px] text-gray-400">{timeAgo(comment.created_at)}</span>
          {comment.updated_at !== comment.created_at && (
            <span className="text-[10px] text-gray-300 italic">edited</span>
          )}
          {isMine && !editing && (
            <span className="ml-auto flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="text-[10px] text-gray-400 hover:text-indigo-600"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              <button
                className="text-[10px] text-gray-400 hover:text-red-500"
                onClick={() => onDelete(comment.id)}
              >
                Delete
              </button>
            </span>
          )}
        </div>

        {/* Content */}
        {editing ? (
          <div className="mt-1">
            <textarea
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-300 resize-none"
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onEdit(comment.id, editText);
                  setEditing(false);
                }
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <div className="flex gap-2 mt-1">
              <button
                className="text-xs font-semibold text-white bg-indigo-600 rounded px-2 py-0.5 hover:bg-indigo-700"
                onClick={() => { onEdit(comment.id, editText); setEditing(false); }}
              >Save</button>
              <button
                className="text-xs text-gray-400 hover:text-gray-600"
                onClick={() => setEditing(false)}
              >Cancel</button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {renderContent(comment.content, comment.references, navigate)}
          </div>
        )}

        {/* References */}
        {!editing && comment.references.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {comment.references.map((ref) => (
              <li key={`${ref.resource_type}:${ref.resource_id}`} className="text-xs">
                <button
                  className="text-indigo-600 hover:underline hover:text-indigo-800"
                  onClick={() => navigate(ref.url)}
                >
                  • {ref.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Reply button (only on top-level) */}
        {depth === 0 && !editing && (
          <button
            className="text-[10px] text-gray-400 hover:text-indigo-600 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onReply(comment.id)}
          >
            Reply
          </button>
        )}
      </div>

      {/* Replies */}
      {comment.replies?.map((reply) => (
        <CommentRow
          key={reply.id}
          comment={reply}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          currentUserId={currentUserId}
          depth={1}
        />
      ))}
    </div>
  );
}

function renderContent(
  content: string,
  _refs: Comment["references"],
  _navigate: ReturnType<typeof useNavigate>
): React.ReactNode {
  const parts = content.split(/(https?:\/\/[^\s)>\]]+|@\w+)/g);
  return parts.map((part, i) => {
    if (part.match(/^https?:\/\//))
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{part}</a>;
    if (part.startsWith("@"))
      return <span key={i} className="text-indigo-600 font-medium">{part}</span>;
    return part;
  });
}

export default function CommentPanel({ resourceType, resourceId, resourceLabel, onClose }: Props) {
  const { comments, loading, addComment, editComment, deleteComment } = useComments(resourceType, resourceId);
  const currentUser = useCurrentUser();
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Scroll to bottom when new comments added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  return (
    <div
      ref={panelRef}
      className="flex flex-col rounded-2xl shadow-2xl border border-gray-200 bg-white overflow-hidden"
      style={{ width: 360, maxHeight: 520, zIndex: 9999 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
        <div>
          <span className="text-xs font-semibold text-gray-700">Comments</span>
          {resourceLabel && (
            <span className="ml-2 text-[10px] text-gray-400 truncate max-w-[180px]">{resourceLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">{comments.length} comment{comments.length !== 1 ? "s" : ""}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded p-0.5">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
              <path d="M1 1l10 10M11 1L1 11" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-gray-50 min-h-0">
        {loading && (
          <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
        )}
        {!loading && comments.length === 0 && (
          <p className="text-xs text-gray-400 py-6 text-center">No comments yet. Be the first!</p>
        )}
        {comments.map((comment) => (
          <div key={comment.id}>
            <CommentRow
              comment={comment}
              onReply={(parentId) => setReplyTo(parentId === replyTo ? null : parentId)}
              onEdit={editComment}
              onDelete={deleteComment}
              currentUserId={currentUser?.id ?? null}
            />
            {/* Inline reply composer */}
            {replyTo === comment.id && (
              <div className="mt-1 mb-2 pl-6 border-l-2 border-indigo-200">
                <p className="text-[10px] text-indigo-500 mb-1">Replying to {comment.author_display}</p>
                <CommentComposer
                  placeholder="Write a reply…"
                  autoFocus
                  onCancel={() => setReplyTo(null)}
                  onSubmit={async (opts) => {
                    await addComment({ ...opts, parentId: comment.id, resourceLabel });
                    setReplyTo(null);
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New comment composer */}
      <div className="border-t border-gray-100 px-4 py-3">
        <CommentComposer
          placeholder="Add a comment…"
          onSubmit={async (opts) => {
            await addComment({ ...opts, resourceLabel });
          }}
        />
      </div>
    </div>
  );
}
