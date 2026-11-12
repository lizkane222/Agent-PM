/**
 * Chips for records attached to a chat message or sitting on a composer.
 * Shared so any chat surface (this page, the footer) shows attachments the same way.
 */
import { useState } from "react";
import type { ChatAttachment } from "../../lib/chatAttachments";

const TYPE_ICON: Record<string, string> = {
  account: "🏢",
  action_item: "✅",
  reminder: "⏰",
  calendar_event: "📅",
  meeting: "📅",
  team_member: "👤",
  note: "📝",
  document: "📄",
  lookup: "🔎",
  artifact: "📎",
};

export const attachmentIcon = (type: string): string => TYPE_ICON[type] ?? "📎";

export function AttachmentChip({
  attachment,
  onRemove,
  tone = "light",
}: {
  attachment: ChatAttachment;
  onRemove?: (a: ChatAttachment) => void;
  /** "onAccent" when the chip sits on a coloured bubble. */
  tone?: "light" | "onAccent";
}) {
  const [open, setOpen] = useState(false);
  const expandable = !!attachment.content && attachment.content.trim().length > 0;
  return (
    <div
      data-testid="attachment-chip"
      data-attachment-type={attachment.type}
      style={{
        display: "flex", flexDirection: "column", maxWidth: "100%", minWidth: 0,
        border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: 8,
        background: tone === "onAccent" ? "rgba(255,255,255,0.7)" : "var(--surface, #fff)",
        color: "var(--text-primary, #111)", fontSize: "0.75rem", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px" }}>
        <span aria-hidden style={{ flexShrink: 0 }}>{attachmentIcon(attachment.type)}</span>
        <button
          type="button"
          onClick={() => expandable && setOpen((v) => !v)}
          aria-expanded={expandable ? open : undefined}
          title={expandable ? (open ? "Hide full content" : "Show full content") : attachment.label}
          style={{
            all: "unset", cursor: expandable ? "pointer" : "default", display: "flex", flexDirection: "column",
            minWidth: 0, flex: 1,
          }}
        >
          <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {attachment.label}
          </span>
          {attachment.summary && (
            <span style={{ color: "var(--text-secondary, #777)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {attachment.summary}
            </span>
          )}
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${attachment.label}`}
            onClick={() => onRemove(attachment)}
            style={{ all: "unset", cursor: "pointer", padding: "0 2px", color: "var(--text-secondary, #888)" }}
          >
            ✕
          </button>
        )}
      </div>
      {open && expandable && (
        <pre
          data-testid="attachment-content"
          style={{
            margin: 0, padding: "6px 8px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))",
            maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "inherit",
            color: "var(--text-primary, #111)",
          }}
        >
          {attachment.content}
        </pre>
      )}
    </div>
  );
}

export function AttachmentList({
  attachments,
  onRemove,
  tone,
}: {
  attachments: ChatAttachment[];
  onRemove?: (a: ChatAttachment) => void;
  tone?: "light" | "onAccent";
}) {
  if (attachments.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} {...(onRemove ? { onRemove } : {})} {...(tone ? { tone } : {})} />
      ))}
    </div>
  );
}
