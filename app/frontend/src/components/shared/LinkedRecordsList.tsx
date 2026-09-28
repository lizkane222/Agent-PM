import { useNavigate } from "react-router-dom";
import type { CommentReference, CommentResourceType } from "../../types";

/**
 * Renders a `CommentReference[]` as a labelled chip list, grouped by record type.
 *
 * Every reference already carries a ready-to-use app-relative `url` (the backend's
 * `used_in_map` builds them, and the @# picker captures them), so a chip navigates
 * with `navigate(ref.url)` and `resource_type` is only ever used for the group
 * heading — the same split `CommentPanel` / `ReferenceLink` already use.
 */

const TYPE_LABELS: Record<CommentResourceType, string> = {
  account: "Accounts",
  airtable_account: "Accounts",
  action_item: "Action items",
  action_item_step: "Steps",
  meeting: "Meetings",
  calendar_event: "Meetings",
  reminder: "Reminders",
  task: "Tasks",
  account_note: "Notes",
  artifact: "Artifacts",
  meeting_note: "Meeting notes",
  claude_skill: "Skills",
  goal: "Goals",
  project: "Projects",
};

// Meetings first, then the containers, then the work — the order the account page
// already presents these in.
const GROUP_ORDER = [
  "Meetings", "Projects", "Goals", "Action items", "Steps",
  "Notes", "Meeting notes", "Reminders", "Tasks", "Artifacts", "Accounts", "Skills",
];

function labelFor(type: CommentResourceType): string {
  return TYPE_LABELS[type] ?? "Records";
}

export default function LinkedRecordsList({
  title,
  references,
  className,
}: {
  title: string;
  references: CommentReference[];
  className?: string;
}) {
  const navigate = useNavigate();
  if (!references.length) return null;

  const byGroup = new Map<string, CommentReference[]>();
  for (const ref of references) {
    const key = labelFor(ref.resource_type);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(ref);
    else byGroup.set(key, [ref]);
  }
  const groups = [...byGroup.entries()].sort(
    (a, b) => (GROUP_ORDER.indexOf(a[0]) + 1 || 99) - (GROUP_ORDER.indexOf(b[0]) + 1 || 99),
  );

  return (
    <div className={className}>
      <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">{title}</p>
      {groups.map(([group, refs]) => (
        <div key={group} className="mt-1">
          <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">{group}</p>
          <div className="mt-0.5 space-y-1">
            {refs.map((ref) => (
              <button
                key={`${ref.resource_type}-${ref.resource_id}`}
                type="button"
                onClick={() => navigate(ref.url)}
                title={`Open ${ref.label}`}
                className="group w-full flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-gray-200 text-[11px] text-left hover:border-indigo-300 transition-colors"
              >
                <span className="truncate text-[var(--twilio-navy)]">{ref.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
