/**
 * PendingReviewBadge — sidebar button showing pending_human review count for
 * an account, opens an inline modal to accept/reject items.
 */

import { useCallback, useEffect, useState } from "react";
import { syncReviewApi, accountsApi } from "../../lib/api";
import type { Account, SyncReviewItem } from "../../types";

interface Props {
  accountId: number;
}

const SOURCE_LABEL: Record<string, string> = {
  gdrive: "Drive",
  gmail: "Gmail",
  confluence: "Confluence",
  jira: "JIRA",
  zendesk: "Zendesk",
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  document: "Document",
  email: "Email",
  ticket: "Ticket",
  page: "Page",
  internal_email: "Internal Email",
};

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  items: SyncReviewItem[];
  accounts: Account[];
  onAccepted: (id: number, accountId: number) => Promise<void>;
  onRejected: (id: number) => Promise<void>;
  onClose: () => void;
}

function ReviewModal({ items, accounts, onAccepted, onRejected, onClose }: ModalProps) {
  const [selectedAccount, setSelectedAccount] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    items.forEach((item) => {
      if (item.suggested_account) init[item.id] = item.suggested_account;
    });
    return init;
  });
  const [acting, setActing] = useState<number | null>(null);

  async function accept(item: SyncReviewItem) {
    const accountId = selectedAccount[item.id];
    if (!accountId) return;
    setActing(item.id);
    try {
      await onAccepted(item.id, accountId);
    } finally {
      setActing(null);
    }
  }

  async function reject(item: SyncReviewItem) {
    setActing(item.id);
    try {
      await onRejected(item.id);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Pending Review Items</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No items pending review.</p>
          ) : items.map((item) => {
            const title = (item.raw_content as Record<string, string>)["title"] ?? item.source_id;
            const isBusy = acting === item.id;
            return (
              <div key={item.id} className="border border-gray-200 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {SOURCE_LABEL[item.source] ?? item.source} · {CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}
                  {item.confidence_score != null && <> · {Math.round(item.confidence_score * 100)}% confidence</>}
                </p>
                {item.claude_analysis && (
                  <p className="text-xs text-gray-600 bg-gray-50 rounded p-1.5 mt-1.5">{item.claude_analysis}</p>
                )}

                <div className="flex items-center gap-2 mt-2">
                  <select
                    value={selectedAccount[item.id] ?? 0}
                    onChange={(e) => setSelectedAccount((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                    className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={0}>Select account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.company_name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => accept(item)}
                    disabled={isBusy || !selectedAccount[item.id]}
                    className="px-2.5 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
                  >
                    {isBusy ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => reject(item)}
                    disabled={isBusy}
                    className="px-2.5 py-1 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {isBusy ? "…" : "Reject"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Badge button ──────────────────────────────────────────────────────────────

export function PendingReviewBadge({ accountId }: Props) {
  const [items, setItems] = useState<SyncReviewItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      const { data } = await syncReviewApi.listItems({ status: "pending_human" });
      const filtered = data.results.filter((i) => i.suggested_account === accountId);
      setItems(filtered);
    } catch { /* silently ignore */ }
  }, [accountId]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  function handleOpen() {
    accountsApi.listAccounts({ page_size: "500" }).then(({ data }) => {
      setAccounts(data.results ?? []);
    }).catch(() => {});
    setOpen(true);
  }

  async function accepted(id: number, accId: number) {
    await syncReviewApi.acceptItem(id, accId);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function rejected(id: number) {
    await syncReviewApi.rejectItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        onClick={handleOpen}
        className="relative flex items-center gap-1.5 w-full text-left px-2 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-orange-50"
        style={{ color: "var(--twilio-navy)" }}
        title="Pending review items for this account"
      >
        <svg className="w-3.5 h-3.5 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span>Review</span>
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
          {items.length}
        </span>
      </button>

      {open && (
        <ReviewModal
          items={items}
          accounts={accounts}
          onAccepted={accepted}
          onRejected={rejected}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
