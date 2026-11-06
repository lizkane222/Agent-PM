import { Link } from "react-router-dom";
import type { AirtableActionItem } from "../../types";

/**
 * The records a calendar item belongs to, shown in its detail panel: the account (a link to
 * its page) and, for an action-item block, the action item (opens the shared ActionItemModal —
 * no navigation, the same editing surface used everywhere else).
 */
export function AccountRecordLink({ accountName, accountId }: { accountName: string; accountId: number | null }) {
  if (accountId == null) return <span className="font-medium text-[var(--twilio-navy)] truncate">{accountName}</span>;
  return (
    <Link
      to={`/accounts/${accountId}`}
      data-testid="panel-account-link"
      className="font-medium text-indigo-600 hover:underline truncate"
      title={`Open ${accountName}`}
    >
      {accountName}
    </Link>
  );
}

export function ActionItemRecordButton({ item, onOpen }: { item: AirtableActionItem; onOpen: (item: AirtableActionItem) => void }) {
  return (
    <button
      type="button"
      data-testid="panel-action-item-link"
      onClick={() => onOpen(item)}
      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 border border-violet-200 bg-violet-50/60 text-left hover:bg-violet-100 transition-colors"
      title="Open action item"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4 shrink-0 text-violet-500">
        <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-wide text-violet-500 font-semibold">Action item</span>
        <span className="block text-sm font-medium text-[var(--twilio-navy)] truncate">{item.task || "Untitled"}</span>
      </span>
    </button>
  );
}
