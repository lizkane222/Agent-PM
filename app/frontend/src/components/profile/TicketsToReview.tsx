import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAccountTickets } from "../../hooks/useAccountTickets";
import { useResource } from "../../hooks/useResource";
import { useAppError } from "../../context/AppErrorContext";
import { accountsApi } from "../../lib/api";
import { TICKET_KINDS, TICKET_KIND_LABEL } from "../../lib/tickets";
import type { Account, AccountTicket, TicketKind } from "../../types";

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export function ReviewRow({ ticket, accounts, onAssign, onDismiss, pinned = false }: {
  ticket: AccountTicket;
  /** Shown pinned at the front of its section's list, marked as waiting for an account. */
  pinned?: boolean;
  accounts: Account[];
  onAssign: (t: AccountTicket, account: number, kind: TicketKind) => Promise<void>;
  onDismiss: (t: AccountTicket) => void;
}) {
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<TicketKind>(ticket.kind);
  const q = search.trim().toLowerCase();
  const options = accounts.filter((a) => !q || a.company_name.toLowerCase().includes(q));

  return (
    <div className="rounded-lg p-3 mb-2"
      style={{
        background: pinned ? "var(--tint-amber-50)" : "var(--surface, #fff)",
        border: pinned ? "1px solid #fcd34d" : "1px solid var(--border, rgba(0,0,0,0.08))",
        borderLeft: pinned ? "4px solid #f59e0b" : undefined,
      }}
      data-testid={`review-row-${ticket.id}`}
      {...(pinned ? { "data-ticket-pinned": "true" } : {})}>
      {pinned && <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1">📌 Pinned · needs an account</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-[var(--twilio-gray-60)]">{TICKET_KIND_LABEL[ticket.kind]}</span>
        <span className="text-sm font-semibold text-[var(--twilio-navy)]">{ticket.title || ticket.external_key || "Untitled"}</span>
        {ticket.url && <a href={ticket.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">Open link</a>}
      </div>
      {(ticket.source_subject || ticket.source_sender) && (
        <p className="text-xs text-[var(--twilio-gray-60)] mt-1">
          {ticket.source_subject}{ticket.source_subject && ticket.source_sender ? " — " : ""}{ticket.source_sender}
        </p>
      )}
      {ticket.source_snippet && <p className="text-xs text-[var(--twilio-gray-60)] mt-1 line-clamp-2">{ticket.source_snippet}</p>}

      <div className="flex items-center gap-2 flex-wrap mt-2">
        <input aria-label="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts…"
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs w-36 focus:outline-none focus:border-indigo-400" />
        <select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:border-indigo-400">
          <option value="">Choose account…</option>
          {options.map((a) => <option key={a.id} value={a.id}>{a.company_name}</option>)}
        </select>
        <select aria-label="Category" value={kind} onChange={(e) => setKind(e.target.value as TicketKind)}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:border-indigo-400">
          {TICKET_KINDS.map((k) => <option key={k} value={k}>{TICKET_KIND_LABEL[k]}</option>)}
        </select>
        <button type="button" disabled={!accountId} onClick={() => void onAssign(ticket, Number(accountId), kind)}
          className="rounded-lg bg-[var(--twilio-navy)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Add to account</button>
        <button type="button" onClick={() => onDismiss(ticket)}
          className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-[var(--twilio-gray-60)] hover:text-red-600">Dismiss</button>
      </div>
    </div>
  );
}

/** Tickets found in email that matched no account. Only the finder sees them; renders nothing when empty. */
export default function TicketsToReview({ kinds }: { kinds?: readonly TicketKind[] } = {}) {
  const { data: all, assignTicket, removeTicket } = useAccountTickets({ review: "needs_review" });
  // Kinds that have their own section on the page show their pinned cards there instead.
  const data = kinds ? all.filter((t) => kinds.includes(t.kind)) : all;
  const accounts = useResource<Account>(() => accountsApi.listAccounts({ page_size: "500" }).then((r) => r.data.results), []);
  const { reportError } = useAppError();
  const { hash } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const show = data.length > 0;

  useEffect(() => {
    if (show && hash === "#ticket-review") ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [show, hash]);

  if (!show) return null;

  async function assign(t: AccountTicket, account: number, kind: TicketKind) {
    try {
      await assignTicket(t.id, { account, kind });
    } catch (e) {
      reportError(errMsg(e, "Could not add the record to that account."));
    }
  }

  function dismiss(t: AccountTicket) {
    if (!window.confirm(`Dismiss "${t.title || t.external_key || "this record"}"?`)) return;
    void removeTicket(t.id).catch((e) => reportError(errMsg(e, "Could not dismiss the record.")));
  }

  return (
    <div id="ticket-review" ref={ref} className="rounded-xl p-4 mb-5" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
      <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1">Tickets to review</p>
      <p className="text-xs text-[var(--twilio-gray-60)] mb-3">Found in your email but not matched to an account. Only you can see these.</p>
      {data.map((t) => <ReviewRow key={t.id} ticket={t} accounts={accounts.data} onAssign={assign} onDismiss={dismiss} />)}
    </div>
  );
}
