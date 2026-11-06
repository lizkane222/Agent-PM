import { useEffect, useMemo, useRef, useState } from "react";
import { timeAllocationApi } from "../lib/api";
import type { TimeAllocation, TimeAllocationRow } from "../types/salesforce";

type ViewType = "bar" | "table" | "heatmap";

/** Minutes for one account on one day, and whether they were logged or are just on the calendar. */
interface DayAccountEntry {
  date: string; // YYYY-MM-DD, local
  account: string;
  minutes: number;
  source: "logged" | "calendar";
}

/** Key for "this account on this day", used to look up whether it came from the calendar. */
const cellKey = (date: string, account: string) => `${date}__${account}`;

const CALENDAR_NOTE = "From calendar events — not logged yet";

/** Label for entries whose project has no account, so logged time never silently disappears. */
export const NO_ACCOUNT_LABEL = "No account";

const PALETTE = [
  "#DB131A", "#2563eb", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#be185d", "#65a30d", "#ea580c", "#6366f1",
];

function fmtMin(min: number) {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Local YYYY-MM-DD. `toISOString()` is UTC, which names tomorrow's date for an evening user. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Every day from the 1st of the previous calendar month through `today`, oldest first. That is
 * between ~32 and ~62 days, which is why the views scroll sideways.
 */
export function allocationDays(today: Date): string[] {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out: string[] = [];
  for (let d = first; d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(localDate(d));
  }
  return out;
}

/** Turn the server's rows into chart entries. Rows outside `days` are ignored. */
export function rowsToDayAccounts(rows: TimeAllocationRow[], days: string[]): DayAccountEntry[] {
  const inRange = new Set(days);
  const map: Record<string, DayAccountEntry> = {};
  for (const r of rows) {
    const date = (r.date ?? "").slice(0, 10);
    if (!inRange.has(date) || !r.minutes) continue;
    const account = r.account || NO_ACCOUNT_LABEL;
    const k = `${cellKey(date, account)}__${r.source}`;
    if (!map[k]) map[k] = { date, account, minutes: 0, source: r.source };
    map[k].minutes += r.minutes;
  }
  return Object.values(map);
}

/** Opens a horizontally scrolling view at its right edge, where today is. */
function useScrollToEnd(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [dep]);
  return ref;
}

function formatLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Bar chart (grouped per day, stacked by account) ──────────────────────────

function BarChart({ data, days, accounts, colorMap, calendarCells }: {
  data: DayAccountEntry[];
  days: string[];
  accounts: string[];
  colorMap: Record<string, string>;
  /** cellKey(date, account) of cells whose minutes come from the calendar, not from logged time. */
  calendarCells: Set<string>;
}) {
  const H = 260;
  const MARGIN = { top: 16, right: 16, bottom: 64, left: 52 };
  const W = Math.max(800, MARGIN.left + MARGIN.right + days.length * 30);
  const chartW = W - MARGIN.left - MARGIN.right;
  const chartH = H - MARGIN.top - MARGIN.bottom;

  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  const totals = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const d of days) map[d] = {};
    for (const e of data) {
      if (!map[e.date]) map[e.date] = {};
      map[e.date][e.account] = (map[e.date][e.account] ?? 0) + e.minutes;
    }
    return map;
  }, [data, days]);

  const maxMinutes = useMemo(() => {
    let m = 0;
    for (const day of days) {
      const total = Object.values(totals[day] ?? {}).reduce((a, b) => a + b, 0);
      if (total > m) m = total;
    }
    return m || 60;
  }, [totals, days]);

  const barGroupW = chartW / Math.max(days.length, 1);
  const barW = Math.min(barGroupW * 0.7, 40);

  const yTicks = useMemo(() => {
    const maxH = maxMinutes / 60;
    const step = maxH <= 2 ? 0.5 : maxH <= 6 ? 1 : maxH <= 12 ? 2 : 4;
    const ticks: number[] = [];
    for (let v = 0; v <= Math.ceil(maxH / step) * step + 0.01; v += step) ticks.push(v);
    return ticks;
  }, [maxMinutes]);

  const scrollRef = useScrollToEnd(days.length);

  return (
    <div ref={scrollRef} style={{ position: "relative", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: W, minWidth: "100%", display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Y grid + labels */}
          {yTicks.map((t) => {
            const y = chartH - (t / (maxMinutes / 60)) * chartH;
            return (
              <g key={t}>
                <line x1={0} x2={chartW} y1={y} y2={y} stroke="rgba(0,0,0,0.07)" strokeWidth={1} />
                <text x={-6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-secondary,#888)">
                  {t % 1 === 0 ? `${t}h` : `${t * 60}m`}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {days.map((day, di) => {
            const cx = di * barGroupW + barGroupW / 2;
            const x0 = cx - barW / 2;
            let yOffset = chartH;
            const segments: { account: string; height: number; y: number; fromCalendar: boolean }[] = [];
            for (const acct of accounts) {
              const mins = totals[day]?.[acct] ?? 0;
              if (!mins) continue;
              const h = (mins / maxMinutes) * chartH;
              yOffset -= h;
              segments.push({ account: acct, height: h, y: yOffset, fromCalendar: calendarCells.has(cellKey(day, acct)) });
            }
            return (
              <g key={day}>
                {segments.map((s) => (
                  <rect
                    key={s.account}
                    x={x0}
                    y={s.y}
                    width={barW}
                    height={s.height}
                    fill={colorMap[s.account] ?? "#ccc"}
                    // Lighter and dashed: this time is on the calendar but has not been logged.
                    opacity={s.fromCalendar ? 0.5 : 1}
                    stroke={s.fromCalendar ? colorMap[s.account] ?? "#ccc" : undefined}
                    strokeDasharray={s.fromCalendar ? "3 2" : undefined}
                    data-source={s.fromCalendar ? "calendar" : "logged"}
                    rx={2}
                    style={{ cursor: "pointer" }}
                    onMouseMove={(e) => {
                      const svg = (e.currentTarget.closest("svg") as SVGSVGElement);
                      const rect = svg.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top - 8,
                        label: `${s.account}: ${fmtMin(totals[day]?.[s.account] ?? 0)} on ${formatLabel(day)}${s.fromCalendar ? " (calendar)" : ""}`,
                      });
                    }}
                  />
                ))}
                {/* X label */}
                <text
                  x={cx}
                  y={chartH + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-secondary,#888)"
                  transform={`rotate(-35,${cx},${chartH + 16})`}
                >
                  {formatLabel(day)}
                </text>
              </g>
            );
          })}

          {/* Axis lines */}
          <line x1={0} y1={0} x2={0} y2={chartH} stroke="var(--border,rgba(0,0,0,0.12))" />
          <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke="var(--border,rgba(0,0,0,0.12))" />
        </g>

        {/* Tooltip */}
        {tooltip && (
          <g>
            <rect
              x={Math.min(tooltip.x + 8, W - 180)}
              y={tooltip.y - 22}
              width={172}
              height={28}
              rx={4}
              fill="var(--twilio-navy,#121C2D)"
              opacity={0.92}
            />
            <text
              x={Math.min(tooltip.x + 8, W - 180) + 8}
              y={tooltip.y - 4}
              fontSize={11}
              fill="#fff"
            >
              {tooltip.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({ data, days, accounts, colorMap, calendarCells }: {
  data: DayAccountEntry[];
  days: string[];
  accounts: string[];
  colorMap: Record<string, string>;
  /** cellKey(date, account) of cells whose minutes come from the calendar, not from logged time. */
  calendarCells: Set<string>;
}) {
  const totals = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const e of data) {
      if (!map[e.account]) map[e.account] = {};
      map[e.account][e.date] = (map[e.account][e.date] ?? 0) + e.minutes;
    }
    return map;
  }, [data]);

  const rowTotals = useMemo(() => {
    const rt: Record<string, number> = {};
    for (const acct of accounts) {
      rt[acct] = Object.values(totals[acct] ?? {}).reduce((a, b) => a + b, 0);
    }
    return rt;
  }, [totals, accounts]);

  const colTotals = useMemo(() => {
    const ct: Record<string, number> = {};
    for (const day of days) {
      ct[day] = accounts.reduce((s, a) => s + (totals[a]?.[day] ?? 0), 0);
    }
    return ct;
  }, [totals, days, accounts]);

  const maxCell = useMemo(() => {
    let m = 0;
    for (const acct of accounts)
      for (const day of days) {
        const v = totals[acct]?.[day] ?? 0;
        if (v > m) m = v;
      }
    return m || 1;
  }, [totals, accounts, days]);

  const scrollRef = useScrollToEnd(days.length);

  return (
    <div ref={scrollRef} style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8125rem", fontFamily: "var(--font-base)" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border,rgba(0,0,0,0.1))", color: "var(--text-secondary,#888)", fontWeight: 500, whiteSpace: "nowrap" }}>
              Account
            </th>
            {days.map(d => (
              <th key={d} style={{ textAlign: "center", padding: "6px 6px", borderBottom: "1px solid var(--border,rgba(0,0,0,0.1))", color: "var(--text-secondary,#888)", fontWeight: 500, whiteSpace: "nowrap", minWidth: 60 }}>
                {formatLabel(d)}
              </th>
            ))}
            <th style={{ textAlign: "center", padding: "6px 10px", borderBottom: "1px solid var(--border,rgba(0,0,0,0.1))", color: "var(--text-secondary,#888)", fontWeight: 600, whiteSpace: "nowrap" }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((acct, ai) => (
            <tr key={acct} style={{ background: ai % 2 === 0 ? "transparent" : "var(--surface-raised,rgba(0,0,0,0.02))" }}>
              <td style={{ padding: "5px 10px", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colorMap[acct], marginRight: 6, flexShrink: 0 }} />
                {acct}
              </td>
              {days.map(day => {
                const mins = totals[acct]?.[day] ?? 0;
                const intensity = mins / maxCell;
                return (
                  <td key={day} style={{ textAlign: "center", padding: "5px 6px" }}>
                    {mins > 0 ? (
                      <span
                        data-source={calendarCells.has(cellKey(day, acct)) ? "calendar" : "logged"}
                        title={calendarCells.has(cellKey(day, acct)) ? CALENDAR_NOTE : undefined}
                        style={{
                        fontStyle: calendarCells.has(cellKey(day, acct)) ? "italic" : undefined,
                        display: "inline-block",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: `${colorMap[acct]}${Math.round(intensity * 180).toString(16).padStart(2, "0")}`,
                        color: intensity > 0.5 ? "#fff" : "var(--text-primary,#111)",
                        fontWeight: intensity > 0.6 ? 600 : 400,
                        minWidth: 36,
                      }}>
                        {fmtMin(mins)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-secondary,#ccc)" }}>—</span>
                    )}
                  </td>
                );
              })}
              <td style={{ textAlign: "center", padding: "5px 10px", fontWeight: 600 }}>
                {fmtMin(rowTotals[acct] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1px solid var(--border,rgba(0,0,0,0.1))" }}>
            <td style={{ padding: "5px 10px", fontWeight: 600, color: "var(--text-secondary,#888)", fontSize: "0.75rem" }}>Total</td>
            {days.map(day => (
              <td key={day} style={{ textAlign: "center", padding: "5px 6px", fontWeight: 600, fontSize: "0.75rem" }}>
                {colTotals[day] ? fmtMin(colTotals[day]) : "—"}
              </td>
            ))}
            <td style={{ textAlign: "center", padding: "5px 10px", fontWeight: 700 }}>
              {fmtMin(Object.values(rowTotals).reduce((a, b) => a + b, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Heatmap view ──────────────────────────────────────────────────────────────

function HeatmapView({ data, days, accounts, colorMap, calendarCells }: {
  data: DayAccountEntry[];
  days: string[];
  accounts: string[];
  colorMap: Record<string, string>;
  /** cellKey(date, account) of cells whose minutes come from the calendar, not from logged time. */
  calendarCells: Set<string>;
}) {
  const totals = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const e of data) {
      if (!map[e.account]) map[e.account] = {};
      map[e.account][e.date] = (map[e.account][e.date] ?? 0) + e.minutes;
    }
    return map;
  }, [data]);

  const maxCell = useMemo(() => {
    let m = 0;
    for (const a of accounts) for (const d of days) {
      const v = totals[a]?.[d] ?? 0;
      if (v > m) m = v;
    }
    return m || 1;
  }, [totals, accounts, days]);

  const CELL = 38;
  const LEFT = 140;
  const TOP = 36;
  const W = LEFT + days.length * CELL + 16;
  const H = TOP + accounts.length * CELL + 8;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  const scrollRef = useScrollToEnd(days.length);

  return (
    <div ref={scrollRef} style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: W, minWidth: "100%", display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Column headers */}
        {days.map((d, di) => (
          <text
            key={d}
            x={LEFT + di * CELL + CELL / 2}
            y={TOP - 8}
            textAnchor="middle"
            fontSize={9}
            fill="var(--text-secondary,#888)"
            transform={`rotate(-30,${LEFT + di * CELL + CELL / 2},${TOP - 8})`}
          >
            {formatLabel(d)}
          </text>
        ))}

        {/* Row headers + cells */}
        {accounts.map((acct, ai) => {
          const y = TOP + ai * CELL;
          return (
            <g key={acct}>
              <text x={LEFT - 6} y={y + CELL / 2 + 4} textAnchor="end" fontSize={10} fill="var(--text-primary,#333)">
                {acct.length > 18 ? acct.slice(0, 17) + "…" : acct}
              </text>
              {days.map((day, di) => {
                const mins = totals[acct]?.[day] ?? 0;
                const intensity = mins / maxCell;
                const base = colorMap[acct] ?? "#888";
                return (
                  <rect
                    key={day}
                    x={LEFT + di * CELL + 2}
                    y={y + 2}
                    width={CELL - 4}
                    height={CELL - 4}
                    rx={4}
                    fill={mins ? `${base}` : "var(--surface-raised,rgba(0,0,0,0.04))"}
                    opacity={mins ? 0.15 + intensity * 0.85 : 1}
                    stroke={mins && calendarCells.has(cellKey(day, acct)) ? base : undefined}
                    strokeDasharray={mins && calendarCells.has(cellKey(day, acct)) ? "3 2" : undefined}
                    data-source={mins ? (calendarCells.has(cellKey(day, acct)) ? "calendar" : "logged") : undefined}
                    style={{ cursor: mins ? "pointer" : "default" }}
                    onMouseMove={(e) => {
                      if (!mins) return;
                      const svg = (e.currentTarget.closest("svg") as SVGSVGElement);
                      const rect = svg.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top - 8,
                        label: `${acct}: ${fmtMin(mins)} on ${formatLabel(day)}${calendarCells.has(cellKey(day, acct)) ? " (calendar)" : ""}`,
                      });
                    }}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Tooltip */}
        {tooltip && (
          <g>
            <rect
              x={Math.min(tooltip.x + 8, W - 190)}
              y={tooltip.y - 22}
              width={184}
              height={28}
              rx={4}
              fill="var(--twilio-navy,#121C2D)"
              opacity={0.93}
            />
            <text x={Math.min(tooltip.x + 8, W - 190) + 8} y={tooltip.y - 4} fontSize={11} fill="#fff">
              {tooltip.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ accounts, colorMap, hasCalendar }: { accounts: string[]; colorMap: Record<string, string>; hasCalendar: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
      {accounts.map(a => (
        <span key={a} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "var(--text-secondary,#888)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: colorMap[a], flexShrink: 0, display: "inline-block" }} />
          {a}
        </span>
      ))}
      {hasCalendar && (
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "var(--text-secondary,#888)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, border: "1px dashed #666", opacity: 0.6, flexShrink: 0, display: "inline-block" }} />
          Dashed / lighter = from calendar events, not logged yet
        </span>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

function formatRange(days: string[]) {
  if (!days.length) return "";
  return `${formatLabel(days[0])} – ${formatLabel(days[days.length - 1])}`;
}

export default function TimeAllocationPanel() {
  const [view, setView] = useState<ViewType>("bar");
  const [result, setResult] = useState<TimeAllocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // The window is the previous calendar month through today, fixed for the life of the mount.
  const days = useMemo(() => allocationDays(new Date()), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    timeAllocationApi
      .get({ start: days[0], end: days[days.length - 1] })
      .then(r => { if (!cancelled) setResult(r.data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const data: DayAccountEntry[] = useMemo(() => rowsToDayAccounts(result?.rows ?? [], days), [result, days]);
  const calendarCells = useMemo(
    () => new Set(data.filter(e => e.source === "calendar").map(e => cellKey(e.date, e.account))),
    [data],
  );

  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const e of data) set.add(e.account);
    return Array.from(set).sort();
  }, [data]);

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    accounts.forEach((a, i) => { m[a] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [accounts]);

  const totalMins = useMemo(() => data.reduce((s, e) => s + e.minutes, 0), [data]);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    fontSize: "0.75rem",
    fontFamily: "var(--font-base)",
    fontWeight: active ? 600 : 400,
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--twilio-red,#DB131A)" : "transparent",
    color: active ? "#fff" : "var(--text-secondary,#888)",
    transition: "background 0.15s",
  });

  return (
    <div style={{ padding: "16px 0 8px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ fontSize: "0.8125rem", fontWeight: 700, fontFamily: "var(--font-base)", color: "var(--text-primary,#111)", margin: 0 }}>
            Time Allocation
          </p>
          <p style={{ fontSize: "0.6875rem", color: "var(--text-secondary,#888)", fontFamily: "var(--font-base)", margin: "1px 0 0" }}>
            {loading ? "Loading…" : `${fmtMin(totalMins)} across ${accounts.length} account${accounts.length !== 1 ? "s" : ""}`}
          </p>
          {!loading && !failed && result && (
            <p data-testid="allocation-breakdown" style={{ fontSize: "0.6875rem", color: "var(--text-secondary,#888)", fontFamily: "var(--font-base)", margin: "1px 0 0" }}>
              {fmtMin(result.logged_minutes)} logged
              {result.calendar_minutes > 0 && ` + ${fmtMin(result.calendar_minutes)} from your calendar, not logged yet`}
              {result.inferred_minutes > 0 && ` (${fmtMin(result.inferred_minutes)} matched to an account by name)`}
              {result.unlinked_calendar_minutes > 0 && ` · ${fmtMin(result.unlinked_calendar_minutes)} of calendar time isn't linked to an account`}
            </p>
          )}
        </div>

        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary,#888)", fontFamily: "var(--font-base)" }} title="Logged time, plus calendar events for days not logged yet, from the start of last month through today. Meetings marked did-not-attend are never counted. Scroll sideways for earlier days.">
          {formatRange(days)}
        </span>
      </div>

      {/* View tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 12, borderBottom: "1px solid var(--border,rgba(0,0,0,0.08))", paddingBottom: 6 }}>
        {([
          { v: "bar" as ViewType, label: "Bar Chart" },
          { v: "table" as ViewType, label: "Table" },
          { v: "heatmap" as ViewType, label: "Heatmap" },
        ]).map(({ v, label }) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              ...btnStyle(view === v),
              padding: "3px 10px",
              borderBottom: view === v ? "2px solid var(--twilio-red,#DB131A)" : "2px solid transparent",
              borderRadius: 0,
              background: "transparent",
              color: view === v ? "var(--twilio-red,#DB131A)" : "var(--text-secondary,#888)",
              fontWeight: view === v ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 32, color: "var(--text-secondary,#888)", fontSize: "0.8125rem" }}>
          Loading…
        </div>
      ) : failed ? (
        <div style={{ textAlign: "center", padding: 32, color: "#b91c1c", fontSize: "0.8125rem" }}>
          Could not load your logged time.
        </div>
      ) : accounts.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: "var(--text-secondary,#888)", fontSize: "0.8125rem" }}>
          Nothing to show between {formatRange(days)}. Time you log from the Log Time panel, and calendar events linked to an account, show up here.
        </div>
      ) : (
        <>
          {view === "bar" && <BarChart data={data} days={days} accounts={accounts} colorMap={colorMap} calendarCells={calendarCells} />}
          {view === "table" && <TableView data={data} days={days} accounts={accounts} colorMap={colorMap} calendarCells={calendarCells} />}
          {view === "heatmap" && <HeatmapView data={data} days={days} accounts={accounts} colorMap={colorMap} calendarCells={calendarCells} />}
          <Legend accounts={accounts} colorMap={colorMap} hasCalendar={calendarCells.size > 0} />
        </>
      )}
    </div>
  );
}
