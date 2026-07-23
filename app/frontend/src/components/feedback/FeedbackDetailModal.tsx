import { useEffect, useState } from "react";
import { feedbackApi } from "../../lib/api";
import type { FeedbackItem, FeedbackComment } from "../../types";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  wont_fix: "Won't Fix",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  in_progress: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  wont_fix: "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

interface Props {
  item: FeedbackItem;
  onClose: () => void;
  onUpdated?: (item: FeedbackItem) => void;
  onDeleted?: (id: number) => void;
}

export default function FeedbackDetailModal({ item, onClose, onUpdated, onDeleted }: Props) {
  const [comments, setComments] = useState<FeedbackComment[]>(item.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState(item.status);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function postComment() {
    if (!newComment.trim()) return;
    setPosting(true);
    try {
      const { data } = await feedbackApi.addComment(item.id, newComment.trim());
      setComments(prev => [...prev, data]);
      setNewComment("");
    } catch { /* keep input */ }
    finally { setPosting(false); }
  }

  async function changeStatus(s: string) {
    setUpdatingStatus(true);
    try {
      const { data } = await feedbackApi.updateStatus(item.id, s);
      setStatus(data.status);
      onUpdated?.(data);
    } catch { /* silent */ }
    finally { setUpdatingStatus(false); }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this feedback item? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await feedbackApi.delete(item.id);
      onDeleted?.(item.id);
      onClose();
    } catch { /* silent */ }
    finally { setDeleting(false); }
  }

  function startEditComment(c: FeedbackComment) {
    setEditingCommentId(c.id);
    setEditingCommentText(c.content);
  }

  async function saveEditComment(id: number) {
    const trimmed = editingCommentText.trim();
    if (!trimmed) return;
    try {
      const { data } = await feedbackApi.updateComment(id, trimmed);
      setComments(prev => prev.map(c => c.id === id ? data : c));
    } catch { /* keep edit open */ }
    setEditingCommentId(null);
  }

  async function deleteComment(id: number) {
    try {
      await feedbackApi.deleteComment(id);
      setComments(prev => prev.filter(c => c.id !== id));
    } catch { /* silent */ }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.4)" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: 9001, width: 560, maxWidth: "calc(100vw - 32px)", maxHeight: "80vh",
        borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
        background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px 14px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLOR[status] ?? "bg-gray-100 text-gray-500"}`}>
                  {STATUS_LABEL[status] ?? status}
                </span>
                <span style={{ fontSize: "0.6875rem", color: "var(--twilio-gray-40)" }}>
                  {formatDate(item.created_at)}
                </span>
              </div>
              <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--twilio-navy)", margin: 0, lineHeight: 1.4 }}>
                {item.description.length > 100 ? item.description.slice(0, 100) + "…" : item.description}
              </p>
              <p style={{ fontSize: "0.75rem", color: "var(--twilio-gray-60)", marginTop: 2 }}>
                by {item.author_display}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                title="Delete feedback"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-40)", padding: 2, opacity: deleting ? 0.5 : 1 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-60)", padding: 2 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {/* Full description */}
          <p style={{ fontSize: "0.875rem", color: "var(--twilio-navy)", lineHeight: 1.6, marginBottom: 12, whiteSpace: "pre-wrap" }}>{item.description}</p>

          {/* Element / location */}
          {item.element_label && (
            <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "rgba(219,19,26,0.05)", border: "1px solid rgba(219,19,26,0.15)" }}>
              <p style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--twilio-red,#DB131A)", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Attached element</p>
              <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--twilio-navy)", margin: 0 }}>{item.element_label}</p>
              {item.element_path && <p style={{ fontSize: "0.6875rem", color: "var(--twilio-gray-60)", margin: "2px 0 0", fontFamily: "monospace" }}>{item.element_path}</p>}
              {item.page_url && <p style={{ fontSize: "0.6875rem", color: "var(--twilio-gray-60)", margin: "2px 0 0", wordBreak: "break-all" }}>{item.page_url}</p>}
            </div>
          )}

          {/* Attachment */}
          {item.attachment && (
            <div style={{ marginBottom: 12 }}>
              <a href={item.attachment} target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", color: "var(--twilio-red,#DB131A)", textDecoration: "none" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                View attachment
              </a>
            </div>
          )}

          {/* Status update */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-gray-60)", marginBottom: 6 }}>Update status</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["open", "in_progress", "resolved", "wont_fix"] as const).map(s => (
                <button
                  key={s}
                  disabled={updatingStatus || status === s}
                  onClick={() => changeStatus(s)}
                  style={{
                    padding: "4px 10px", borderRadius: 99, border: "1px solid",
                    fontSize: "0.75rem", fontWeight: 500, cursor: status === s ? "default" : "pointer",
                    fontFamily: "var(--font-base)", transition: "all 0.12s",
                    background: status === s ? "var(--twilio-red,#DB131A)" : "transparent",
                    color: status === s ? "#fff" : "var(--twilio-gray-60)",
                    borderColor: status === s ? "var(--twilio-red,#DB131A)" : "rgba(0,0,0,0.15)",
                    opacity: updatingStatus ? 0.6 : 1,
                  }}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Comments thread */}
          <div>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-gray-60)", marginBottom: 8 }}>
              Comments {comments.length > 0 && `(${comments.length})`}
            </p>
            {comments.length === 0 && (
              <p style={{ fontSize: "0.8125rem", color: "var(--twilio-gray-40)", fontStyle: "italic", marginBottom: 8 }}>No comments yet.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {comments.map(c => (
                <div key={c.id} style={{ padding: "8px 12px", borderRadius: 6, background: "var(--twilio-gray-10, #f4f4f6)", border: "1px solid var(--border, rgba(0,0,0,0.06))" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--twilio-navy)" }}>{c.author_display}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: "0.6875rem", color: "var(--twilio-gray-40)" }}>{formatDate(c.created_at)}</span>
                      {editingCommentId !== c.id && (
                        <>
                          <button
                            onClick={() => startEditComment(c)}
                            title="Edit comment"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-40)", padding: 0, lineHeight: 1 }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button
                            onClick={() => void deleteComment(c.id)}
                            title="Delete comment"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--twilio-gray-40)", padding: 0, lineHeight: 1 }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingCommentId === c.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <textarea
                        value={editingCommentText}
                        onChange={e => setEditingCommentText(e.target.value)}
                        rows={2}
                        autoFocus
                        style={{
                          resize: "vertical", padding: "6px 8px",
                          borderRadius: 4, border: "1px solid var(--border, rgba(0,0,0,0.12))",
                          fontSize: "0.875rem", fontFamily: "var(--font-base)", color: "var(--twilio-navy)",
                          background: "var(--surface, #fff)", outline: "none",
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEditComment(c.id);
                          if (e.key === "Escape") setEditingCommentId(null);
                        }}
                      />
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          onClick={() => setEditingCommentId(null)}
                          style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(0,0,0,0.12)", background: "transparent", fontSize: "0.75rem", cursor: "pointer", color: "var(--twilio-gray-60)" }}
                        >Cancel</button>
                        <button
                          onClick={() => void saveEditComment(c.id)}
                          disabled={!editingCommentText.trim()}
                          style={{ padding: "3px 10px", borderRadius: 4, border: "none", background: "var(--twilio-red,#DB131A)", color: "#fff", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}
                        >Save</button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "0.875rem", color: "var(--twilio-navy)", margin: 0, whiteSpace: "pre-wrap" }}>{c.content}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Add comment */}
            <div style={{ display: "flex", gap: 8 }}>
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Add a comment or update…"
                rows={2}
                style={{
                  flex: 1, resize: "vertical", padding: "7px 10px",
                  borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.12))",
                  fontSize: "0.875rem", fontFamily: "var(--font-base)", color: "var(--twilio-navy)",
                  background: "var(--surface, #fff)", outline: "none",
                }}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment(); }}
              />
              <button
                onClick={postComment}
                disabled={!newComment.trim() || posting}
                style={{
                  padding: "0 14px", borderRadius: 6, border: "none",
                  background: newComment.trim() ? "var(--twilio-red,#DB131A)" : "rgba(0,0,0,0.08)",
                  color: newComment.trim() ? "#fff" : "rgba(0,0,0,0.3)",
                  fontSize: "0.8125rem", fontWeight: 600,
                  cursor: newComment.trim() ? "pointer" : "not-allowed",
                  fontFamily: "var(--font-base)", alignSelf: "flex-end", height: 36,
                }}
              >
                {posting ? "…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
