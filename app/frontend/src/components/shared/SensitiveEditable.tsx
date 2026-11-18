/**
 * <SensitiveEditable> -- wraps an EDITOR (textarea, input, rich-text field) so its field can
 * be hidden for screen sharing like read-only text can.
 *
 *   <SensitiveEditable resourceType="action_item" resourceId={item.id} field="task_details"
 *                      html={form.task_details}>
 *     <RichTextMentionEditor ... />
 *   </SensitiveEditable>
 *
 * - No marks on the field: renders `children` untouched (inside a `display: contents` div that
 *   only carries the right-click handler, so "Hide this line" / "Hide selected text" work in
 *   the editor too).
 * - Field is hidden: shows a masked, read-only view in place of the editor, with an explicit
 *   "Show to edit" button -- the editor (and therefore the text) only appears after the user
 *   asks for it, never by accident during a share. Selected-text marks mask inside that view.
 *
 * Display only: this masks the display in the app; the data is still stored and available via
 * the API and exports.
 */
import React, { useRef, useState } from "react";
import { isMarkableId, useSensitiveMarks } from "../../hooks/useSensitiveMarks";
import type { SensitiveResourceType } from "../../types/sensitive";
import { registerFieldContext } from "./sensitiveContext";
import SensitiveText from "./SensitiveText";

interface Props {
  resourceType: SensitiveResourceType;
  resourceId: string | number | null | undefined;
  field: string;
  lineKey?: string;
  /** Current value of the field: plain text, or HTML when `html` is true. */
  value: string;
  html?: boolean;
  children: React.ReactNode;
}

export default function SensitiveEditable({ resourceType, resourceId, field, lineKey = "", value, html, children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  const markable = isMarkableId(resourceId);
  const { marks, mark, unmark } = useSensitiveMarks(resourceType, resourceId);
  const hidden = markable && (marks ?? []).some((m) => m.field === field && (m.text !== "" || m.line_key === lineKey));

  if (hidden && !revealed) {
    return (
      <div className="rounded-lg border px-3 py-2 text-sm" data-sensitive-editable-hidden=""
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-subtle)", color: "var(--text-ink)" }}>
        {html
          ? <SensitiveText resourceType={resourceType} resourceId={resourceId} field={field} lineKey={lineKey} html={value} as="div" className="rich-text" />
          : <SensitiveText resourceType={resourceType} resourceId={resourceId} field={field} lineKey={lineKey} text={value} as="div" className="whitespace-pre-wrap" />}
        <button type="button" onClick={() => setRevealed(true)}
          className="mt-1 text-xs underline" style={{ color: "var(--text-ink)", opacity: 0.7 }}
          title="Shows the real text so you can edit it. Hiding only masks the display in the app; the data is still stored.">
          Show to edit
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ display: "contents" }}
      onContextMenu={markable ? (e) => { if (ref.current) registerFieldContext(e, ref.current, { isHtml: !!html, field, lineKey, mark, unmark }); } : undefined}>
      {children}
    </div>
  );
}
