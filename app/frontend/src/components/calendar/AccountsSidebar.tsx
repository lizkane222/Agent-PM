import { useState, useEffect } from "react";
import { airtableApi, accountsApi } from "../../lib/api";
import type { AirtableAccount } from "../../types";
import CorporateIcon from "../../assets/icons/Corporate.svg?react";
import {
  CALENDAR_DRAG_KEY,
  CALENDAR_DRAG_ACCOUNT_KEY,
  CALENDAR_DRAG_EVENT_KEY,
} from "./calendarHelpers";

export default function AccountsSidebar({
  open,
  onToggle,
  eventAccountLinks: _eventAccountLinks,
  onLink,
  selectedAccountName,
  onSelectAccount,
  logTimeModeAccount,
  onLogTimeMode,
  overLeftNav = false,
  isUnlinkedView = false,
  onShowUnlinkedView,
  unlinkedCount,
}: {
  open: boolean;
  onToggle: () => void;
  eventAccountLinks: Map<string, { accountName: string; accountId: number }>;
  onLink: (accountId: number, accountName: string, eventUid?: string) => void;
  selectedAccountName: string | null;
  onSelectAccount: (name: string | null) => void;
  logTimeModeAccount: string | null;
  onLogTimeMode: (accountName: string | null) => void;
  /** When true (log-time mode) the panel uses fixed positioning to overlay the left nav. */
  overLeftNav?: boolean;
  isUnlinkedView?: boolean;
  onShowUnlinkedView?: () => void;
  unlinkedCount?: number;
}) {
  const [accounts, setAccounts] = useState<AirtableAccount[]>([]);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      airtableApi.listAccounts(),
      accountsApi.listAccounts(),
      accountsApi.getAdminAccount(),
    ]).then(([atRes, appRes, adminRes]) => {
      const atAccounts = atRes.data.results as AirtableAccount[];
      const adminAcct = adminRes.data as { id: number; company_name: string };
      const adminNameLower = adminAcct.company_name?.toLowerCase();
      // Exclude any AirtableAccount whose name matches the personal admin account —
      // the admin pill is per-user and supersedes any shared Airtable "Admin"/"ADMIN" row.
      const filteredAtAccounts = atAccounts.filter(
        (a) => a.name?.toLowerCase() !== adminNameLower
      );
      const atNames = new Set(filteredAtAccounts.map((a) => a.name?.toLowerCase()));
      const appOnly = (appRes.data.results as { id: number; company_name: string; is_admin_account?: boolean }[])
        .filter((a) => !a.is_admin_account && !atNames.has(a.company_name?.toLowerCase()))
        .map((a) => ({ id: a.id, name: a.company_name } as AirtableAccount));
      const adminPill = { id: adminAcct.id, name: adminAcct.company_name } as AirtableAccount;
      const merged = [adminPill, ...filteredAtAccounts, ...appOnly].sort((a, b) =>
        a.name === adminAcct.company_name ? -1 : b.name === adminAcct.company_name ? 1 : a.name.localeCompare(b.name)
      );
      setAccounts(merged);
    }).catch(() => {
      // Fallback without admin account
      Promise.all([airtableApi.listAccounts(), accountsApi.listAccounts()]).then(([atRes, appRes]) => {
        const atAccounts = atRes.data.results as AirtableAccount[];
        const atNames = new Set(atAccounts.map((a) => a.name?.toLowerCase()));
        const appOnly = (appRes.data.results as { id: number; company_name: string }[])
          .filter((a) => !atNames.has(a.company_name?.toLowerCase()))
          .map((a) => ({ id: a.id, name: a.company_name } as AirtableAccount));
        setAccounts([...atAccounts, ...appOnly].sort((a, b) => a.name.localeCompare(b.name)));
      }).catch(() => {});
    });
  }, []);

  function handleAccountDragStart(e: React.DragEvent, account: AirtableAccount) {
    e.dataTransfer.setData("calendarAccountId", String(account.id));
    e.dataTransfer.setData("calendarAccountName", account.name);
    e.dataTransfer.effectAllowed = "copy";
    (window as unknown as Record<string, string>)[CALENDAR_DRAG_ACCOUNT_KEY] = String(account.id);
    (window as unknown as Record<string, string>)[`${CALENDAR_DRAG_ACCOUNT_KEY}_name`] = account.name;

    // Build a pill as the drag image. Must be in the DOM when setDragImage is called,
    // then removed immediately after so it never flashes on screen.
    const pill = document.createElement("div");
    pill.style.cssText = "position:fixed;top:-200px;left:-200px;background:#4f46e5;color:#fff;padding:5px 14px;border-radius:9999px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 4px 14px rgba(79,70,229,0.45);pointer-events:none";
    pill.textContent = account.name;
    document.body.appendChild(pill);
    e.dataTransfer.setDragImage(pill, 60, 14);
    // Defer state + DOM cleanup — changing state during dragstart breaks the drag
    setTimeout(() => { document.body.removeChild(pill); setDraggingId(account.id); }, 0);
  }

  function handleDropOnAccount(e: React.DragEvent, account: AirtableAccount) {
    e.preventDefault();
    setDropTargetId(null);
    const w = window as unknown as Record<string, string>;
    // Calendar event dragged onto account chip
    const eventUid = w[CALENDAR_DRAG_EVENT_KEY];
    if (eventUid) {
      delete w[CALENDAR_DRAG_EVENT_KEY];
      onLink(account.id, account.name, eventUid);
      return;
    }
    // Action item dragged onto account chip — update its account association
    const airtableId = w[CALENDAR_DRAG_KEY];
    if (airtableId) {
      delete w[CALENDAR_DRAG_KEY];
      delete w[`${CALENDAR_DRAG_KEY}_task`];
      delete w[`${CALENDAR_DRAG_KEY}_account`];
      delete w[`${CALENDAR_DRAG_KEY}_est`];
      airtableApi.updateActionItemFields(airtableId, { account: account.id, account_name: account.name }).catch(() => {});
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
    }
  }

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={[
          "absolute top-4 left-4 z-30 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border shadow-sm transition-colors",
          open
            ? "bg-indigo-600 border-indigo-600 text-white shadow-md"
            : "bg-white border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50 hover:border-indigo-300",
        ].join(" ")}
      >
        <CorporateIcon className="w-3.5 h-3.5 shrink-0" />
        Accounts
      </button>

      {/* Overlay panel — absolute (default) or fixed over left nav (log-time mode) */}
      <div
        className={[
          overLeftNav
            ? "fixed inset-y-0 left-0 z-50"
            : "absolute top-0 left-0 h-full z-20",
          "flex flex-col bg-white border-r border-gray-200 shadow-2xl transition-transform duration-300",
          "w-[276px]",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="h-16 shrink-0" />
        <p className="px-4 pb-2 text-[11px] text-[var(--twilio-gray-60)]">
          Drag an account onto a calendar event · or drag an event onto an account
        </p>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {accounts.filter((acct) => !!acct.name).map((acct) => {
            const isSelected = selectedAccountName === acct.name;
            return (
              <div
                key={acct.name}
                draggable
                onClick={() => onSelectAccount(selectedAccountName === acct.name ? null : acct.name)}
                onDragStart={(e) => handleAccountDragStart(e, acct)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(e) => { e.preventDefault(); setDropTargetId(acct.id); }}
                onDragLeave={() => setDropTargetId(null)}
                onDrop={(e) => handleDropOnAccount(e, acct)}
                className={[
                  "rounded-lg p-4 cursor-pointer transition-all select-none border",
                  draggingId === acct.id
                    ? "opacity-40 scale-95 bg-indigo-50 border-indigo-300"
                    : dropTargetId === acct.id
                    ? "bg-indigo-50 border-indigo-400 border-2 shadow-md"
                    : isSelected
                    ? "bg-indigo-600 border-indigo-600 shadow-md"
                    : "bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-indigo-300",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <div className={["h-9 w-9 rounded-full flex items-center justify-center shrink-0", isSelected ? "bg-indigo-500 text-white" : "bg-indigo-50 text-indigo-600"].join(" ")}>
                    <CorporateIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={["text-sm font-semibold truncate", isSelected ? "text-white" : "text-[var(--twilio-navy)]"].join(" ")}>{acct.name}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {accounts.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)] px-1">No accounts found.</p>}
        </div>

        {/* Unlinked Accounts view button */}
        {onShowUnlinkedView && (
          <div className="shrink-0 px-3 pb-2">
            <button
              onClick={onShowUnlinkedView}
              className={[
                "w-full flex items-center justify-between gap-2 rounded-xl py-2 px-3 text-sm font-semibold transition-colors border",
                isUnlinkedView
                  ? "bg-[var(--twilio-navy)] border-[var(--twilio-navy)] text-white"
                  : "bg-white border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 hover:border-indigo-300 shadow-sm",
              ].join(" ")}
            >
              <div className="flex items-center gap-1. whitespace-nowrap">
                {/* broken chain link icon */}
                {/* <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-3. h-3.5 shrink-0">
                  <path d="M5.5 9.5H3.5a2.5 2.5 0 010-5H6a2.5 2.5 0 012 1"/>
                  <path d="M10.5 6.5H12.5a2.5 2.5 0 010 5H10a2.5 2.5 0 01-2-1"/>
                  <path d="M2 14L14 2"/>
                </svg> */}
                <span>Unlinked Events / Accounts</span>
                <span className={isUnlinkedView ? "text-white/70" : "text-gray-400"}></span>
              </div>
              {unlinkedCount !== undefined && unlinkedCount > 0 && (
                <span className={[
                  "text-[9px] font-bold rounded-full px-2 py-0.5",
                  isUnlinkedView ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600",
                ].join(" ")}>
                  {unlinkedCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Log Time footer — always visible at the bottom of the sidebar */}
        <div className="shrink-0 px-3 py-3 border-t border-gray-100">
          {!selectedAccountName ? (
            <p className="text-[11px] text-center text-[var(--twilio-gray-60)] px-1">Select an account above to log time</p>
          ) : null}
          <button
            disabled={!selectedAccountName && !logTimeModeAccount}
            onClick={() => onLogTimeMode(logTimeModeAccount ? null : selectedAccountName)}
            className={[
              "mt-1 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors border whitespace-nowrap",
              logTimeModeAccount
                ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
                : selectedAccountName
                ? "bg-[var(--twilio-navy)] border-[var(--twilio-navy)] text-white hover:opacity-90"
                : "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed",
            ].join(" ")}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
            </svg>
            {logTimeModeAccount ? `Exit Log Time` : "Log Time to Salesforce"}
          </button>
          {logTimeModeAccount && (
            <p className="mt-1.5 text-[10px] text-center text-emerald-700 font-medium">{logTimeModeAccount}</p>
          )}
        </div>
      </div>
    </>
  );
}
