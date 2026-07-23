import { useCallback, useEffect, useRef, useState } from "react";
import { airtableApi, salesforceApi, integrationsApi } from "../lib/api";

const LAST_SYNC_KEY = "agentpm-last-sync";
const SCHEDULED_ITEMS_KEY = "scheduledActionItems";

type Phase = "idle" | "crouch" | "running" | "celebrate" | "walking";

// ── Side-profile stick figure ─────────────────────────────────────────────────
// ViewBox: 40 wide × 52 tall. Ground line is y=48.
// All poses are drawn from the side (facing right by default).

function Figure({ phase, frame, color = "white" }: { phase: Phase; frame: number; color?: string }) {
  const f = frame % 2;
  const s = { stroke: color, strokeWidth: "2", strokeLinecap: "round" as const, fill: "none" };

  if (phase === "idle") {
    // Side profile standing, right arm waves up/down
    const armY = f === 0 ? 22 : 18;
    return (
      <svg viewBox="0 0 40 52" width="32" height="52" overflow="visible">
        {/* head */}
        <circle cx="20" cy="7" r="5" {...s} />
        {/* torso */}
        <line x1="20" y1="12" x2="20" y2="30" {...s} />
        {/* rear arm (left, behind body) — slightly transparent */}
        <line x1="20" y1="17" x2="13" y2="24" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        {/* front arm waves */}
        <line x1="20" y1="17" x2="28" y2={armY} {...s} />
        {/* rear leg */}
        <line x1="20" y1="30" x2="15" y2="42" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="15" y1="42" x2="13" y2="48" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        {/* front leg */}
        <line x1="20" y1="30" x2="23" y2="42" {...s} />
        <line x1="23" y1="42" x2="26" y2="48" {...s} />
      </svg>
    );
  }

  if (phase === "crouch") {
    // Crouched at start: body leaning forward, one knee up
    return (
      <svg viewBox="0 0 40 52" width="32" height="52" overflow="visible">
        <circle cx="23" cy="18" r="5" {...s} />
        {/* leaning torso */}
        <line x1="22" y1="23" x2="18" y2="34" {...s} />
        {/* front arm reaching forward */}
        <line x1="21" y1="26" x2="30" y2="24" {...s} />
        {/* rear arm back */}
        <line x1="21" y1="26" x2="12" y2="28" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        {/* front leg — knee up */}
        <line x1="18" y1="34" x2="24" y2="40" {...s} />
        <line x1="24" y1="40" x2="28" y2="48" {...s} />
        {/* rear leg — extended back */}
        <line x1="18" y1="34" x2="12" y2="42" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="12" y1="42" x2="10" y2="48" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </svg>
    );
  }

  if (phase === "running") {
    // Two alternating frames — classic side-on sprint
    return (
      <svg viewBox="0 0 40 52" width="32" height="52" overflow="visible">
        {/* head tilted slightly forward */}
        <circle cx="22" cy="8" r="5" {...s} />
        {/* torso leaning forward */}
        <line x1="21" y1="13" x2="19" y2="28" {...s} />
        {f === 0 ? (
          <>
            {/* front arm swings back (up-back) */}
            <line x1="20" y1="18" x2="13" y2="13" {...s} />
            {/* rear arm swings forward (down-front) */}
            <line x1="20" y1="18" x2="28" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
            {/* front leg: thigh forward, shin down */}
            <line x1="19" y1="28" x2="26" y2="36" {...s} />
            <line x1="26" y1="36" x2="28" y2="48" {...s} />
            {/* rear leg: thigh back, shin kicks up */}
            <line x1="19" y1="28" x2="12" y2="36" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
            <line x1="12" y1="36" x2="16" y2="42" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          </>
        ) : (
          <>
            {/* front arm swings forward (down-front) */}
            <line x1="20" y1="18" x2="28" y2="14" {...s} />
            {/* rear arm swings back */}
            <line x1="20" y1="18" x2="12" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
            {/* front leg: knee lifted high */}
            <line x1="19" y1="28" x2="25" y2="34" {...s} />
            <line x1="25" y1="34" x2="22" y2="44" {...s} />
            {/* rear leg: fully extended back, toe off */}
            <line x1="19" y1="28" x2="11" y2="38" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
            <line x1="11" y1="38" x2="14" y2="48" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          </>
        )}
      </svg>
    );
  }

  if (phase === "celebrate") {
    // Facing forward (both arms & legs visible symmetrically), jumping
    const bounce = f === 0;
    const by = bounce ? 0 : 3; // vertical offset for jump
    return (
      <svg viewBox="0 0 40 52" width="32" height="52" overflow="visible">
        <circle cx="20" cy={7 - by} r="5" stroke="#fbbf24" strokeWidth="2" fill="none" />
        <line x1="20" y1={12 - by} x2="20" y2={28 - by} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        {/* both arms raised in V */}
        <line x1="20" y1={16 - by} x2="10" y2={9 - by} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1={16 - by} x2="30" y2={9 - by} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        {/* legs apart */}
        <line x1="20" y1={28 - by} x2="13" y2={42 - by} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        <line x1="13" y1={42 - by} x2="11" y2={48} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1={28 - by} x2="27" y2={42 - by} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
        <line x1="27" y1={42 - by} x2="29" y2={48} stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  // walking back — side profile, facing left (scaleX flip), calmer gait
  return (
    <svg viewBox="0 0 40 52" width="32" height="52" overflow="visible" style={{ transform: "scaleX(-1)" }}>
      <circle cx="20" cy="8" r="5" stroke="rgba(255,255,255,0.65)" strokeWidth="2" fill="none" />
      <line x1="20" y1="13" x2="20" y2="29" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
      {f === 0 ? (
        <>
          <line x1="20" y1="18" x2="13" y2="23" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="18" x2="26" y2="21" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="29" x2="25" y2="40" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
          <line x1="25" y1="40" x2="27" y2="48" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="29" x2="15" y2="38" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
          <line x1="15" y1="38" x2="14" y2="48" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <line x1="20" y1="18" x2="27" y2="23" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="18" x2="14" y2="21" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="29" x2="14" y2="40" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
          <line x1="14" y1="40" x2="13" y2="48" stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
          <line x1="20" y1="29" x2="25" y2="38" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
          <line x1="25" y1="38" x2="26" y2="48" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// ── Finish line SVG ───────────────────────────────────────────────────────────

function FinishLine({ height }: { height: number }) {
  const rows = Math.floor(height / 6);
  return (
    <svg width="10" height={height} style={{ display: "block" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <rect key={i} x={i % 2 === 0 ? 0 : 5} y={i * 6} width="5" height="6"
          fill={i % 2 === 0 ? "white" : "rgba(255,255,255,0.15)"} opacity="0.7" />
      ))}
    </svg>
  );
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function runFullSync(): Promise<void> {
  await Promise.allSettled([
    airtableApi.triggerSync(),
    salesforceApi.triggerSync(),
    integrationsApi.syncGoogleCalendar(),
  ]);

  // Push any locally-scheduled action items to Google Calendar after the pull completes.
  try {
    const raw = localStorage.getItem(SCHEDULED_ITEMS_KEY);
    const scheduled: Array<{ airtableId: string; task: string; accountName: string | null; start: string; end: string; googleEventId?: string }> = raw ? JSON.parse(raw) : [];
    if (scheduled.length > 0) {
      const { data } = await integrationsApi.pushActionItemsToGoogle(
        scheduled.map((s) => ({
          airtableId: s.airtableId,
          start: s.start,
          end: s.end,
          task: s.task,
          accountName: s.accountName ?? undefined,
          googleEventId: s.googleEventId,
        }))
      );
      if (data.results?.length) {
        const idMap = new Map(data.results.map((r: { airtableId: string; start: string; googleEventId: string }) => [`${r.airtableId}__${r.start.slice(0, 16)}`, r.googleEventId]));
        const updated = scheduled.map((s) => {
          const gid = idMap.get(`${s.airtableId}__${s.start.slice(0, 16)}`);
          return gid ? { ...s, googleEventId: gid } : s;
        });
        localStorage.setItem(SCHEDULED_ITEMS_KEY, JSON.stringify(updated));
        window.dispatchEvent(new StorageEvent("storage", { key: SCHEDULED_ITEMS_KEY, newValue: JSON.stringify(updated) }));
      }
    }
  } catch { /* non-blocking */ }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SyncRunner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [frame, setFrame] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [x, setX] = useState(0); // 0–100 % across track
  const [trackH, setTrackH] = useState(64);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(() => {
    const s = localStorage.getItem(LAST_SYNC_KEY);
    return s ? new Date(s) : null;
  });

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const moveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackWRef = useRef(240);

  // Measure actual track dimensions for finish line and stop position
  useEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver(() => {
      if (trackRef.current) {
        setTrackH(trackRef.current.clientHeight);
        trackWRef.current = trackRef.current.clientWidth;
      }
    });
    ro.observe(trackRef.current);
    setTrackH(trackRef.current.clientHeight);
    trackWRef.current = trackRef.current.clientWidth;
    return () => ro.disconnect();
  }, []);

  // Animation frame ticker
  useEffect(() => {
    const ms = phase === "running" ? 160 : phase === "celebrate" ? 240 : phase === "walking" ? 320 : 650;
    const id = setInterval(() => setFrame((f) => f + 1), ms);
    return () => clearInterval(id);
  }, [phase]);

  // Hover → crouch
  useEffect(() => {
    if (phase === "idle" || phase === "crouch") {
      setPhase(hovering ? "crouch" : "idle");
    }
  }, [hovering]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = useCallback(() => {
    if (phaseRef.current === "running" || syncing) return;
    setSyncing(true);
    setPhase("running");
    setX(0);

    const TICK = 40;

    // Fire all syncs immediately — animation runs until they all settle.
    let syncDone = false;
    runFullSync().then(() => {
      const now = new Date();
      setLastSync(now);
      localStorage.setItem(LAST_SYNC_KEY, now.toISOString());
      // Broadcast so any page that caches accounts/action-items re-fetches
      ["accountsUpdated", "actionItemsUpdated", "syncComplete"].forEach(key => {
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: now.toISOString() }));
      });
      syncDone = true;
    }).catch(() => { syncDone = true; });

    // Figure accelerates to ~80% of track quickly, then crawls to finish line
    // only once syncs are done — prevents premature celebration.
    const stopPct = () => {
      const w = trackWRef.current;
      return w > 0 ? Math.min(((w - 49) / w) * 100, 88) : 82;
    };

    // Phase 1: run quickly to 75% (approx 2.5s)
    const FAST_DURATION = 2500;
    const fastSteps = FAST_DURATION / TICK;
    let step = 0;
    const CRUISE_PCT = 75;

    let finalPct = 0;

    const celebrate = () => {
      finalPct = stopPct();
      clearInterval(moveRef.current!);
      setX(finalPct);
      setPhase("celebrate");
      setSyncing(false);

      setTimeout(() => {
        setPhase("walking");
        const WALK_MS = 3200;
        const wsteps = WALK_MS / TICK;
        let ws = 0;
        const wid = setInterval(() => {
          ws++;
          setX(Math.max(finalPct - (ws / wsteps) * finalPct, 0));
          if (ws >= wsteps) {
            clearInterval(wid);
            setX(0);
            setPhase("idle");
          }
        }, TICK);
      }, 4000);
    };

    moveRef.current = setInterval(() => {
      step++;
      const target = stopPct();

      if (step <= fastSteps) {
        // Fast run to cruise position
        setX(Math.min((step / fastSteps) * CRUISE_PCT, CRUISE_PCT));
      } else {
        // Slow crawl toward finish — only cross once sync is done
        if (syncDone) {
          const crawlStep = step - fastSteps;
          const crawlSteps = 20; // 20 ticks × 40ms = 800ms crawl to finish
          const pct = CRUISE_PCT + Math.min((crawlStep / crawlSteps) * (target - CRUISE_PCT), target - CRUISE_PCT);
          setX(pct);
          if (crawlStep >= crawlSteps) celebrate();
        }
        // else: stay at cruise pct, keep animating until syncDone flips
      }
    }, TICK);
  }, [syncing]);

  useEffect(() => () => { if (moveRef.current) clearInterval(moveRef.current); }, []);

  function formatLastSync(d: Date): string {
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const isMoving = phase === "running" || phase === "walking";
  const isCelebrating = phase === "celebrate";
  const isClickable = phase === "idle" || phase === "crouch";

  // Figure left position: clamp so it never exits the track visually
  // Figure SVG is 32px wide; track has 8px padding each side
  const figureLeftPct = x;

  return (
    <div style={{ userSelect: "none", width: "100%" }}>
      {/* Last sync timestamp */}
      <div style={{
        fontSize: "0.625rem",
        color: "rgba(255,255,255,0.3)",
        fontFamily: "var(--font-base)",
        paddingLeft: "14px",
        paddingTop: "8px",
        marginBottom: "5px",
        letterSpacing: "0.03em",
      }}>
        {lastSync ? `Synced ${formatLastSync(lastSync)}` : "Never synced"}
      </div>

      {/* Track — no background, no border, full width, tall enough to never clip figure */}
      <div
        ref={trackRef}
        onClick={() => { if (isClickable) startRun(); }}
        onMouseEnter={() => { if (phase === "idle") setHovering(true); }}
        onMouseLeave={() => { setHovering(false); }}
        title={syncing ? "Syncing…" : isClickable ? "Click to sync all data" : undefined}
        style={{
          position: "relative",
          /* 75px × 0.7 = 52.5 → 53px. Figure is scaled down via transform. */
          height: "53px",
          width: "100%",
          cursor: isClickable ? "pointer" : "default",
          overflow: "hidden",
        }}
      >
        {/* Ground line — edge to edge */}
        <div style={{
          position: "absolute",
          bottom: "4px",
          left: 0,
          right: 0,
          height: "1px",
          background: "rgba(255,255,255,0.12)",
        }} />

        {/* Dotted trail behind figure */}
        {isMoving && (
          <div style={{
            position: "absolute",
            bottom: "4px",
            left: 0,
            width: `${figureLeftPct}%`,
            height: "1px",
            borderTop: "2px dashed rgba(255,255,255,0.3)",
            pointerEvents: "none",
          }} />
        )}

        {/* Finish line — right edge, scaled to new track height */}
        {(phase === "running" || phase === "celebrate") && (
          <div style={{
            position: "absolute",
            right: "25px",
            bottom: "4px",
            transform: "translateY(-1px)",
          }}>
            <FinishLine height={Math.round((trackH - 10) * 0.7)} />
          </div>
        )}

        {/* Celebration sparkles */}
        {isCelebrating && ["25%", "50%", "75%"].map((left, i) => (
          <div key={i} style={{
            position: "absolute",
            left,
            top: "4px",
            fontSize: "0.5625rem",
            color: "#fbbf24",
            animation: `syncSparkle ${0.55 + i * 0.18}s ease-in-out infinite alternate`,
            pointerEvents: "none",
          }}>★</div>
        ))}

        {/* State labels */}
        {phase === "idle" && (
          <div style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-60%)",
            fontSize: "0.5625rem",
            color: "rgba(255,255,255,0.22)",
            fontFamily: "var(--font-base)",
            letterSpacing: "0.04em",
          }}>sync ↗</div>
        )}
        {phase === "running" && (
          <div style={{
            position: "absolute",
            top: "2px",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "0.5625rem",
            color: "rgba(255,255,255,0.35)",
            fontFamily: "var(--font-base)",
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}>syncing…</div>
        )}
        {isCelebrating && (
          <div style={{
            position: "absolute",
            top: "2px",
            left: "50%",
            right: "55px",
            transform: "translateX(-35%)",
            fontSize: "0.5625rem",
            color: "#fbbf24",
            fontFamily: "var(--font-base)",
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}>all synced!</div>
        )}

        {/* The figure — scaled to 0.7× anchored at its bottom-left foot */}
        <div style={{
          position: "absolute",
          bottom: "5px",
          left: `${figureLeftPct}%`,
          transformOrigin: "bottom left",
          transform: "translateX(-1px) scale(0.7)",
          transition: isMoving ? "left 0.04s linear" : "left 0.35s ease",
          pointerEvents: "none",
          lineHeight: 0,
        }}>
          <Figure phase={phase} frame={frame} color={isCelebrating ? "#fbbf24" : "white"} />
        </div>
      </div>

      <style>{`
        @keyframes syncSparkle {
          from { transform: scale(0.7) translateY(2px); opacity: 0.5; }
          to   { transform: scale(1.4) translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
