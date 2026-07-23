import { useEffect, useMemo, useState } from "react";
import { schedulerApi, airtableApi } from "../lib/api";
import type { CalendarEvent, AirtableActionItem } from "../types";

type ViewType = "bar" | "table" | "heatmap";

interface DayAccountEntry {
  date: string; // YYYY-MM-DD
  account: string;
  meetingMinutes: number;
  actionItemMinutes: number;
}

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

function isoDate(dt: string) {
  return dt.slice(0, 10);
}

function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function formatLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Bar chart (grouped per day, stacked by account) ──────────────────────────

function BarChart({ data, days, accounts, colorMap }: {
  data: DayAccountEntry[];
  days: string[];
  accounts: string[];
  colorMap: Record<string, string>;
}) {
  const W = 800;
  const H = 260;
  const MARGIN = { top: 16, right: 16, bottom: 64, left: 52 };
  const chartW = W - MARGIN.left - MARGIN.right;
  const chartH = H - MARGIN.top - MARGIN.bottom;

  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  const totals = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const d of days) map[d] = {};
    for (const e of data) {
      if (!map[e.date]) map[e.date] = {};
      map[e.date][e.account] = (map[e.date][e.account] ?? 0) + e.meetingMinutes + e.actionItemMinutes;
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

  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 400, display: "block" }}
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
            const segments: { account: string; height: number; y: number }[] = [];
            for (const acct of accounts) {
              const mins = totals[day]?.[acct] ?? 0;
              if (!mins) continue;
              const h = (mins / maxMinutes) * chartH;
              yOffset -= h;
              segments.push({ account: acct, height: h, y: yOffset });
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
                    rx={2}
                    style={{ cursor: "pointer" }}
                    onMouseMove={(e) => {
                      const svg = (e.currentTarget.closest("svg") as SVGSVGElement);
                      const rect = svg.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top - 8,
                        label: `${s.account}: ${fmtMin(totals[day]?.[s.account] ?? 0)} on ${formatLabel(day)}`,
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

function TableView({ data, days, accounts, colorMap }: {
  data: DayAccountEntry[];
  days: string[];
  accounts: string[];
  colorMap: Record<string, string>;
}) {
  const totals = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const e of data) {
      if (!map[e.account]) map[e.account] = {};
      map[e.account][e.date] = (map[e.account][e.date] ?? 0) + e.meetingMinutes + e.actionItemMinutes;
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

  return (
    <div style={{ overflowX: "auto" }}>
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
                      <span style={{
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

function HeatmapView({ data, days, accounts, colorMap }: {
  data: DayAccountEntry[];
  days: string[];
  accounts: string[];
  colorMap: Record<string, string>;
}) {
  const totals = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const e of data) {
      if (!map[e.account]) map[e.account] = {};
      map[e.account][e.date] = (map[e.account][e.date] ?? 0) + e.meetingMinutes + e.actionItemMinutes;
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

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: Math.min(W, 500), display: "block" }}
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
                    style={{ cursor: mins ? "pointer" : "default" }}
                    onMouseMove={(e) => {
                      if (!mins) return;
                      const svg = (e.currentTarget.closest("svg") as SVGSVGElement);
                      const rect = svg.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top - 8,
                        label: `${acct}: ${fmtMin(mins)} on ${formatLabel(day)}`,
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

function Legend({ accounts, colorMap }: { accounts: string[]; colorMap: Record<string, string> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
      {accounts.map(a => (
        <span key={a} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "var(--text-secondary,#888)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: colorMap[a], flexShrink: 0, display: "inline-block" }} />
          {a}
        </span>
      ))}
    </div>
  );
}

// ── Range selector ────────────────────────────────────────────────────────────

type Range = "7d" | "14d" | "30d";

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TimeAllocationPanel() {
  const [view, setView] = useState<ViewType>("bar");
  const [range, setRange] = useState<Range>("14d");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
    const now = new Date();
    const start = addDays(now, -days);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = now.toISOString().slice(0, 10);

    Promise.all([
      schedulerApi.listEvents({ page_size: "500", start_after: startStr + "T00:00:00Z", start_before: endStr + "T23:59:59Z" })
        .then(r => setEvents(r.data))
        .catch(() => {}),
      airtableApi.listActionItems()
        .then(r => setActionItems(r.data))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [range]);

  const days = useMemo(() => {
    const n = range === "7d" ? 7 : range === "14d" ? 14 : 30;
    const result: string[] = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) result.push(isoDate(addDays(now, -i).toISOString()));
    return result;
  }, [range]);

  const data: DayAccountEntry[] = useMemo(() => {
    const map: Record<string, DayAccountEntry> = {};
    const key = (date: string, account: string) => `${date}__${account}`;

    for (const ev of events) {
      if (!ev.account_name) continue;
      if (ev.status === "cancelled") continue;
      const date = isoDate(ev.start_datetime);
      if (!days.includes(date)) continue;
      const mins = (new Date(ev.end_datetime).getTime() - new Date(ev.start_datetime).getTime()) / 60000;
      const k = key(date, ev.account_name);
      if (!map[k]) map[k] = { date, account: ev.account_name, meetingMinutes: 0, actionItemMinutes: 0 };
      map[k].meetingMinutes += mins;
    }

    for (const ai of actionItems) {
      if (!ai.account_name) continue;
      const totalSecs = (ai.time_spent ?? 0) + (ai.prep_time ?? 0);
      if (!totalSecs) continue;
      // distribute time across due_date or last_synced date
      const rawDate = ai.due_date ?? ai.last_synced?.slice(0, 10);
      if (!rawDate) continue;
      const date = rawDate.slice(0, 10);
      if (!days.includes(date)) continue;
      const mins = totalSecs / 60;
      const k = key(date, ai.account_name);
      if (!map[k]) map[k] = { date, account: ai.account_name, meetingMinutes: 0, actionItemMinutes: 0 };
      map[k].actionItemMinutes += mins;
    }

    return Object.values(map);
  }, [events, actionItems, days]);

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

  const totalMins = useMemo(() => data.reduce((s, e) => s + e.meetingMinutes + e.actionItemMinutes, 0), [data]);

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
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {(["7d", "14d", "30d"] as Range[]).map(r => (
            <button key={r} style={btnStyle(range === r)} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
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
      ) : accounts.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: "var(--text-secondary,#888)", fontSize: "0.8125rem" }}>
          No account-linked activity found in this range.
        </div>
      ) : (
        <>
          {view === "bar" && <BarChart data={data} days={days} accounts={accounts} colorMap={colorMap} />}
          {view === "table" && <TableView data={data} days={days} accounts={accounts} colorMap={colorMap} />}
          {view === "heatmap" && <HeatmapView data={data} days={days} accounts={accounts} colorMap={colorMap} />}
          <Legend accounts={accounts} colorMap={colorMap} />
        </>
      )}
    </div>
  );
}
