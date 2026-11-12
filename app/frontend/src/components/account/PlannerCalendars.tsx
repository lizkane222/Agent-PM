import { formatWindowInZone, type Interval } from "../../lib/overlapPlanner";
import type { PersonAvailability } from "../../lib/availability";

export interface CalendarMember { name: string; email: string; color: string }

const COL_W = 132;
const BODY_H = 240;

/**
 * Read-only day view of the selected Twilio team members' calendars, restricted to the planner's
 * meeting window. Data comes from the one availability request the planner already makes for the
 * day; dragging the window only re-slices it here. Titles appear only where the API says they are
 * visible (meetings on an account both people share); everything else is "Busy".
 */
export default function PlannerCalendars({
  members, people, win, viewerZone, loading, error, onRetry, scrollable,
}: {
  members: CalendarMember[];
  people: PersonAvailability[];
  win: Interval;
  viewerZone: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Small screens: the columns sit to the right of the bars inside the horizontal scroller. */
  scrollable: boolean;
}) {
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p]));
  const len = win.endMs - win.startMs;
  return (
    <div data-testid="planner-calendars" data-layout={scrollable ? "scroll" : "side"} className={scrollable ? "pl-3" : "min-w-0"}>
      <p className="mb-1 text-[11px] font-semibold text-[var(--twilio-navy)]">
        Team calendars <span className="font-normal text-[var(--twilio-gray-60)]">{formatWindowInZone(win.startMs, win.endMs, viewerZone)}</span>
      </p>
      {loading && <p data-testid="planner-cal-loading" className="mb-1 text-[11px] text-[var(--twilio-gray-60)]">Loading calendars...</p>}
      {error && (
        <p role="alert" data-testid="planner-cal-error" className="mb-1 text-[11px] text-red-600">
          {error}. <button type="button" onClick={onRetry} className="underline">Retry</button>
        </p>
      )}
      <div className="flex gap-2 overflow-x-auto">
        {members.map((m) => {
          const a = byEmail.get(m.email);
          const blocks = (a && !a.error ? a.busy : [])
            .filter((b) => !b.all_day)
            .map((b) => ({ b, s: Date.parse(b.start), e: Date.parse(b.end) }))
            .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > win.startMs && x.s < win.endMs && x.e > x.s)
            .map((x) => ({ ...x, cs: Math.max(x.s, win.startMs), ce: Math.min(x.e, win.endMs) }));
          return (
            <div key={m.email} data-testid="planner-cal-col" data-person={m.name} style={{ width: COL_W, flex: "none" }}>
              <div className="truncate rounded-t px-1 py-0.5 text-[11px] font-semibold text-white" style={{ background: m.color }} title={m.name}>{m.name}</div>
              <div className="relative rounded-b border border-gray-200 bg-gray-50" style={{ height: BODY_H }}>
                {a?.error ? (
                  <p data-testid="planner-cal-unavailable" className="p-1 text-[10px] text-amber-700">Calendar not available</p>
                ) : !a ? (
                  <p className="p-1 text-[10px] text-[var(--twilio-gray-60)]">{loading ? "Loading..." : error ? "Not loaded" : ""}</p>
                ) : blocks.length === 0 ? (
                  <p data-testid="planner-cal-empty" className="p-1 text-[10px] text-[var(--twilio-gray-60)]">No events in this window</p>
                ) : blocks.map((x, i) => {
                  const label = x.b.title_visible && x.b.title ? x.b.title : "Busy";
                  return (
                    <div
                      key={`${x.s}-${i}`}
                      data-testid="planner-cal-event"
                      data-title={label}
                      title={`${label} ${formatWindowInZone(x.s, x.e, viewerZone)}`}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded px-1 text-[10px] leading-tight"
                      style={{
                        top: `${((x.cs - win.startMs) / len) * 100}%`,
                        height: `${Math.max(((x.ce - x.cs) / len) * 100, 3)}%`,
                        background: m.color, color: "#fff", opacity: x.b.title_visible ? 0.95 : 0.7,
                      }}
                    >{label}</div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
