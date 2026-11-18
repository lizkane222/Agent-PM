import { useEffect, useRef, useState } from "react";
import type { Account } from "../../types";
import type { AppletPin } from "../../types/discover";

/**
 * Pin button for a Discovery card. Opens a small popover: pin to my own profile, or to an
 * account I'm on. Rows already pinned are checked; clicking one unpins it (when allowed).
 */
export default function PinMenu({
  appletId, appletName, pins, accounts, onPin, onUnpin,
}: {
  appletId: number;
  appletName: string;
  /** Every pin the caller can see (any applet). */
  pins: AppletPin[];
  accounts: Account[];
  onPin: (appletId: number, accountId: number | null) => Promise<unknown>;
  onUnpin: (pinId: number) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pickAccount, setPickAccount] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const mine = pins.filter((p) => p.applet.id === appletId);
  const profilePin = mine.find((p) => p.account === null);
  const accountPin = (id: number) => mine.find((p) => p.account === id);
  const pinned = mine.length > 0;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch { setError("Could not update the pin. Try again."); }
    finally { setBusy(false); }
  };

  const toggle = (accountId: number | null) => {
    const existing = accountId === null ? profilePin : accountPin(accountId);
    if (existing) {
      if (!existing.can_remove) return;
      return run(() => onUnpin(existing.id));
    }
    return run(() => onPin(appletId, accountId));
  };

  const shown = accounts.filter((a) => a.company_name.toLowerCase().includes(query.trim().toLowerCase()));
  const row = "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--surface-subtle-2)] disabled:opacity-50";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Pin ${appletName}`}
        aria-expanded={open}
        aria-pressed={pinned}
        title={pinned ? "Pinned — manage pins" : "Pin"}
        className="flex items-center justify-center rounded transition-colors hover:bg-[var(--surface-subtle-2)]"
        style={{ width: 22, height: 22, color: pinned ? "var(--twilio-red, #e22)" : "var(--twilio-gray-60, #6b7280)" }}
      >
        <svg viewBox="0 0 16 16" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
          <path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3-1 1-3-3-4 4-.5-.5 4-4-3-3 1-1 3 .5L9 3.5l.5-2z" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Pin ${appletName}`}
          className="absolute right-0 bottom-full mb-1 z-40 w-60 rounded-lg shadow-lg py-1"
          style={{ background: "var(--surface-card, #fff)", border: "1px solid var(--border-subtle, #e5e7eb)", color: "var(--text-primary, #111)" }}
        >
          <button type="button" className={row} disabled={busy} onClick={() => toggle(null)} aria-pressed={!!profilePin}>
            <span aria-hidden="true" style={{ width: 12 }}>{profilePin ? "✓" : ""}</span>
            Pin to my profile
          </button>
          <button
            type="button"
            className={row}
            onClick={() => setPickAccount((v) => !v)}
            aria-expanded={pickAccount}
          >
            <span aria-hidden="true" style={{ width: 12 }}>{pickAccount ? "▾" : "▸"}</span>
            Pin to an account…
          </button>
          {pickAccount && (
            <div className="px-2 pb-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search accounts…"
                aria-label="Search accounts"
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs mb-1"
              />
              <div className="max-h-40 overflow-y-auto">
                {shown.length === 0 && (
                  <p className="px-1 py-1 text-[11px]" style={{ color: "var(--text-secondary, #9ca3af)" }}>No accounts found.</p>
                )}
                {shown.map((a) => {
                  const existing = accountPin(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={row}
                      disabled={busy || (!!existing && !existing.can_remove)}
                      title={existing && !existing.can_remove ? `Pinned by ${existing.pinned_by_username}` : undefined}
                      aria-pressed={!!existing}
                      onClick={() => toggle(a.id)}
                    >
                      <span aria-hidden="true" style={{ width: 12 }}>{existing ? "✓" : ""}</span>
                      <span className="truncate">{a.company_name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {error && <p role="alert" className="px-3 py-1 text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
