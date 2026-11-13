import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccountTickets } from "../../hooks/useAccountTickets";
import { useAppError } from "../../context/AppErrorContext";
import { AccPillSelect } from "../shared/PillInputs";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import CommentTrigger from "../comments/CommentTrigger";
import CommentPreviewList from "../comments/CommentPreviewList";
import CommentComposer from "../comments/CommentComposer";
import { commentsApi } from "../../lib/api";
import { invalidateCommentSummary } from "../../lib/commentSummaryStore";
import { plainToHtml, sanitizeHtml, htmlToPreviewText } from "../../lib/noteHelpers";
import {
  TICKET_STATUSES, TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, TICKET_KIND_TITLE, TICKET_EMPTY_TEXT,
  formatTicketTime, looksLikeUrl,
} from "../../lib/tickets";
import type { Account, AccountTicket, TicketKind, TicketStatus } from "../../types";

const CARD_STYLE = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--border, rgba(0,0,0,0.08))",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
} as const;

const INPUT_CLS = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-400";

function errMsg(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return d || fallback;
}

function Stamp({ label, iso }: { label: string; iso: string }) {
  return (
    <span className="text-[11px] text-[var(--twilio-gray-60)]" title={iso}>
      {label} <time dateTime={iso}>{formatTicketTime(iso)}</time>
    </span>
  );
}

/** Call `onOutside` when the user presses the mouse anywhere outside `ref` while `active`. */
function useOutsideClick(ref: React.RefObject<HTMLElement | null>, active: boolean, onOutside: () => void) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb.current(); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [ref, active]);
}

/** A section title that opens and closes what is under it (Notes, Comments). */
function DisclosureTitle({ label, open, onToggle, hint }: { label: string; open: boolean; onToggle: () => void; hint?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="flex items-center gap-1.5 text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide hover:text-[var(--twilio-navy)]">
      <span aria-hidden className="text-[9px]">{open ? "▾" : "▸"}</span>
      {label}
      {hint && <span className="normal-case tracking-normal font-normal text-[11px] opacity-70">{hint}</span>}
    </button>
  );
}

export function TicketCard({ ticket, onPatch, onRemove, showAccount = false }: {
  ticket: AccountTicket;
  onPatch: (id: number, patch: Partial<AccountTicket>) => Promise<void>;
  onRemove: (t: AccountTicket) => void;
  /** Name the account (linked to its page). On for lists that span accounts, such as the profile. */
  showAccount?: boolean;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [notes, setNotes] = useState(ticket.notes);
  const [notesOpen, setNotesOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // The title wraps onto as many lines as it needs instead of scrolling sideways in a one-line box.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const saveNotes = () => { if (notes !== ticket.notes) void onPatch(ticket.id, { notes }).catch(() => {}); };
  // Clicking away closes the editor (saving anything typed) and leaves the note showing.
  useOutsideClick(notesRef, notesOpen, () => { saveNotes(); setNotesOpen(false); });
  useOutsideClick(commentsRef, commentsOpen, () => setCommentsOpen(false));
  const label = ticket.title || ticket.external_key || ticket.url || "Untitled";
  const created = ticket.source_created_at ?? ticket.created_at;
  const updated = ticket.source_updated_at ?? ticket.updated_at;

  return (
    <div className="rounded-lg px-4 py-3" style={CARD_STYLE} data-testid={`ticket-card-${ticket.id}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <textarea
          ref={titleRef}
          rows={1}
          aria-label="Ticket title"
          value={title}
          placeholder="Untitled"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onBlur={() => { if (title !== ticket.title) void onPatch(ticket.id, { title }).catch(() => setTitle(ticket.title)); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          className="flex-1 min-w-[160px] resize-none overflow-hidden bg-transparent text-sm font-semibold text-[var(--twilio-navy)] leading-snug border-b border-transparent hover:border-gray-200 focus:border-indigo-400 focus:outline-none"
        />
        {ticket.external_key && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-[var(--twilio-gray-60)]">{ticket.external_key}</span>
        )}
        <AccPillSelect<TicketStatus>
          value={ticket.status}
          options={TICKET_STATUSES}
          colorMap={TICKET_STATUS_COLOR}
          placeholder="Status"
          format={(v) => TICKET_STATUS_LABEL[v as TicketStatus] ?? v}
          onChange={(status) => { void onPatch(ticket.id, { status }).catch(() => {}); }}
        />
        <CommentTrigger resourceType="account_ticket" resourceId={ticket.id} resourceLabel={label} size="sm" />
        <button type="button" onClick={() => onRemove(ticket)} aria-label={`Delete ${label}`} title="Delete"
          className="text-xs text-[var(--twilio-gray-60)] hover:text-red-600">✕</button>
      </div>

      {showAccount && ticket.account && (
        <Link to={`/accounts/${ticket.account}`} className="inline-block text-[11px] font-semibold text-indigo-600 hover:underline mt-1" data-testid="ticket-account">
          {ticket.account_name || "Account"}
        </Link>
      )}

      {ticket.url && (
        <a href={ticket.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-indigo-600 hover:underline truncate mt-1">
          {ticket.url}
        </a>
      )}

      <div className="flex items-center gap-4 flex-wrap mt-2">
        <Stamp label="Created" iso={created} />
        <Stamp label="Updated" iso={updated} />
        {ticket.resolved_at && <Stamp label="Resolved" iso={ticket.resolved_at} />}
      </div>

      <div className="mt-3" ref={notesRef} data-testid="ticket-notes">
        <DisclosureTitle label="Notes" open={notesOpen} onToggle={() => { if (notesOpen) saveNotes(); setNotesOpen(!notesOpen); }}
          hint={!notesOpen && !htmlToPreviewText(notes) ? "Add a note" : undefined} />
        {notesOpen ? (
          <div className="mt-1">
            <RichTextMentionEditor
              value={notes}
              onChange={setNotes}
              placeholder="Add notes… (Enter to save, Shift+Enter for a new line)"
              minHeightClassName="min-h-[48px]"
              onSubmit={saveNotes}
            />
          </div>
        ) : htmlToPreviewText(notes) ? (
          <div className="rich-text mt-1 text-sm text-[var(--twilio-navy)]" data-testid="ticket-notes-text"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(notes)) }} />
        ) : null}
      </div>

      <div className="mt-3" ref={commentsRef} data-testid="ticket-comments">
        <DisclosureTitle label="Comments" open={commentsOpen} onToggle={() => setCommentsOpen(!commentsOpen)} hint={!commentsOpen ? "Add a comment" : undefined} />
        {commentsOpen && (
          <div className="mt-1">
            <CommentComposer
              autoFocus
              placeholder="Write a comment… (Enter to post, Shift+Enter for a new line)"
              onSubmit={async ({ content, references, mentions }) => {
                await commentsApi.create({
                  resource_type: "account_ticket", resource_id: ticket.id, resource_label: label,
                  content, parent: null, references, mentions,
                });
                invalidateCommentSummary("account_ticket", ticket.id);
              }}
            />
          </div>
        )}
        <div className="mt-1">
          <CommentPreviewList resourceType="account_ticket" resourceId={ticket.id} resourceLabel={label} />
        </div>
      </div>
    </div>
  );
}

export default function AccountTicketsSection({ account, kind }: { account: Account; kind: TicketKind }) {
  const { data, loading, error, createTicket, updateTicket, removeTicket } = useAccountTickets({ account: account.id, kind });
  const { reportError } = useAppError();
  const [link, setLink] = useState("");
  const [filter, setFilter] = useState<TicketStatus | "all">("all");
  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mUrl, setMUrl] = useState("");
  const [mStatus, setMStatus] = useState<TicketStatus>("open");
  const heading = TICKET_KIND_TITLE[kind];

  async function addFromLink(raw: string) {
    const url = raw.trim();
    if (!looksLikeUrl(url)) return;
    setLink("");
    try {
      await createTicket({ account: account.id, kind, url });
    } catch (e) {
      reportError(errMsg(e, "Could not add that link."));
    }
  }

  async function addManual() {
    if (!mTitle.trim() && !mUrl.trim()) return;
    try {
      await createTicket({ account: account.id, kind, title: mTitle.trim(), url: mUrl.trim(), status: mStatus });
      setMTitle(""); setMUrl(""); setMStatus("open"); setManualOpen(false);
    } catch (e) {
      reportError(errMsg(e, "Could not add the record."));
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

  const visible = filter === "all" ? data : data.filter((t) => t.status === filter);

  return (
    <div className="rounded-lg px-5 py-4" style={CARD_STYLE} data-testid={`tickets-${kind}`}>
      <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-3">{heading}</p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
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
        <button type="button" onClick={() => setManualOpen((v) => !v)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-[var(--twilio-navy)] hover:bg-gray-50">
          {manualOpen ? "Cancel" : "Add manually"}
        </button>
      </div>

      {manualOpen && (
        <div className="flex items-center gap-2 flex-wrap mb-3 p-3 rounded-lg bg-gray-50">
          <input aria-label="Title" value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="Title" className={`${INPUT_CLS} flex-1 min-w-[140px]`} />
          <input aria-label="URL" value={mUrl} onChange={(e) => setMUrl(e.target.value)} placeholder="https://…" className={`${INPUT_CLS} flex-1 min-w-[140px]`} />
          <select aria-label="Status" value={mStatus} onChange={(e) => setMStatus(e.target.value as TicketStatus)} className={INPUT_CLS}>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
          </select>
          <button type="button" onClick={() => void addManual()}
            className="rounded-lg bg-[var(--twilio-navy)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Add</button>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mb-3" role="group" aria-label="Filter by status">
        {(["all", ...TICKET_STATUSES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
            className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${filter === s ? "bg-[var(--twilio-navy)] text-white" : "bg-gray-100 text-[var(--twilio-gray-60)] hover:bg-gray-200"}`}>
            {s === "all" ? "All" : TICKET_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {loading && data.length === 0 && <p className="text-xs text-[var(--twilio-gray-60)]">Loading…</p>}
      {error && <p className="text-xs text-red-600">Could not load {heading}.</p>}
      {!loading && !error && data.length === 0 && (
        <p className="text-sm text-[var(--twilio-gray-60)] italic">{TICKET_EMPTY_TEXT[kind]}</p>
      )}
      {data.length > 0 && visible.length === 0 && (
        <p className="text-sm text-[var(--twilio-gray-60)] italic">No records with that status.</p>
      )}

      <div className="space-y-2">
        {visible.map((t) => <TicketCard key={t.id} ticket={t} onPatch={patch} onRemove={remove} />)}
      </div>
    </div>
  );
}
