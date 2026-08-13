/**
 * SyncReviewPage — staff/reviewer queue for externally synced content.
 * Tabs: Pending Items | Delete Requests
 */

import { useCallback, useEffect, useState } from "react";
import { syncReviewApi, accountsApi } from "../lib/api";
import type { Account, SyncDeleteRequest, SyncReviewItem } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  gdrive: "Google Drive",
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

const STATUS_CHIP: Record<string, string> = {
  pending_agent: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  pending_human: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  accepted: "bg-green-50 text-green-700 ring-1 ring-green-200",
  rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
  unassigned: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  pending_agent: "Agent Review",
  pending_human: "Needs Review",
  accepted: "Accepted",
  rejected: "Rejected",
  unassigned: "Unassigned",
};

const DELETE_STATUS_CHIP: Record<string, string> = {
  pending: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  approved: "bg-green-50 text-green-700 ring-1 ring-green-200",
  rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Accept modal ──────────────────────────────────────────────────────────────

interface AcceptModalProps {
  item: SyncReviewItem;
  accounts: Account[];
  onConfirm: (accountId: number) => Promise<void>;
  onClose: () => void;
}

function AcceptModal({ item, accounts, onConfirm, onClose }: AcceptModalProps) {
  const [accountId, setAccountId] = useState<number>(item.suggested_account ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!accountId) { setError("Select an account"); return; }
    setSaving(true);
    try {
      await onConfirm(accountId);
      onClose();
    } catch {
      setError("Failed to accept item");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-base font-semibold mb-1">Accept Review Item</h3>
        <p className="text-sm text-gray-500 mb-4">
          Assign <span className="font-medium">{(item.raw_content as Record<string, string>)["title"] ?? item.source_id}</span> to an account.
        </p>
        <label className="block text-xs font-medium text-gray-600 mb-1">Account</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={0}>-- Select account --</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.company_name}</option>
          ))}
        </select>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Items tab ─────────────────────────────────────────────────────────────────

interface ItemsTabProps {
  accounts: Account[];
}

function ItemsTab({ accounts }: ItemsTabProps) {
  const [items, setItems] = useState<SyncReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending_human");
  const [acceptTarget, setAcceptTarget] = useState<SyncReviewItem | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await syncReviewApi.listItems(statusFilter ? { status: statusFilter } : undefined);
      setItems(data.results);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  async function reject(item: SyncReviewItem) {
    await syncReviewApi.rejectItem(item.id);
    void load();
  }

  async function accept(accountId: number) {
    if (!acceptTarget) return;
    await syncReviewApi.acceptItem(acceptTarget.id, accountId);
    setAcceptTarget(null);
    void load();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs font-medium text-gray-600">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All</option>
          <option value="pending_human">Needs Review</option>
          <option value="pending_agent">Agent Review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">No items found.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const title = (item.raw_content as Record<string, string>)["title"] ?? item.source_id;
            const isOpen = expanded === item.id;
            return (
              <div key={item.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div
                  className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 truncate">{title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_CHIP[item.status]}`}>
                        {STATUS_LABEL[item.status]}
                      </span>
                      {item.is_sensitive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-200">Sensitive</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {SOURCE_LABEL[item.source] ?? item.source} · {CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}
                      {item.suggested_account_name && <> · <span className="text-blue-600">{item.suggested_account_name}</span></>}
                      {item.confidence_score != null && <> · {Math.round(item.confidence_score * 100)}% confidence</>}
                      <> · {fmtDate(item.created_at)}</>
                    </p>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>

                {isOpen && (
                  <div className="px-3 pb-3 border-t border-gray-100">
                    {item.source_url && (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline block mt-2 mb-1 truncate">{item.source_url}</a>
                    )}
                    {item.claude_analysis && (
                      <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 mt-2">{item.claude_analysis}</p>
                    )}
                    <div className="text-xs text-gray-500 mt-2 font-mono">
                      <pre className="overflow-auto max-h-32 text-[11px] bg-gray-50 rounded p-2">{JSON.stringify(item.raw_content, null, 2)}</pre>
                    </div>

                    {(item.status === "pending_human" || item.status === "unassigned") && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => setAcceptTarget(item)}
                          className="px-3 py-1.5 text-xs rounded-md bg-green-600 text-white hover:bg-green-700"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => reject(item)}
                          className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {acceptTarget && (
        <AcceptModal
          item={acceptTarget}
          accounts={accounts}
          onConfirm={accept}
          onClose={() => setAcceptTarget(null)}
        />
      )}
    </div>
  );
}

// ── Delete Requests tab ───────────────────────────────────────────────────────

function DeleteRequestsTab() {
  const [requests, setRequests] = useState<SyncDeleteRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await syncReviewApi.listDeleteRequests({ status: "pending" });
      setRequests(data.results);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function resolve(req: SyncDeleteRequest, decision: "approved" | "rejected") {
    await syncReviewApi.resolveDeleteRequest(req.id, decision);
    void load();
  }

  return (
    <div>
      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="text-sm text-gray-400 py-8 text-center">No pending delete requests.</div>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div key={req.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">Delete Request #{req.id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${DELETE_STATUS_CHIP[req.status]}`}>
                      {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Account: <span className="text-blue-600">{req.account_name}</span>
                    {" · "}Requested by {req.requested_by_email}
                    {" · "}{fmtDate(req.created_at)}
                  </p>
                  {req.reason && <p className="text-xs text-gray-700 mt-1 italic">"{req.reason}"</p>}
                  {req.claude_mismatch_analysis && (
                    <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 mt-2">{req.claude_mismatch_analysis}</p>
                  )}
                </div>
              </div>
              {req.status === "pending" && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => resolve(req, "approved")}
                    className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Approve Removal
                  </button>
                  <button
                    onClick={() => resolve(req, "rejected")}
                    className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Keep Item
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "items" | "delete-requests";

export default function SyncReviewPage() {
  const [tab, setTab] = useState<Tab>("items");
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    accountsApi.listAccounts({ page_size: "500" }).then(({ data }) => {
      setAccounts(data.results ?? []);
    }).catch(() => {});
  }, []);

  const TABS: { id: Tab; label: string }[] = [
    { id: "items", label: "Review Items" },
    { id: "delete-requests", label: "Delete Requests" },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Sync Review Queue</h1>
      <p className="text-sm text-gray-500 mb-5">Review externally synced content before it is linked to an account.</p>

      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "items" && <ItemsTab accounts={accounts} />}
      {tab === "delete-requests" && <DeleteRequestsTab />}
    </div>
  );
}
