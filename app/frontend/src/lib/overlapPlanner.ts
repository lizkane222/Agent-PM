/**
 * Pure time math for the meeting-overlap planner (components/account/OverlapPlanner.tsx).
 * All instants are UTC milliseconds; zones are IANA names. Everything is derived from Intl, so DST
 * and half/quarter-hour offsets (Asia/Kolkata, Asia/Kathmandu) come out right with no tables.
 *
 * The time axis is one real 24 hours starting at local midnight, in the viewer's zone, of the
 * chosen date. Each zone's row shows that same stretch of real time with its own local hours.
 */
import { formatOffset, offsetMinutesAt, zoneAbbreviation } from "./timezones";

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const STEP_MS = 15 * MIN;

export type Band = "work" | "edge" | "night";
export interface Interval { startMs: number; endMs: number }

const WORK_START = 9, WORK_END = 17, NIGHT_START = 22, NIGHT_END = 6;

/** Overlap search tiers, strictest first. */
export const OVERLAP_TIERS = [
  { startHour: 9, endHour: 17, label: "9 AM - 5 PM working hours" },
  { startHour: 8, endHour: 19, label: "8 AM - 7 PM extended hours" },
  { startHour: 7, endHour: 22, label: "7 AM - 10 PM waking hours" },
] as const;

// ── Local-time parts ───────────────────────────────────────────────────────────────────────────
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric",
      day: "numeric", hour: "numeric", minute: "numeric",
    });
    fmtCache.set(zone, f);
  }
  return f;
}

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: string }

export function localParts(zone: string, ms: number): LocalParts {
  const parts = partsFormatter(zone).formatToParts(new Date(ms));
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: num("year"), month: num("month"), day: num("day"), hour: num("hour") % 24, minute: num("minute"),
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
  };
}

const dayKey = (p: LocalParts) => p.year * 10000 + p.month * 100 + p.day;

/** UTC instant of local midnight on `dateISO` (YYYY-MM-DD) in `zone`. */
export function zoneMidnightUtc(zone: string, dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const guess = Date.UTC(y, (m || 1) - 1, d || 1);
  let t = guess - offsetMinutesAt(zone, guess) * MIN;
  t = guess - offsetMinutesAt(zone, t) * MIN;
  return t;
}

/** Today's date (YYYY-MM-DD) in `zone`. */
export function todayISO(zone: string, now: Date = new Date()): string {
  const p = localParts(zone, now.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

// ── Hour cells ─────────────────────────────────────────────────────────────────────────────────
export function bandFor(hour: number, minute: number): Band {
  const t = hour + minute / 60;
  if (t >= NIGHT_START || t < NIGHT_END) return "night";
  if (t >= WORK_START && t < WORK_END) return "work";
  return "edge";
}

export interface HourCell {
  startMs: number;
  hour: number;
  minute: number;
  /** "9a", "1p", "5:30p" */
  label: string;
  band: Band;
}

function shortHour(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "a" : "p"}`;
}

/** The zone's local hour at each whole hour of real time from `axisStartMs`. */
export function hourCells(zone: string, axisStartMs: number, hours = 24): HourCell[] {
  const out: HourCell[] = [];
  for (let i = 0; i < hours; i++) {
    const startMs = axisStartMs + i * HOUR;
    const p = localParts(zone, startMs);
    out.push({ startMs, hour: p.hour, minute: p.minute, label: shortHour(p.hour, p.minute), band: bandFor(p.hour, p.minute) });
  }
  return out;
}

export interface DayMarker { ms: number; label: string }

const dateLabel = (p: LocalParts) => `${p.weekday} ${p.month}/${p.day}`;

/** Where the local date changes inside [startMs, endMs). The first entry is the date at the start. */
export function dayBoundaries(zone: string, startMs: number, endMs: number): DayMarker[] {
  const first = localParts(zone, startMs);
  const out: DayMarker[] = [{ ms: startMs, label: dateLabel(first) }];
  let prev = dayKey(first);
  for (let t = startMs + STEP_MS; t < endMs; t += STEP_MS) {
    const p = localParts(zone, t);
    const k = dayKey(p);
    if (k !== prev) { out.push({ ms: t, label: dateLabel(p) }); prev = k; }
  }
  return out;
}

// ── Intervals ──────────────────────────────────────────────────────────────────────────────────
/** UTC intervals in [rangeStart, rangeEnd) during which the zone's local time is in [startHour, endHour). */
export function workIntervalsUtc(zone: string, rangeStartMs: number, rangeEndMs: number, startHour = WORK_START, endHour = WORK_END): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (let t = rangeStartMs; t < rangeEndMs; t += STEP_MS) {
    const p = localParts(zone, t);
    const mins = p.hour * 60 + p.minute;
    const inside = mins >= startHour * 60 && mins < endHour * 60;
    if (inside && open === null) open = t;
    if (!inside && open !== null) { out.push({ startMs: open, endMs: t }); open = null; }
  }
  if (open !== null) out.push({ startMs: open, endMs: rangeEndMs });
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i].startMs, b[j].startMs);
    const e = Math.min(a[i].endMs, b[j].endMs);
    if (s < e) out.push({ startMs: s, endMs: e });
    if (a[i].endMs < b[j].endMs) i++; else j++;
  }
  return out;
}

export function intersectAll(lists: Interval[][]): Interval[] {
  if (lists.length === 0) return [];
  return lists.slice(1).reduce((acc, l) => intersect(acc, l), lists[0]);
}

export interface OverlapResult {
  /** 0 = everyone's 9-5; 1 = 8-19; 2 = 7-22; -1 = nothing even then. */
  tier: number;
  window: Interval | null;
  /** Description of the hours the window respects. */
  tierLabel: string;
  /** True when the strict 9-5 overlap is empty. */
  noCoreOverlap: boolean;
}

/**
 * Widest window shared by all zones inside the axis. Falls back through wider hour ranges so a
 * "least bad" suggestion exists when 9-5 never lines up.
 */
export function findOverlap(zones: string[], axisStartMs: number, hours = 24): OverlapResult {
  const axisEnd = axisStartMs + hours * HOUR;
  const rangeStart = axisStartMs - 12 * HOUR, rangeEnd = axisEnd + 12 * HOUR;
  const unique = Array.from(new Set(zones));
  for (let tier = 0; tier < OVERLAP_TIERS.length; tier++) {
    const t = OVERLAP_TIERS[tier];
    const lists = unique.map((z) => workIntervalsUtc(z, rangeStart, rangeEnd, t.startHour, t.endHour));
    const shared = intersectAll(lists)
      .map((iv) => ({ startMs: Math.max(iv.startMs, axisStartMs), endMs: Math.min(iv.endMs, axisEnd) }))
      .filter((iv) => iv.endMs > iv.startMs);
    if (shared.length) {
      const best = shared.reduce((a, b) => (b.endMs - b.startMs > a.endMs - a.startMs ? b : a));
      return { tier, window: best, tierLabel: t.label, noCoreOverlap: tier > 0 };
    }
  }
  return { tier: -1, window: null, tierLabel: "", noCoreOverlap: true };
}

// ── Window editing (snap, move, resize) ────────────────────────────────────────────────────────
export const snapToStep = (ms: number, step = STEP_MS) => Math.round(ms / step) * step;

export function moveWindow(w: Interval, deltaMs: number, axis: Interval): Interval {
  const len = w.endMs - w.startMs;
  let start = snapToStep(w.startMs + deltaMs);
  start = Math.max(axis.startMs, Math.min(start, axis.endMs - len));
  return { startMs: start, endMs: start + len };
}

export function resizeWindow(w: Interval, edge: "start" | "end", deltaMs: number, axis: Interval, minMs = STEP_MS): Interval {
  if (edge === "start") {
    const s = Math.max(axis.startMs, Math.min(snapToStep(w.startMs + deltaMs), w.endMs - minMs));
    return { startMs: s, endMs: w.endMs };
  }
  const e = Math.min(axis.endMs, Math.max(snapToStep(w.endMs + deltaMs), w.startMs + minMs));
  return { startMs: w.startMs, endMs: e };
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────────
function clock(zone: string, ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** "Mon 9:00 AM - 10:00 AM", or "Mon 11:00 PM - Tue 12:00 AM" across midnight. */
export function formatWindowInZone(startMs: number, endMs: number, zone: string): string {
  const s = localParts(zone, startMs), e = localParts(zone, endMs);
  const end = dayKey(s) === dayKey(e) ? clock(zone, endMs) : `${e.weekday} ${clock(zone, endMs)}`;
  return `${s.weekday} ${clock(zone, startMs)} - ${end}`;
}

export function zoneHeading(zone: string, ms: number): { abbr: string; offset: string; time: string } {
  return { abbr: zoneAbbreviation(zone, ms), offset: formatOffset(offsetMinutesAt(zone, ms)), time: clock(zone, ms) };
}

// ── Grouping + copy text ───────────────────────────────────────────────────────────────────────
export interface PlannerPerson {
  id: string;
  name: string;
  zone: string | null;
  /** Needed to look up a Twilio team member's calendar. Customer contacts have no calendar here. */
  email?: string;
  /** Defaults from the id prefix: "m:" is a team member, anything else a customer contact. */
  kind?: "team" | "contact";
  /** The signed-in user, selected from the Twilio Team: shown once under their own name, not as "You". */
  isSelf?: boolean;
}

export const isTeamPerson = (p: PlannerPerson): boolean => (p.kind ?? (p.id.startsWith("m:") ? "team" : "contact")) === "team";
export interface ZoneRow { zone: string; names: string[]; isYou: boolean }

/** One row per distinct zone; the viewer's zone is always present and first, labelled "You". */
export function groupByZone(people: PlannerPerson[], viewerZone: string): ZoneRow[] {
  const rows = new Map<string, ZoneRow>();
  // When the viewer is themselves one of the selected people they appear once, by name, in their own zone.
  if (!people.some((p) => p.isSelf)) rows.set(viewerZone, { zone: viewerZone, names: [], isYou: true });
  for (const p of people) {
    if (!p.zone) continue;
    const row = rows.get(p.zone) ?? { zone: p.zone, names: [], isYou: false };
    row.names.push(p.name);
    rows.set(p.zone, row);
  }
  return Array.from(rows.values());
}

export function rowLabel(row: ZoneRow): string {
  const names = row.isYou ? ["You", ...row.names] : row.names;
  return names.join(", ");
}

export function buildCopyText(rows: ZoneRow[], w: Interval): string {
  const lines = rows.map((r) => {
    const abbr = zoneAbbreviation(r.zone, w.startMs);
    return `${rowLabel(r)} (${r.zone}): ${formatWindowInZone(w.startMs, w.endMs, r.zone)} ${abbr}`;
  });
  return ["Proposed meeting time:", ...lines].join("\n");
}


// ── Busy time (read-only free/busy display) ────────────────────────────────────────────────────
/** Sort and merge touching/overlapping intervals; drops empty ones. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.endMs > i.startMs).map((i) => ({ ...i })).sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.startMs <= last.endMs) last.endMs = Math.max(last.endMs, iv.endMs);
    else out.push(iv);
  }
  return out;
}

/** `free` minus the union of `busy`. */
export function subtractBusy(free: Interval[], busy: Interval[]): Interval[] {
  const b = mergeIntervals(busy);
  const out: Interval[] = [];
  for (const f of free) {
    let cursor = f.startMs;
    for (const x of b) {
      if (x.endMs <= cursor) continue;
      if (x.startMs >= f.endMs) break;
      if (x.startMs > cursor) out.push({ startMs: cursor, endMs: x.startMs });
      cursor = Math.max(cursor, x.endMs);
      if (cursor >= f.endMs) break;
    }
    if (cursor < f.endMs) out.push({ startMs: cursor, endMs: f.endMs });
  }
  return out;
}

/** Instants when every zone is inside the 9-5 tier, clipped to the axis. */
export function sharedWorkIntervals(zones: string[], axisStartMs: number, hours = 24, tier = 0): Interval[] {
  const axisEnd = axisStartMs + hours * HOUR;
  const t = OVERLAP_TIERS[tier];
  const lists = Array.from(new Set(zones)).map((z) => workIntervalsUtc(z, axisStartMs - 12 * HOUR, axisEnd + 12 * HOUR, t.startHour, t.endHour));
  return intersectAll(lists)
    .map((iv) => ({ startMs: Math.max(iv.startMs, axisStartMs), endMs: Math.min(iv.endMs, axisEnd) }))
    .filter((iv) => iv.endMs > iv.startMs);
}

/**
 * Windows inside everyone's 9-5 where nobody in `busy` is busy, widest first (ties: earliest first).
 * Windows shorter than `minMs` are dropped.
 */
export function freeWindows(zones: string[], axisStartMs: number, busy: Interval[], hours = 24, minMs = STEP_MS): Interval[] {
  return subtractBusy(sharedWorkIntervals(zones, axisStartMs, hours), busy)
    .filter((iv) => iv.endMs - iv.startMs >= minMs)
    .sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs) || a.startMs - b.startMs);
}

export interface PersonBusy { name: string; ranges: Interval[] }

/** Busy blocks (ISO strings) as intervals; all-day markers and unparseable values are not busy time. */
export function busyIntervals(blocks: { start: string; end: string; all_day?: boolean }[]): Interval[] {
  const out: Interval[] = [];
  for (const b of blocks) {
    if (b.all_day) continue;
    const s = Date.parse(b.start), e = Date.parse(b.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ startMs: s, endMs: e });
  }
  return mergeIntervals(out);
}

export interface BusyConflict { name: string; startMs: number; endMs: number }

/** Who is busy during `w` (first overlapping block each), in input order. */
export function conflictsFor(w: Interval, people: PersonBusy[]): BusyConflict[] {
  const out: BusyConflict[] = [];
  for (const p of people) {
    const hit = p.ranges.find((r) => r.startMs < w.endMs && r.endMs > w.startMs);
    if (hit) out.push({ name: p.name, startMs: Math.max(hit.startMs, w.startMs), endMs: Math.min(hit.endMs, w.endMs) });
  }
  return out;
}

/**
 * When busy time wipes out the shared 9-5 window, the earliest busy block that sits inside it, so the
 * UI can say who is in the way. Null when there is no 9-5 overlap to begin with.
 */
export function nearestConflict(zones: string[], axisStartMs: number, people: PersonBusy[], hours = 24): BusyConflict | null {
  const core = sharedWorkIntervals(zones, axisStartMs, hours);
  let best: BusyConflict | null = null;
  for (const p of people) {
    for (const r of intersect(core, mergeIntervals(p.ranges))) {
      if (!best || r.startMs < best.startMs) best = { name: p.name, startMs: r.startMs, endMs: r.endMs };
    }
  }
  return best;
}
