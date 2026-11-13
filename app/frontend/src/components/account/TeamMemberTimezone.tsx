import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z } from "../../lib/zLayers";
import TimezoneField, { ContactLocalTime } from "./TimezoneField";
import { teamApi } from "../../lib/api";
import type { TeamMember } from "../../types";

/** Tooltip text explaining where a team member's zone came from. */
export function timezoneTooltip(m: Pick<TeamMember, "timezone" | "timezone_source" | "assigned_by_username">): string {
  if (!m.timezone) return "No time zone set";
  if (m.timezone_source === "assigned") {
    return `${m.timezone} - assigned by ${m.assigned_by_username || "a teammate"}. Their own setting will override this.`;
  }
  return `${m.timezone} - set by them`;
}

/**
 * Local time under a Twilio Team chip. With no zone it offers "Set time zone", which records an
 * assignment (the person's own profile setting always overrides it). Sits OUTSIDE the chip button.
 */
export default function TeamMemberTimezone({
  member,
  onUpdated,
}: {
  member: TeamMember;
  onUpdated: (m: TeamMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = member.timezone_source ?? "";
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const reposition = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const width = 240;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 4, left });
  }, []);

  useLayoutEffect(() => { if (open) reposition(); }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await teamApi.assignMemberTimezone(member.id, next);
      onUpdated(data);
      setOpen(false);
      setZone("");
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string; timezone?: string[] } } }).response?.data;
      setError(detail?.detail ?? detail?.timezone?.[0] ?? "Could not save the time zone.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={anchorRef} className="relative flex flex-col items-center" data-testid={`member-tz-${member.id}`}>
      {member.timezone ? (
        <span title={timezoneTooltip(member)} className="flex items-center gap-0.5">
          <ContactLocalTime zone={member.timezone} />
          {source === "assigned" && (
            <button
              type="button"
              aria-label={`Change time zone for ${member.full_name}`}
              onClick={() => { setOpen((v) => !v); setZone(member.timezone ?? ""); setError(null); }}
              className="text-[10px] text-indigo-600 hover:text-indigo-800"
            >✎</button>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setError(null); }}
          className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 leading-tight"
        >Set time zone</button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Time zone for ${member.full_name}`}
          data-testid={`member-tz-popover-${member.id}`}
          className="w-60 rounded-md border border-gray-200 bg-white p-2 shadow-lg text-left"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: Z.popover }}
        >
          <TimezoneField value={zone} onChange={setZone} />
          <p className="mt-1 text-[10px] text-[var(--twilio-gray-60)]">
            Used until {member.full_name.split(" ")[0]} sets their own time zone, which always takes over.
          </p>
          {error && <p role="alert" className="mt-1 text-[11px] text-red-600">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-2">
            {source === "assigned" && (
              <button type="button" disabled={busy} onClick={() => void save("")} className="text-[11px] font-semibold text-red-600 disabled:opacity-40">Remove</button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-[var(--twilio-gray-60)]">Cancel</button>
            <button
              type="button"
              disabled={busy || !zone}
              onClick={() => void save(zone)}
              className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >Save</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
