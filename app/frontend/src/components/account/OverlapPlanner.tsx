import { useEffect, useMemo, useRef, useState } from "react";
import {
  HOUR, STEP_MS, buildCopyText, busyIntervals, conflictsFor, dayBoundaries, findOverlap, formatWindowInZone,
  freeWindows, groupByZone, hourCells, isTeamPerson, mergeIntervals, moveWindow, nearestConflict, resizeWindow,
  rowLabel, todayISO, zoneHeading, zoneMidnightUtc, OVERLAP_TIERS,
  type Band, type Interval, type PersonBusy, type PlannerPerson,
} from "../../lib/overlapPlanner";
import { useAvailability } from "../../hooks/useAvailability";
import { useIsLarge } from "../../hooks/useIsLarge";
import PlannerCalendars from "./PlannerCalendars";
import { zoneAbbreviation } from "../../lib/timezones";
import { browserZone, isValidZone } from "../../lib/timezones";

export type { PlannerPerson };

const LABEL_W = 196;
const CELL_W = 30;
const BAR_W = CELL_W * 24;
const ROW_H = 72;
const HUES = [215, 160, 28, 280, 340, 190, 95, 250];

const palette = (hue: number): Record<Band, { bg: string; fg: string }> => ({
  work: { bg: `hsl(${hue}, 65%, 45%)`, fg: "#ffffff" },
  edge: { bg: `hsl(${hue}, 55%, 86%)`, fg: `hsl(${hue}, 40%, 25%)` },
  night: { bg: `hsl(${hue}, 25%, 27%)`, fg: `hsl(${hue}, 20%, 85%)` },
});

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* fall back */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
}

type Drag = { mode: "move" | "start" | "end"; x: number; win: Interval };

/**
 * Meeting-overlap planner: one 24-hour bar per distinct time zone, a draggable box over everyone's
 * shared working hours. Display only: it never sends anything; "Copy Times" is for pasting by hand.
 */
export default function OverlapPlanner({
  people,
  viewerZone: viewerZoneProp,
  now: nowProp,
}: {
  people: PlannerPerson[];
  viewerZone?: string;
  now?: Date;
}) {
  const viewerZone = viewerZoneProp && isValidZone(viewerZoneProp) ? viewerZoneProp : browserZone();
  const [tick, setTick] = useState(0);
  const now = useMemo(() => nowProp ?? new Date(), [nowProp, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nowProp) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [nowProp]);

  const [dateISO, setDateISO] = useState(() => todayISO(viewerZone, now));
  const [copied, setCopied] = useState(false);
  const [excludeBusy, setExcludeBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const isLarge = useIsLarge();

  const valid = useMemo(
    // The signed-in user falls back to the viewer's own zone; everyone else without a valid zone is left out.
    () => people.map((p) => (p.zone && isValidZone(p.zone) ? p : { ...p, zone: p.isSelf ? viewerZone : null })),
    [people, viewerZone],
  );
  const rows = useMemo(() => groupByZone(valid, viewerZone), [valid, viewerZone]);
  const missing = valid.filter((p) => !p.zone);
  const hasAnyZone = valid.some((p) => p.zone);

  const axisStart = useMemo(() => zoneMidnightUtc(viewerZone, dateISO), [viewerZone, dateISO]);
  const axis: Interval = useMemo(() => ({ startMs: axisStart, endMs: axisStart + 24 * HOUR }), [axisStart]);
  const zonesKey = rows.map((r) => r.zone).join("|");
  const overlap = useMemo(() => findOverlap(rows.map((r) => r.zone), axisStart), [zonesKey, axisStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Busy time of the Twilio team members (customer contacts have no calendar here) ──
  const teamPeople = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; email: string; zone: string | null }[] = [];
    for (const p of valid) {
      const email = (p.email ?? "").trim().toLowerCase();
      if (!isTeamPerson(p) || !email || seen.has(email)) continue;
      seen.add(email);
      out.push({ name: p.name, email, zone: p.zone });
    }
    return out;
  }, [valid]);
  const emailsKey = teamPeople.map((t) => t.email).join(",");
  const range = useMemo(
    () => (teamPeople.length ? { start: new Date(axisStart - 12 * HOUR).toISOString(), end: new Date(axisStart + 36 * HOUR).toISOString() } : null),
    [emailsKey, axisStart], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // One request per day serves both the busy-time exclusion and the calendars panel.
  const avail = useAvailability(teamPeople.map((t) => t.email), range, { includeSelf: true });
  const busyPeople: PersonBusy[] = useMemo(() => {
    if (!excludeBusy) return [];
    const byEmail = new Map(avail.people.map((a) => [a.email.toLowerCase(), a]));
    return teamPeople.flatMap((t) => {
      const a = byEmail.get(t.email);
      return a && !a.error ? [{ name: t.name, ranges: busyIntervals(a.busy) }] : [];
    });
  }, [excludeBusy, avail.people, teamPeople]);
  const unavailable = excludeBusy ? avail.people.filter((a) => a.error).map((a) => teamPeople.find((t) => t.email === a.email.toLowerCase())?.name ?? a.name) : [];
  const busyReady = excludeBusy && !avail.loading && !avail.error && avail.people.length > 0;
  const allBusy = useMemo(() => mergeIntervals(busyPeople.flatMap((b) => b.ranges)), [busyPeople]);
  const zoneList = useMemo(() => rows.map((r) => r.zone), [zonesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = useMemo(() => (busyReady ? freeWindows(zoneList, axisStart, allBusy) : []), [busyReady, zoneList, axisStart, allBusy]);
  const hint = useMemo(() => (busyReady && !free.length ? nearestConflict(zoneList, axisStart, busyPeople) : null), [busyReady, free, zoneList, axisStart, busyPeople]);

  const defaultWindow: Interval = (busyReady && free[0]) || overlap.window || { startMs: axisStart + 10 * HOUR, endMs: axisStart + 11 * HOUR };
  const [win, setWin] = useState<Interval>(defaultWindow);
  const overlapKey = `${defaultWindow.startMs}-${defaultWindow.endMs}`;
  useEffect(() => { setWin(defaultWindow); }, [overlapKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const calMembers = useMemo(
    () => teamPeople.map((t) => {
      const ri = Math.max(rows.findIndex((r) => r.names.includes(t.name)), 0);
      return { name: t.name, email: t.email, color: palette(HUES[ri % HUES.length]).work.bg };
    }),
    [teamPeople, rows],
  );
  const calendars = teamPeople.length > 0 ? (
    <PlannerCalendars members={calMembers} people={avail.people} win={win} viewerZone={viewerZone} loading={avail.loading} error={avail.error} onRetry={avail.refetch} scrollable={!isLarge} />
  ) : null;

  const dragRef = useRef<Drag | null>(null);
  const px = (ms: number) => ((ms - axisStart) / (24 * HOUR)) * BAR_W;
  const msPerPx = (24 * HOUR) / BAR_W;

  if (!hasAnyZone) return null;

  const begin = (mode: Drag["mode"]) => (e: React.PointerEvent<HTMLElement>) => {
    setDragging(true);
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { mode, x: e.clientX, win };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = (e.clientX - d.x) * msPerPx;
    setWin(d.mode === "move" ? moveWindow(d.win, delta, axis) : resizeWindow(d.win, d.mode, delta, axis));
  };
  const end = () => { dragRef.current = null; setDragging(false); };

  const step = (e: React.KeyboardEvent) => (e.shiftKey ? HOUR : STEP_MS);
  const onBoxKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setWin((w) => moveWindow(w, (e.key === "ArrowRight" ? 1 : -1) * step(e), axis));
  };
  const onHandleKey = (edge: "start" | "end") => (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    setWin((w) => resizeWindow(w, edge, (e.key === "ArrowRight" ? 1 : -1) * step(e), axis));
  };

  const conflicts = busyReady ? conflictsFor(win, busyPeople) : [];
  const heading = busyReady
    ? free.length ? `Widest free window inside everyone's 9 AM - 5 PM, excluding team busy time` : "No shared free time - everyone busy or outside 9-5"
    : overlap.window
    ? overlap.tier === 0
      ? `Everyone's ${OVERLAP_TIERS[0].label} overlap`
      : `No overlap in 9-5 working hours. Widest shared window within ${overlap.tierLabel} shown.`
    : `No overlap in 9-5 working hours, and none within ${OVERLAP_TIERS[2].label}.`;

  const summary = rows.map((r) => `${rowLabel(r)}: ${formatWindowInZone(win.startMs, win.endMs, r.zone)}`);
  const left = LABEL_W + px(win.startMs);
  const width = Math.max(px(win.endMs) - px(win.startMs), 6);
  const nowInAxis = now.getTime() >= axisStart && now.getTime() < axis.endMs;

  return (
    <div data-testid="overlap-planner" className="text-xs">
      <div data-testid="planner-times" className="mt-2 rounded-md border border-indigo-100 bg-indigo-50/60 p-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)] mb-0.5">Overlapping times</p>
      <p data-testid="planner-summary" className="text-[11px] text-[var(--twilio-navy)]">
        {summary.map((s, i) => (<span key={i}>{i > 0 && <span className="text-[var(--twilio-gray-60)]"> · </span>}{s}</span>))}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void copyText(buildCopyText(rows, win)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); });
          }}
          className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
        >{copied ? "Copied" : "Copy Times"}</button>
        <span className="text-[10px] text-[var(--twilio-gray-60)]">For pasting into an email yourself. Nothing is sent.</span>
      </div>
      </div>
    <div data-testid="planner-box" className="mt-2 rounded-md border border-gray-200 bg-white p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <span className="font-semibold text-[var(--twilio-navy)]">Meeting time planner</span>
        <label className="flex items-center gap-1 text-[11px] text-[var(--twilio-gray-60)]">
          Date
          <input
            type="date"
            aria-label="Planner date"
            value={dateISO}
            onChange={(e) => e.target.value && setDateISO(e.target.value)}
            className="rounded border border-gray-200 px-1 py-0.5 text-[11px] text-[var(--twilio-navy)]"
          />
        </label>
      </div>
      <div className={isLarge && calendars ? "grid grid-cols-2 gap-3" : undefined} data-testid="planner-split">
      <div className="min-w-0">
      <p data-testid="planner-overlap-note" className="mb-1 text-[11px] text-[var(--twilio-gray-60)]">{heading}</p>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={teamPeople.length === 0}
          aria-pressed={excludeBusy}
          onClick={() => setExcludeBusy((v) => !v)}
          className="rounded border border-indigo-200 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
        >{excludeBusy ? "Include busy times" : "Exclude busy times for Twilio Team"}</button>
        <span data-testid="planner-busy-note" className="text-[10px] text-[var(--twilio-gray-60)]">
          {teamPeople.length === 0
            ? "Select Twilio team members with an email to use their calendars."
            : "Only Twilio team members' calendars are consulted; customer contacts have no calendar here. Nothing is sent."}
        </span>
      </div>
      {excludeBusy && avail.loading && <p data-testid="planner-busy-loading" className="mb-1 text-[11px] text-[var(--twilio-gray-60)]">Loading busy times...</p>}
      {excludeBusy && avail.error && (
        <p role="alert" data-testid="planner-busy-error" className="mb-1 text-[11px] text-red-600">
          {avail.error}. <button type="button" onClick={avail.refetch} className="underline">Retry</button>
        </p>
      )}
      {unavailable.length > 0 && (
        <p data-testid="planner-busy-unavailable" className="mb-1 text-[11px] text-amber-700">
          Calendar not available (not excluded): {unavailable.join(", ")}
        </p>
      )}

      <div className="overflow-x-auto" data-testid="planner-scroll" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", width: isLarge ? undefined : "max-content" }}>
        <div style={{ position: "relative", width: LABEL_W + BAR_W, flex: "none" }}>
          {rows.map((row, ri) => {
            const colors = palette(HUES[ri % HUES.length]);
            const cells = hourCells(row.zone, axisStart);
            const days = dayBoundaries(row.zone, axisStart, axis.endMs);
            const h = zoneHeading(row.zone, axisStart + 12 * HOUR);
            const nowText = zoneHeading(row.zone, now.getTime()).time;
            return (
              <div key={row.zone} data-testid="planner-row" data-zone={row.zone} style={{ display: "flex", height: ROW_H, marginBottom: 4 }}>
                <div
                  style={{ position: "sticky", left: 0, zIndex: 3, width: LABEL_W, flex: "none", background: "var(--surface-card)", paddingRight: 6 }}
                  className="flex flex-col justify-center leading-tight"
                >
                  <span data-testid="row-names" className="font-semibold text-[var(--twilio-navy)] truncate" title={rowLabel(row)}>{rowLabel(row)}</span>
                  <span className="text-[10px] text-[var(--twilio-gray-60)] truncate" title={row.zone}>{row.zone}</span>
                  <span className="text-[10px] text-[var(--twilio-gray-60)]">{h.abbr} ({h.offset}) · now {nowText}</span>
                  <span data-testid="row-window" className="text-[10px] font-semibold" style={{ color: colors.work.bg }}>
                    {formatWindowInZone(win.startMs, win.endMs, row.zone)}
                  </span>
                </div>
                <div style={{ position: "relative", width: BAR_W, flex: "none", display: "flex", borderRadius: 4, overflow: "hidden" }}>
                  {cells.map((c) => (
                    <div
                      key={c.startMs}
                      data-band={c.band}
                      style={{ width: CELL_W, background: colors[c.band].bg, color: colors[c.band].fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, borderRight: "1px solid rgba(255,255,255,0.35)" }}
                    >{c.label}</div>
                  ))}
                  {busyPeople.filter((bp) => row.names.includes(bp.name)).flatMap((bp, li) =>
                    bp.ranges
                      .map((r) => ({ startMs: Math.max(r.startMs, axisStart), endMs: Math.min(r.endMs, axis.endMs) }))
                      .filter((r) => r.endMs > r.startMs)
                      .map((r) => (
                        <div
                          key={`${bp.name}-${r.startMs}`}
                          data-testid="busy-block"
                          data-person={bp.name}
                          title={`${bp.name} is busy ${formatWindowInZone(r.startMs, r.endMs, row.zone)}`}
                          style={{
                            position: "absolute", left: px(r.startMs), width: Math.max(px(r.endMs) - px(r.startMs), 2), bottom: 2 + li * 8, height: 7,
                            backgroundImage: "repeating-linear-gradient(45deg, #111827 0, #111827 2px, #fecaca 2px, #fecaca 4px)",
                            border: "1px solid #7f1d1d", borderRadius: 2, opacity: 0.9,
                          }}
                        />
                      )),
                  )}
                  {days.map((d, i) => (
                    <div key={d.ms} data-testid="day-marker" style={{ position: "absolute", top: 0, bottom: 0, left: px(d.ms), pointerEvents: "none" }}>
                      {i > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: "#111827" }} />}
                      <span style={{ position: "absolute", top: 1, left: 3, fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", color: "#fff", textShadow: "0 0 3px rgba(0,0,0,0.8)" }}>{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {nowInAxis && (
            <div aria-hidden="true" data-testid="planner-now" style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W + px(now.getTime()), width: 0, borderLeft: "2px dashed #ef4444", zIndex: 1, pointerEvents: "none" }} />
          )}

          <div
            data-testid="planner-window"
            role="group"
            tabIndex={0}
            aria-label={`Meeting window ${formatWindowInZone(win.startMs, win.endMs, viewerZone)}. Arrow keys move it; Shift for hour steps.`}
            data-start={win.startMs}
            data-end={win.endMs}
            onKeyDown={onBoxKey}
            onPointerDown={begin("move")}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
            style={{
              position: "absolute", top: -8, bottom: -4, left, width, zIndex: 2, cursor: dragging ? "grabbing" : "grab", touchAction: "none",
              border: `2px solid ${conflicts.length ? "#d97706" : "#4f46e5"}`, borderRadius: 6,
              background: conflicts.length ? "rgba(245,158,11,0.28)" : "rgba(79,70,229,0.14)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.9), 0 0 0 2px rgba(17,24,39,0.55), 0 4px 12px rgba(0,0,0,0.35)",
            }}
          >
            {(["start", "end"] as const).map((edge) => (
              <div
                key={edge}
                role="slider"
                tabIndex={0}
                aria-label={edge === "start" ? "Meeting start" : "Meeting end"}
                aria-valuemin={axis.startMs}
                aria-valuemax={axis.endMs}
                aria-valuenow={edge === "start" ? win.startMs : win.endMs}
                aria-valuetext={formatWindowInZone(win.startMs, win.endMs, viewerZone)}
                data-testid={`planner-handle-${edge}`}
                onKeyDown={onHandleKey(edge)}
                onPointerDown={begin(edge)}
                onPointerMove={onMove}
                onPointerUp={end}
                onPointerCancel={end}
                style={{ position: "absolute", top: 0, bottom: 0, [edge === "start" ? "left" : "right"]: -5, width: 10, cursor: "ew-resize", touchAction: "none", background: "#4f46e5", borderRadius: 4, opacity: 0.85 }}
              />
            ))}
          </div>
        </div>
        {!isLarge && calendars}
        </div>
      </div>

      {busyReady && conflicts.length > 0 && (
        <p data-testid="planner-conflicts" className="mt-1 text-[11px] font-semibold text-amber-700">
          Conflicts with the selected time: {conflicts.map((c) => `${c.name} is busy ${formatWindowInZone(c.startMs, c.endMs, viewerZone)}`).join("; ")}
        </p>
      )}
      {busyReady && free.length === 0 && hint && (
        <p data-testid="planner-nearest-conflict" className="mt-1 text-[11px] text-[var(--twilio-gray-60)]">
          {hint.name} is busy {formatWindowInZone(hint.startMs, hint.endMs, viewerZone)} {zoneAbbreviation(viewerZone, hint.startMs)}
        </p>
      )}
      {busyReady && free.length > 0 && (
        <div data-testid="planner-free-windows" className="mt-1 flex flex-wrap items-center gap-1">
          {free.slice(0, 8).map((f) => (
            <button
              key={f.startMs}
              type="button"
              onClick={() => setWin(f)}
              className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100"
            >{`Free: ${formatWindowInZone(f.startMs, f.endMs, viewerZone)} ${zoneAbbreviation(viewerZone, f.startMs)}`}</button>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p data-testid="planner-no-timezone" className="mt-1 text-[11px] text-[var(--twilio-gray-60)]">
          No timezone set (not in the calculation): {missing.map((p) => p.name).join(", ")}
        </p>
      )}
      </div>
      {isLarge && calendars}
      </div>
    </div>
    </div>
  );
}
