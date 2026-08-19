import { SIDEBAR_GROUPS, type SidebarGroupKey } from "../../lib/actionItemSidebarOrder";
import { readableTextColor, tint } from "../../lib/eventColors";

/**
 * The multi-select filter chip row above the action-items sidebar list.
 *
 * One chip per group, driven off `SIDEBAR_GROUPS` so a chip can never exist without a matching
 * section. Multi-select with union semantics: nothing ticked shows everything.
 *
 * Shared by both copies of the sidebar (`pages/CalendarPage.tsx`'s live one and
 * `components/calendar/ActionItemsSidebar.tsx`), which is why the accent arrives as a prop —
 * CalendarPage paints itself from the user's chosen action-item color, the twin uses the
 * hardcoded violet.
 */
export default function SidebarFilterFlags({ selected, onToggle, onClear, accent }: {
  selected: Set<SidebarGroupKey>;
  onToggle: (key: SidebarGroupKey) => void;
  onClear: () => void;
  accent: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by">
      {SIDEBAR_GROUPS.map(({ key, flagLabel }) => {
        const isOn = selected.has(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isOn}
            data-flag={key}
            onClick={() => onToggle(key)}
            title={`Filter: ${flagLabel}`}
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors"
            style={
              isOn
                ? { background: accent, color: readableTextColor(accent), border: `1px solid ${accent}` }
                : { background: tint(accent, 0.88), color: "var(--twilio-navy)", border: "1px solid #e5e7eb" }
            }
          >
            {flagLabel}
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-700 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
