import type { MeetingNotesSource } from "../../lib/api";

/**
 * Gong / Zoom switch for the meeting-summary panel.
 *
 * Lives in its own file because `AccountDetailPage` keeps a diverged local copy of
 * `GongSummaryPanel` (see CLAUDE.md — that page is additive-edits-only), and both
 * copies need the same control. Sharing the toggle keeps the two in step even though
 * the panels themselves are duplicated.
 */

export const MEETING_SUMMARY_SOURCES: readonly MeetingNotesSource[] = ["gong", "zoom"] as const;

const LABELS: Record<MeetingNotesSource, string> = { gong: "Gong", zoom: "Zoom" };

/**
 * Which source to show by default: Gong wins whenever it has content, otherwise Zoom
 * if only Zoom does. With neither populated we still land on Gong so the paste box
 * writes to the primary field.
 */
export function preferredMeetingSource(
  gongNotes?: string | null,
  zoomNotes?: string | null,
): MeetingNotesSource {
  if (gongNotes?.trim()) return "gong";
  if (zoomNotes?.trim()) return "zoom";
  return "gong";
}

export function MeetingSummarySourceToggle({
  value,
  onChange,
  hasGong,
  hasZoom,
}: {
  value: MeetingNotesSource;
  onChange: (source: MeetingNotesSource) => void;
  hasGong: boolean;
  hasZoom: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Meeting summary source"
      style={{
        display: "inline-flex",
        borderRadius: "5px",
        border: "1px solid rgba(0,0,0,0.1)",
        overflow: "hidden",
      }}
    >
      {MEETING_SUMMARY_SOURCES.map((source) => {
        const active = value === source;
        const populated = source === "gong" ? hasGong : hasZoom;
        return (
          <button
            key={source}
            type="button"
            onClick={() => onChange(source)}
            aria-pressed={active}
            data-source={source}
            data-active={active ? "true" : "false"}
            data-populated={populated ? "true" : "false"}
            title={populated ? `View ${LABELS[source]} notes` : `No ${LABELS[source]} notes yet`}
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              padding: "2px 8px",
              border: "none",
              cursor: "pointer",
              background: active ? "#6366f1" : "transparent",
              color: active ? "#fff" : "var(--twilio-gray-60)",
              // Empty sources stay clickable — that's how you paste the first Zoom
              // recap — but read as inactive so it's obvious which one holds content.
              opacity: active || populated ? 1 : 0.5,
            }}
          >
            {LABELS[source]}
          </button>
        );
      })}
    </div>
  );
}
