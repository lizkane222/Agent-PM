import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAccountTickets } from "../../hooks/useAccountTickets";
import { useAppError } from "../../context/AppErrorContext";
import { TicketCard } from "../account/AccountTicketsSection";
import { ReviewRow } from "./TicketsToReview";
import {
  TICKET_STATUSES, TICKET_STATUS_LABEL, TICKET_KIND_TITLE, TICKET_EMPTY_TEXT, looksLikeUrl,
} from "../../lib/tickets";
import type { Account, AccountTicket, TicketKind, TicketStatus } from "../../types";

/** Fired when a record is filed, moved to another kind or dismissed, so the sibling sections refresh. */
export const TICKETS_CHANGED_EVENT = "accountTicketsChanged";
const announce = () => window.dispatchEvent(new Event(TICKETS_CHANGED_EVENT));

const INPUT_CLS = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-400";
const CARD_STYLE = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--border, rgba(0,0,0,0.08))",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
} as const;

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

/**
 * One of the three record lists (JIRAs, Zendesk, Product Gaps) across every account the user is on -
 * the same cards, status filter and paste-a-link box as an account's page, plus the account each
 * record belongs to.
 *
 * A record found in the user's email that could not be matched to an account (`needs_review`) is
 * pinned to the front of its kind's list, marked as waiting for an account, with controls to file it.
 */
export default function ProfileTicketsSection({ kind, accounts }: { kind: TicketKind; accounts: Account[] }) {
  const { data, loading, error, refetch, createTicket, updateTicket, removeTicket } = useAccountTickets({ kind });
  const review = useAccountTickets({ review: "needs_review" });
  const { reportError } = useAppError();
  const { hash } = useLocation();
  const [filter, setFilter] = useState<TicketStatus | "all">("all");
  const [link, setLink] = useState("");
  const [accountId, setAccountId] = useState("");
  const heading = TICKET_KIND_TITLE[kind];

  const refetchReview = review.refetch;
  useEffect(() => {
    const on = () => { refetch(); refetchReview(); };
    window.addEventListener(TICKETS_CHANGED_EVENT, on);
    return () => window.removeEventListener(TICKETS_CHANGED_EVENT, on);
  }, [refetch, refetchReview]);

  // Pinned first, and only this kind's.
  const pinned = review.data.filter((t) => t.kind === kind);
  const visible = filter === "all" ? data : data.filter((t) => t.status === filter);

  // The "needs review" notification links here (/profile#ticket-review): bring the first pinned card into view.
  useEffect(() => {
    if (pinned.length === 0 || hash !== "#ticket-review") return;
    const id = requestAnimationFrame(() => document.querySelector("[data-ticket-pinned]")?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(id);
  }, [pinned.length, hash]);

  async function addFromLink(raw: string) {
    const url = raw.trim();
    if (!looksLikeUrl(url)) return;
    if (!accountId) { reportError("Choose an account for this record first."); return; }
    setLink("");
    try {
      await createTicket({ account: Number(accountId), kind, url });
    } catch (e) {
      reportError(errMsg(e, "Could not add that link."));
    }
  }

  async function patch(id: number, p: Partial<AccountTicket>) {
    try {
      await updateTicket(id, p);
    } catch (e) {
      reportError(errMsg(e, "Could not save the change."));
      throw e;
    }
  }

  function remove(t: AccountTicket) {
    if (!window.confirm(`Delete "${t.title || t.external_key || t.url || "this record"}"?`)) return;
    void removeTicket(t.id).catch((e) => reportError(errMsg(e, "Could not delete the record.")));
  }

  async function assign(t: AccountTicket, account: number, newKind: TicketKind) {
    try {
      await review.assignTicket(t.id, { account, kind: newKind });
      // The record now belongs to an account (and maybe another kind): refresh this list too.
      refetch();
      announce();
    } catch (e) {
      reportError(errMsg(e, "Could not add the record to that account."));
    }
  }

  function dismiss(t: AccountTicket) {
    if (!window.confirm(`Dismiss "${t.title || t.external_key || "this record"}"?`)) return;
    void review.removeTicket(t.id).then(announce).catch((e) => reportError(errMsg(e, "Could not dismiss the record.")));
  }

  return (
    <div className="rounded-lg px-5 py-4" style={CARD_STYLE} data-testid={`profile-tickets-${kind}`}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select aria-label={`Account for a new ${heading} record`} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={INPUT_CLS}>
          <option value="">Choose account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.company_name}</option>)}
        </select>
        <input
          aria-label={`Paste a link for ${heading}`}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (looksLikeUrl(text)) { e.preventDefault(); void addFromLink(text); }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addFromLink(link); } }}
          placeholder="Paste a link and press Enter…"
          className={`${INPUT_CLS} flex-1 min-w-[200px]`}
        />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-3" role="group" aria-label="Filter by status">
        {(["all", ...TICKET_STATUSES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
            className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${filter === s ? "bg-[var(--twilio-navy)] text-white" : "bg-gray-100 text-[var(--twilio-gray-60)] hover:bg-gray-200"}`}>
            {s === "all" ? "All" : TICKET_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Pinned: found in email, no account yet. Always first, whatever the status filter. */}
      {pinned.map((t) => (
        <ReviewRow key={`review-${t.id}`} ticket={t} accounts={accounts} pinned onAssign={assign} onDismiss={dismiss} />
      ))}

      {loading && data.length === 0 && <p className="text-xs text-[var(--twilio-gray-60)]">Loading…</p>}
      {error && <p className="text-xs text-red-600">Could not load {heading}.</p>}
      {!loading && !error && data.length === 0 && pinned.length === 0 && (
        <p className="text-sm text-[var(--twilio-gray-60)] italic">{TICKET_EMPTY_TEXT[kind]}</p>
      )}
      {data.length > 0 && visible.length === 0 && (
        <p className="text-sm text-[var(--twilio-gray-60)] italic">No records with that status.</p>
      )}

      <div className="space-y-2">
        {visible.map((t) => <TicketCard key={t.id} ticket={t} onPatch={patch} onRemove={remove} showAccount />)}
      </div>
    </div>
  );
}
