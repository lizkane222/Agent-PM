import React, { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useStatusLabels } from "../../hooks/useStatusLabels";
import { useColumnSort } from "../../hooks/useStatusArrivalOrder";
import ColumnSortButton from "../account/ColumnSortButton";
import { createPortal } from "react-dom";
import type {
  Account,
  AccountTeamMember,
  AirtableAccount,
  AirtableActionItem,
  AirtableMeeting,
  CalendarEvent,
  CommentReference,
  EventMatchResult,
  MeetingNote,
  Reminder,
  SalesforceProject,
  AccountProject,
  TeamMember,
} from "../../types";
import { accountsApi, airtableApi, integrationsApi, schedulerApi, teamApi } from "../../lib/api";
import { getAccessToken } from "../../lib/auth";
import { useCurrentUser } from "../../context/CurrentUserContext";
import InlineCommentThread from "../comments/InlineCommentThread";
import KanbanCard from "./KanbanCard";
import { ActionItemModal } from "../account/ActionItemModal";
import LogTimeModal from "./LogTimeModal";
import ActivityLogSection from "../ActivityLogSection";
import { convertEventToActionItem, restoreConversion } from "../../hooks/useConvert";
import { logActionItemUpdate } from "../../lib/actionItemLog";
import { addLog } from "../../lib/appLog";
import RichTextMentionEditor, { type RichTextMentionEditorHandle } from "../shared/RichTextMentionEditor";
import { sanitizeHtml, plainToHtml, htmlToPreviewText, renderMeetingNoteText } from "../../lib/noteHelpers";
import { MeetingSummarySourceToggle, preferredMeetingSource } from "../account/MeetingSummarySourceToggle";
import type { MeetingNotesSource } from "../../lib/api";
import { toLocalDatetimeValue } from "../../lib/datetimeLocal";
import { localDateKey } from "../../lib/timelineDay";

interface Props {
  event: CalendarEvent;
  attended?: boolean;
  onToggleAttendance?: () => void;
  reloadTrigger?: number;
}

const KANBAN_COLUMNS: AirtableActionItem["status"][] = [
  "Open",
  "In Progress",
  "Done",
  "Blocked",
  "Backlogged",
];

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─────────────────────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-3">
      {children}
    </h3>
  );
}

function CategorizationPrompt({
  accounts,
  onSelect,
}: {
  accounts: AirtableAccount[];
  onSelect: (accountId: number | null, categorization: string) => void;
}) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <p className="text-sm font-medium text-amber-800 mb-3">
        We couldn't automatically match this meeting to an account. How should we categorize it?
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => onSelect(null, "Internal Meeting")}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-[var(--twilio-gray-80)] hover:bg-gray-100"
        >
          Internal Meeting
        </button>
        <button
          onClick={() => onSelect(null, "Admin")}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-[var(--twilio-gray-80)] hover:bg-gray-100"
        >
          Admin
        </button>
      </div>
      {accounts.length > 0 && (
        <>
          <p className="text-sm text-[var(--twilio-navy)] mb-2">Or link to an account:</p>
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id, "")}
                className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
              >
                {a.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CALENDAR_DRAG_KEY = "calendarDragActionItemId";

// ── Event Reminders Section ───────────────────────────────────────────────────

function EventRemindersSection({
  event,
  eventReminders,
  setEventReminders,
  actionItems,
}: {
  event: CalendarEvent;
  eventReminders: Reminder[];
  setEventReminders: React.Dispatch<React.SetStateAction<Reminder[]>>;
  actionItems: AirtableActionItem[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [remTitle, setRemTitle] = useState("");
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  const hasAny = eventReminders.length > 0 || actionItems.some((i) => i.reminder_id);

  async function handleCreate() {
    if (!remDate) return;
    setSaving(true);
    try {
      const due = new Date(`${remDate}T${remTime}:00`);
      const { data } = await schedulerApi.createReminder({
        title: remTitle.trim() || event.title,
        resource_type: "calendar_event",
        resource_id: event.id,
        resource_label: event.title,
        due_at: due.toISOString(),
      } as Parameters<typeof schedulerApi.createReminder>[0]);
      setEventReminders((prev) => [...prev, data]);
      setRemTitle(""); setRemDate(""); setRemTime("09:00"); setShowForm(false);
    } catch { /* keep form open */ }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--twilio-gray-60)]">Reminders</h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
            <path d="M8 3v10M3 8h10"/>
          </svg>
          Set reminder
        </button>
      </div>

      {showForm && (
        <div className="mb-3 bg-white border border-indigo-100 rounded-xl p-3 space-y-2">
          <input
            value={remTitle}
            onChange={(e) => setRemTitle(e.target.value)}
            placeholder={`Reminder: ${event.title}`}
            className="w-full text-xs rounded border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 mb-0.5">Date</p>
              <input
                type="date"
                value={remDate}
                onChange={(e) => setRemDate(e.target.value)}
                className="w-full text-xs rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300 [color-scheme:light]"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 mb-0.5">Time</p>
              <input
                type="time"
                value={remTime}
                onChange={(e) => setRemTime(e.target.value)}
                className="w-full text-xs rounded border border-gray-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">Cancel</button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!remDate || saving}
              className="text-xs px-3 py-1 rounded bg-indigo-600 text-white font-semibold disabled:opacity-40 hover:bg-indigo-700 transition-colors"
            >{saving ? "Saving…" : "Set Reminder"}</button>
          </div>
        </div>
      )}

      {hasAny && (
        <div className="flex flex-wrap gap-2">
          {eventReminders.map((r) => (
            <div key={r.id} className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill={r.status === "pending" ? "#f59e0b" : "#9ca3af"} stroke={r.status === "pending" ? "#f59e0b" : "#9ca3af"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span className="text-[var(--twilio-navy)]">{r.title}</span>
              <span className="text-[11px] text-[var(--twilio-gray-60)]">
                {new Date(r.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {r.status !== "pending" && <span className="ml-1 capitalize">· {r.status}</span>}
              </span>
            </div>
          ))}
          {actionItems.filter((i) => i.reminder_id).map((i) => (
            <div key={`ai-${i.airtable_id}`} className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill={i.reminder_status === "pending" ? "#f59e0b" : "#9ca3af"} stroke={i.reminder_status === "pending" ? "#f59e0b" : "#9ca3af"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span className="text-[11px] text-[var(--twilio-gray-60)] italic">Action item:</span>
              <span className="text-[var(--twilio-navy)]">{i.task}</span>
              {i.reminder_due_at && (
                <span className="text-[11px] text-[var(--twilio-gray-60)]">
                  {new Date(i.reminder_due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {i.reminder_status && i.reminder_status !== "pending" && <span className="ml-1 capitalize">· {i.reminder_status}</span>}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!hasAny && !showForm && (
        <p className="text-xs text-gray-400 italic">No reminders set.</p>
      )}
    </div>
  );
}

export default function MeetingDetail({ event, attended = true, onToggleAttendance, reloadTrigger }: Props) {
  const { label: statusLabel } = useStatusLabels();
  const { sortDirection, toggleSort, applySort } = useColumnSort();
  const [result, setResult] = useState<EventMatchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [actionItemDropOver, setActionItemDropOver] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<AirtableActionItem["status"] | null>(null);
  // A kanban card from the Action Items section is in the air. It can be dropped on the
  // Meeting Notes (links it to this meeting) or on the calendar grid, so both glow.
  const [cardDragging, setCardDragging] = useState(false);
  const [notesDropOver, setNotesDropOver] = useState(false);
  const [linkNote, setLinkNote] = useState<{ text: string; ok: boolean } | null>(null);
  // The meeting row created for a calendar-only event the first time something is linked to it.
  const [ensuredMeetingPk, setEnsuredMeetingPk] = useState<number | null>(null);
  const [acctProjects, setAcctProjects] = useState<AccountProject[]>([]);
  const [logTimeProject, setLogTimeProject] = useState<SalesforceProject | null>(null);
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [eventReminders, setEventReminders] = useState<Reminder[]>([]);
  const [showMeetingDetails, setShowMeetingDetails] = useState(false);
  const [showSfProjects, setShowSfProjects] = useState(false);
  const [editingItem, setEditingItem] = useState<AirtableActionItem | null>(null);
  const [convertingEvent, setConvertingEvent] = useState(false);
  const [accountTeamMembers, setAccountTeamMembers] = useState<AccountTeamMember[]>([]);
  // Work-tracking sessions for this event (populated when calendar_id === "work_tracking")
  const [workSessions, setWorkSessions] = useState<CalendarEvent[]>([]);
  // Track note IDs we just created locally so the WS echo doesn't duplicate them
  const locallyCreatedNoteIds = useRef<Set<number>>(new Set());

  async function handleConvertEventToActionItem() {
    if (convertingEvent) return;
    setConvertingEvent(true);
    try {
      await convertEventToActionItem(event);
      // The event has been converted — navigate away or let parent handle
      window.history.back();
    } catch { /* best effort */ } finally {
      setConvertingEvent(false);
    }
  }

  // Load meeting notes
  useEffect(() => {
    schedulerApi.listMeetingNotes(event.id).then(({ data }) => {
      setNotes(data.results ?? []);
    }).catch(() => {});
  }, [event.id]);

  // Load reminders attached to this calendar event
  useEffect(() => {
    schedulerApi.listReminders({ resource_type: "calendar_event", resource_id: String(event.id) })
      .then(({ data }) => setEventReminders(data.results ?? []))
      .catch(() => {});
  }, [event.id]);

  // Load all work-tracking sessions for this action item (when this IS a work-tracking event)
  useEffect(() => {
    if (event.calendar_id !== "work_tracking" || !event.agentpm_airtable_id) return;
    schedulerApi.listEvents({ calendar_id: "work_tracking", agentpm_airtable_id: event.agentpm_airtable_id })
      .then(({ data }) => {
        const sessions = (Array.isArray(data) ? data : (data as { results?: CalendarEvent[] }).results ?? []) as CalendarEvent[];
        setWorkSessions(sessions.sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()));
      })
      .catch(() => {});
  }, [event.id, event.calendar_id, event.agentpm_airtable_id]);

  // WebSocket — receive real-time note updates from other editors.
  // Synthetic overlay events (Airtable meetings, scheduled action items, reminders
  // rendered on the calendar with no backing CalendarEvent row — see CalendarPage.tsx's
  // synthesis effects) get a non-positive `id`, the same convention `ev.id > 0` already
  // uses for comment resource_id. There is no real row for the consumer to attach to,
  // and the backend route only matches a positive integer, so the connection would just
  // fail loudly in the console.
  useEffect(() => {
    if (event.id <= 0) return;
    const token = getAccessToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const wsBase = window.location.origin.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsBase}/ws/meeting-notes/${event.id}/${qs}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type !== "note.update") return;
        const { action: act, note } = msg as { action: string; note: MeetingNote & { id: number } };
        if (act === "created") {
          // Skip if we created this note locally (REST response already added it)
          if (locallyCreatedNoteIds.current.has(note.id)) {
            locallyCreatedNoteIds.current.delete(note.id);
            return;
          }
          setNotes((prev) => prev.some((n) => n.id === note.id) ? prev : [...prev, note].sort((a, b) => a.position - b.position || a.id - b.id));
        } else if (act === "updated") {
          setNotes((prev) => prev.map((n) => n.id === note.id ? note : n));
        } else if (act === "deleted") {
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
        }
      } catch { /* ignore malformed messages */ }
    };
    return () => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [event.id]);

  const eventUid = String(event.google_event_id || event.id);

  // Every piece of state below is scoped to one event, and `loadMatch` is async — so
  // without this the previous meeting's account, action items and summary stay on screen
  // until the new match lands. Worse than a stale render: `result.this_meeting.id` is
  // what MeetingSummarySection saves through, so a paste in that window is written to
  // the *previous* meeting's Airtable row. Cleared on an identity change only, so the
  // `reloadTrigger` refetch (after an account link) still refreshes in place.
  const prevUidRef = useRef(eventUid);
  useEffect(() => {
    if (prevUidRef.current === eventUid) return;
    prevUidRef.current = eventUid;
    setResult(null);
    setActionItems([]);
    setAcctProjects([]);
    setAccountTeamMembers([]);
    setWorkSessions([]);
  }, [eventUid]);

  const loadMatch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await airtableApi.matchEvent({
        event_uid: eventUid,
        title: event.title,
        description: event.description || "",
        attendee_emails: event.attendees.map((a) => a.email),
      });
      console.log("[MeetingDetail] matchEvent response:", { needs_categorization: data.needs_categorization, account: data.account?.name, action_items_count: (data.action_items ?? []).length });
      setResult(data);
      setActionItems(data.action_items ?? []);

      if (!data.needs_categorization && data.account) {
        // Fetch Django account team members for smart mention tagging
        try {
          const { data: acctData } = await accountsApi.listAccounts({ search: data.account.name, page_size: "5" });
          const results = acctData.results ?? [];
          // Find exact company_name match (search is partial, so filter)
          const searchName = data.account.name.toLowerCase();
          const acct = (results as Account[]).find(
            (r) => r.company_name.toLowerCase() === searchName
          ) ?? (results as Account[])[0];
          console.log("[MeetingDetail] account team lookup:", {
            airtableName: data.account.name,
            candidates: results.map((r: Account) => r.company_name),
            matched: acct?.company_name,
            teamMembers: acct?.team_members?.map((m) => m.full_name),
          });
          if (acct?.team_members) setAccountTeamMembers(acct.team_members);
          // Projects/goals come from the account page's own records (AccountProject, keyed by
          // Django Account.id) — never from the Salesforce mirror or any fixed list.
          if (acct) {
            try {
              const { data: pj } = await accountsApi.listAllProjects();
              setAcctProjects((pj.results ?? []).filter((p) => p.account === acct.id));
            } catch (pErr) {
              console.warn("[MeetingDetail] account projects fetch failed:", pErr);
            }
          }
        } catch (e) {
          console.warn("[MeetingDetail] account team lookup failed:", e);
        }
      }
    } catch (err) {
      console.error("[MeetingDetail] matchEvent failed:", err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventUid, event.title, event.description, event.attendees, reloadTrigger]);

  useEffect(() => {
    console.log("[MeetingDetail] loadMatch effect fired, eventUid:", eventUid);
    void loadMatch();
  }, [loadMatch]);

  async function handleCategorize(accountId: number | null, categorization: string) {
    try {
      const { data } = await airtableApi.categorizeEvent({
        event_uid: eventUid,
        account_id: accountId,
        categorization,
      });
      setResult(data);
      setActionItems(data.action_items ?? []);
    } catch {}
  }

  function handleStatusChange(airtableId: string, newStatus: AirtableActionItem["status"]) {
    setActionItems((prev) =>
      prev.map((item) =>
        item.airtable_id === airtableId ? { ...item, status: newStatus } : item
      )
    );
  }

  async function handleDropActionItem(e: React.DragEvent) {
    e.preventDefault();
    setActionItemDropOver(false);
    const w = window as unknown as Record<string, string>;
    const airtableId = (e.dataTransfer.getData("text/plain") || w[CALENDAR_DRAG_KEY]).trim();
    if (!airtableId) return;
    // Already in list?
    if (actionItems.some((i) => i.airtable_id === airtableId)) return;
    // Fetch the item so we can show it immediately, then patch the account
    const accountName = result?.account?.name ?? null;
    const accountId = result?.account ? (result.account as AirtableAccount & { id: number }).id : null;
    try {
      // Optimistic: fetch item details
      const { data: allItems } = await airtableApi.listActionItems({ status: "Open,In Progress,Blocked,Backlogged,Complete" });
      const dropped = (allItems as AirtableActionItem[]).find((i) => i.airtable_id === airtableId);
      if (dropped) {
        setActionItems((prev) => [...prev, dropped]);
        // Associate the action item with this meeting's account if we have one
        if (accountId && accountName) {
          await airtableApi.updateActionItemFields(airtableId, { account: accountId, account_name: accountName }).catch(() => {});
          window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: "1" }));
        }
      }
    } catch { /* best effort */ }
  }

  // Window-level so a cancelled drag (Esc, dropped outside) always clears the glow: the
  // source card's own dragend can't be relied on once the list re-renders mid-drag.
  useEffect(() => {
    const onStart = (e: DragEvent) => { if (e.dataTransfer?.types.includes("kanbancardid")) setCardDragging(true); };
    const onEnd = () => { setCardDragging(false); setNotesDropOver(false); };
    window.addEventListener("dragstart", onStart);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragstart", onStart);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);

  useEffect(() => {
    if (!linkNote) return;
    const t = setTimeout(() => setLinkNote(null), 4000);
    return () => clearTimeout(t);
  }, [linkNote]);

  const thisMeetingPk = result?.this_meeting?.id ?? ensuredMeetingPk;
  const linkedHere = thisMeetingPk == null ? [] : actionItems.filter((i) => i.linked_meeting === thisMeetingPk);

  /** Drop on the Meeting Notes: link the action item to this meeting. */
  async function linkActionItemToMeeting(airtableId: string) {
    const item = actionItems.find((i) => i.airtable_id === airtableId);
    if (!item || airtableId.startsWith("local-")) return;
    try {
      // A calendar-only event has no meeting row yet; make the same local stub the notes use.
      let meetingPk = result?.this_meeting?.id ?? ensuredMeetingPk;
      if (meetingPk == null) {
        const { data } = await airtableApi.ensureMeetingForEvent(event.id);
        meetingPk = data.id;
        setEnsuredMeetingPk(meetingPk);
      }
      if (item.linked_meeting === meetingPk) {
        setLinkNote({ text: `"${item.task}" is already linked to this meeting.`, ok: true });
        return;
      }
      await airtableApi.updateActionItemFields(airtableId, { linked_meeting: meetingPk });
      setActionItems((prev) => prev.map((i) =>
        i.airtable_id === airtableId ? { ...i, linked_meeting: meetingPk, linked_meeting_name: event.title } : i));
      addLog({
        category: "action_item",
        message: `"${item.task}" linked to meeting "${event.title}"`,
        resource: { type: "action_item", id: airtableId },
      });
      setLinkNote({ text: `Linked "${item.task}" to this meeting. It now shows under the meeting on the account's timeline.`, ok: true });
    } catch {
      setLinkNote({ text: `Could not link "${item.task}" to this meeting. Please try again.`, ok: false });
    }
  }

  const durationSecs =
    (new Date(event.end_datetime).getTime() - new Date(event.start_datetime).getTime()) / 1000;

  return (
    <>
    <div className="mt-6 border-t border-gray-200 pt-6">
      <div className="flex flex-col gap-5">

        {/* ── Row 1: Account+Details | Meeting Notes | Meeting Summary ─────── */}
        <div className="grid grid-cols-3 gap-5">

        {/* ── Col 1: Account + SF Projects + Meeting Details ──────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-5">

          {/* Account match */}
          <section>
            <SectionHeading>Account</SectionHeading>
            {loading ? (
              <p className="text-sm text-[var(--twilio-gray-60)]">Matching account…</p>
            ) : result?.needs_categorization ? (
              <CategorizationPrompt accounts={result.accounts ?? []} onSelect={handleCategorize} />
            ) : result?.account ? (
              <AccountCard account={result.account} matchMethod={result.match_method} />
            ) : result?.categorization ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-[var(--twilio-navy)]">
                  {result.categorization}
                </span>
                <button onClick={() => setResult({ ...result, needs_categorization: true })} className="text-sm text-indigo-500 hover:underline">
                  Change
                </button>
              </div>
            ) : null}
          </section>

          {/* Salesforce Projects — collapsible */}
          {result?.account && (
            <section>
              <button
                onClick={() => setShowSfProjects((v) => !v)}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-[var(--twilio-gray-60)]">
                    <path d="M2 4h12M2 8h8M2 12h5"/>
                  </svg>
                  Salesforce Projects
                  <span className="text-[11px] font-normal text-[var(--twilio-gray-60)]">({acctProjects.length})</span>
                </span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`w-3.5 h-3.5 text-[var(--twilio-gray-60)] transition-transform ${showSfProjects ? "rotate-180" : ""}`}>
                  <path d="M4 6l4 4 4-4"/>
                </svg>
              </button>
              {showSfProjects && (
                acctProjects.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--twilio-gray-60)]">No projects or goals on this account yet.</p>
                ) : (
                  <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                    {topLevelProjects(acctProjects).map(({ project, goals }) => (
                      <div key={project.id} className="bg-white rounded-xl border border-gray-200 px-3 py-2 flex flex-col gap-1.5" data-testid="account-project">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[var(--twilio-navy)] leading-snug line-clamp-2">{project.name}</p>
                          {(project.sf_data?.projectStatus) && (
                            <span className="text-[10px] font-medium text-indigo-600">{project.sf_data.projectStatus}</span>
                          )}
                          {project.sf_project_id && (
                            <span className="block text-[10px] text-[var(--twilio-gray-60)]">{project.sf_project_id}</span>
                          )}
                        </div>
                        {goals.length > 0 && (
                          <ul className="text-[11px] text-[var(--twilio-navy)] list-disc pl-4 space-y-0.5">
                            {goals.map((g) => <li key={g.id}>{g.name}</li>)}
                          </ul>
                        )}
                        {project.sf_project_id && project.kind === "project" && (
                          <button onClick={() => setLogTimeProject({ id: project.id, sf_id: project.sf_project_id, account: null, account_name: result?.account?.name ?? "", name: project.name, status: "", description: "", start_date: null, end_date: null, owner_name: "", members: [], tasks: [] })} className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-white mt-auto" style={{ background: "#0263E0" }}>
                            + Log Time
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>
          )}

          {/* Meeting Details — collapsible */}
          <section>
            <button
              onClick={() => setShowMeetingDetails((v) => !v)}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-[var(--twilio-gray-60)]">
                  <rect x="1" y="1" width="14" height="14" rx="2"/>
                  <path d="M5 5h6M5 8h4M5 11h3"/>
                </svg>
                Meeting Details
              </span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className={`w-3.5 h-3.5 text-[var(--twilio-gray-60)] transition-transform ${showMeetingDetails ? "rotate-180" : ""}`}>
                <path d="M4 6l4 4 4-4"/>
              </svg>
            </button>

            {showMeetingDetails && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Date</p>
                    <p className="text-[var(--twilio-navy)]">
                      {new Date(event.start_datetime).toLocaleDateString(undefined, {
                        weekday: "short", month: "short", day: "numeric",
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Time</p>
                    <p className="text-[var(--twilio-navy)]">
                      {new Date(event.start_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      {" – "}
                      {new Date(event.end_datetime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Duration</p>
                    <p className="text-[var(--twilio-navy)]">{formatDuration(durationSecs)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Attendees</p>
                    <p className="text-[var(--twilio-navy)]">{event.attendees.length}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1">Attendance</p>
                    <button
                      onClick={onToggleAttendance}
                      className={[
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border transition-colors",
                        attended
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                          : "bg-gray-100 text-[var(--twilio-gray-60)] border-gray-200 hover:bg-gray-200 line-through",
                      ].join(" ")}
                    >
                      <span className={["h-2 w-2 rounded-full shrink-0", attended ? "bg-emerald-500" : "bg-gray-400"].join(" ")} />
                      {attended ? "Attended" : "Did not attend"}
                    </button>
                    {!attended && (
                      <p className="text-[11px] text-[var(--twilio-gray-60)] mt-1">Time excluded from daily totals</p>
                    )}
                  </div>
                </div>
                {event.attendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {event.attendees.map((a) => (
                      <span key={a.email} className="text-[11px] bg-gray-100 text-[var(--twilio-navy)] px-2 py-0.5 rounded-full" title={a.email}>
                        {a.displayName ?? a.email}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

        </div>{/* end col 1 */}

        {/* ── Col 2: Meeting Notes ─────────────────────────────────────────── */}
        <div
          data-testid="meeting-notes-column"
          data-drag-glow={cardDragging ? (notesDropOver ? "over" : "ready") : undefined}
          className={[
            "rounded-2xl border p-5 transition-all",
            notesDropOver ? "border-indigo-400 bg-indigo-50 shadow-[0_0_22px_rgba(99,102,241,0.6)]"
              : cardDragging ? "border-indigo-300 bg-indigo-50/60 shadow-[0_0_16px_rgba(99,102,241,0.35)]"
              : "border-gray-200 bg-gray-50",
          ].join(" ")}
          // Capture phase on purpose: the note editor inside this column is a contenteditable,
          // and ProseMirror would otherwise insert the dragged text/plain (the record id) as text.
          onDragOverCapture={(e) => {
            if (!e.dataTransfer.types.includes("kanbancardid")) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            setNotesDropOver(true);
          }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setNotesDropOver(false); }}
          onDropCapture={(e) => {
            const id = e.dataTransfer.getData("kanbanCardId");
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            setNotesDropOver(false);
            setCardDragging(false);
            void linkActionItemToMeeting(id);
          }}
        >
          <SectionHeading>Meeting Notes</SectionHeading>
          {notesDropOver && <p className="text-[11px] text-indigo-600 font-medium mb-2">Drop to link this action item to the meeting</p>}
          <MeetingNotesSection
            eventId={event.id}
            eventTitle={event.title}
            accountName={result?.account?.name ?? null}
            notes={notes}
            setNotes={setNotes}
            locallyCreatedNoteIds={locallyCreatedNoteIds}
            onActionItemCreated={(item) => setActionItems((prev) => [...prev, item])}
          />
          {linkNote && (
            <p role="status" className={["mt-3 text-xs", linkNote.ok ? "text-emerald-700" : "text-red-600"].join(" ")}>{linkNote.text}</p>
          )}
          {linkedHere.length > 0 && (
            <div data-testid="linked-action-items" className="mt-4">
              <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)] mb-1">Action items from this meeting</p>
              <ul className="space-y-1">
                {linkedHere.map((i) => (
                  <li key={i.airtable_id} className="text-xs rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-violet-900">{i.task}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Col 3: Meeting Summary ───────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <SectionHeading>Meeting Summary</SectionHeading>
          <MeetingSummarySection
            eventId={event.id}
            meetingId={result?.this_meeting?.id}
            existingNotes={result?.this_meeting?.gong_notes ?? undefined}
            existingZoomNotes={result?.this_meeting?.zoom_notes ?? undefined}
            accountName={result?.account?.name ?? null}
            airtableAccountId={result?.account ? (result.account as { id?: number }).id ?? null : null}
            accountTeamMembers={accountTeamMembers}
            onCreatedActionItem={(item) => setActionItems((prev) => [...prev, item])}
          />
        </div>

        </div>{/* end grid row 1 */}

        {/* ── Row 2: Action Items kanban + Reminders ───────────────────────── */}
        <div
          className={[
            "rounded-2xl border p-5 transition-colors",
            actionItemDropOver ? "border-indigo-300 bg-indigo-50"
              : cardDragging ? "border-indigo-300 bg-indigo-50/60 shadow-[0_0_18px_rgba(99,102,241,0.45)]"
              : "border-gray-200 bg-gray-50",
          ].join(" ")}
          data-testid="meeting-action-items-section"
          data-drag-glow={cardDragging ? "ready" : undefined}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("kanbancardid")) return; // handled by columns
            e.preventDefault();
            setActionItemDropOver(true);
          }}
          onDragLeave={() => setActionItemDropOver(false)}
          onDrop={(e) => void handleDropActionItem(e)}
        >
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-4 flex items-center gap-2">
            Action Items
            <span className="text-[11px] text-[var(--twilio-gray-60)] font-normal normal-case tracking-normal">Drag Action Item to Meeting Notes or Calendar</span>
            {actionItemDropOver && <span className="text-[11px] text-indigo-500 font-medium normal-case tracking-normal">Drop to associate</span>}
          </h2>

          {/* 4-column kanban */}
          <div className="grid grid-cols-4 gap-4">
            {KANBAN_COLUMNS.map((col) => {
              const colItems = applySort(actionItems.filter((i) => i.status === col), col);
              const isOver = dragOverCol === col;
              return (
                <div
                  key={col}
                  className={["rounded-xl border p-3 transition-colors", isOver ? "border-indigo-400 bg-indigo-50" : "bg-white border-gray-200"].join(" ")}
                  onDragOver={(e) => {
                    // Only accept kanban card drags, not account/sidebar drags
                    if (e.dataTransfer.types.includes("kanbancardid")) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverCol(col);
                    }
                  }}
                  onDragLeave={(e) => {
                    // Only clear if leaving the column entirely (not entering a child)
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverCol(null);
                    const airtableId = e.dataTransfer.getData("kanbanCardId");
                    if (!airtableId) return;
                    const item = actionItems.find((i) => i.airtable_id === airtableId);
                    if (!item || item.status === col) return;
                    // Optimistic update — KanbanCard's own handler does the API call
                    handleStatusChange(airtableId, col);
                    airtableApi.updateActionItemStatus(airtableId, col).then(() => {
                      logActionItemUpdate(item, { status: col });
                    }).catch(() => {
                      // Revert on failure
                      handleStatusChange(airtableId, item.status);
                    });
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-3">
                    <p className="text-sm font-semibold text-[var(--twilio-navy)]">{statusLabel(col)}</p>
                    <span className="text-xs bg-gray-100 text-[var(--twilio-navy)] rounded-full px-1.5 py-0.5">{colItems.length}</span>
                    <ColumnSortButton status={col} direction={sortDirection(col)} onToggle={toggleSort} className="ml-auto" />
                  </div>
                  <div className="space-y-2">
                    {colItems.map((item) => (
                      <KanbanCard key={item.airtable_id} item={item} onStatusChange={handleStatusChange} onDoubleClick={setEditingItem} />
                    ))}
                    {colItems.length === 0 && (
                      <div className={["border-2 border-dashed rounded-lg h-14 flex items-center justify-center", isOver ? "border-indigo-300" : "border-gray-100"].join(" ")}>
                        <span className="text-xs text-[var(--twilio-gray-40)]">{isOver ? "Drop here" : "—"}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reminders — always shown; includes a Set Reminder form for the event itself */}
          <EventRemindersSection
            event={event}
            eventReminders={eventReminders}
            setEventReminders={setEventReminders}
            actionItems={actionItems}
          />

          {/* Airtable meeting record */}
          {result?.meetings && result.meetings.length > 0 && (
            <div className="mt-5">
              <AirtableMeetingSection meetings={result.meetings} eventTitle={event.title} />
            </div>
          )}

          {/* Work-tracking session timeline */}
          {event.calendar_id === "work_tracking" && workSessions.length > 0 && (
            <div className="mt-5">
              <SectionHeading>Tracked Sessions</SectionHeading>
              <div className="space-y-1.5">
                {workSessions.map((s) => {
                  const start = new Date(s.start_datetime);
                  const end = new Date(s.end_datetime);
                  const durSec = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
                  const h = Math.floor(durSec / 3600);
                  const m = Math.floor((durSec % 3600) / 60);
                  const durLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
                  const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  const sameDay = start.toDateString() === end.toDateString();
                  const isActive = s.id === event.id;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${isActive ? "bg-indigo-50 border border-indigo-200" : "bg-white border border-gray-100"}`}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 shrink-0 text-[var(--twilio-gray-60)]">
                        <circle cx="6" cy="6" r="5"/><path d="M6 3v3l2 1.5" strokeLinecap="round"/>
                      </svg>
                      <span className="flex-1 text-[var(--twilio-navy)] tabular-nums">
                        {fmtTime(start)} – {fmtTime(end)}
                        {!sameDay && <span className="text-[var(--twilio-gray-60)]"> ({fmtDate(end)})</span>}
                      </span>
                      <span className="font-semibold text-indigo-700 tabular-nums shrink-0">{durLabel}</span>
                    </div>
                  );
                })}
                {/* Total */}
                {workSessions.length > 1 && (() => {
                  const totalSec = workSessions.reduce((acc, s) => {
                    const durSec = Math.max(0, Math.floor((new Date(s.end_datetime).getTime() - new Date(s.start_datetime).getTime()) / 1000));
                    return acc + durSec;
                  }, 0);
                  const th = Math.floor(totalSec / 3600);
                  const tm = Math.floor((totalSec % 3600) / 60);
                  return (
                    <div className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-[var(--twilio-navy)] border-t border-gray-100 mt-1 pt-2">
                      <span>Total tracked</span>
                      <span className="text-indigo-700 tabular-nums">{th > 0 ? `${th}h ${tm}m` : `${tm}m`}</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Convert */}
          <div className="mt-5">
            <button
              type="button"
              disabled={convertingEvent}
              onClick={() => void handleConvertEventToActionItem()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
                <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {convertingEvent ? "Converting…" : "Convert to Action Item"}
            </button>
          </div>

          {/* Activity Log */}
          <div className="mt-5">
            <SectionHeading>Activity Log</SectionHeading>
            <ActivityLogSection
              resourceType="calendar_event"
              resourceId={event.id}
              variant="inline"
              onRestore={async (rd) => { await restoreConversion(rd); }}
            />
          </div>

          {/* New Comments */}
          <div className="mt-5">
            <InlineCommentThread
              resourceType="calendar_event"
              resourceId={event.id}
              resourceLabel={event.title}
              compact
            />
          </div>

        </div>{/* end row 2 */}

      </div>{/* end flex-col wrapper */}
    </div>

      {logTimeProject && (
        <LogTimeModal
          project={logTimeProject}
          onClose={() => setLogTimeProject(null)}
          onLogged={() => setLogTimeProject(null)}
        />
      )}

      {editingItem && (
        <ActionItemModal
          item={editingItem}
          teamMembers={accountTeamMembers as unknown as TeamMember[]}
          onClose={() => setEditingItem(null)}
          onUpdated={(updated) => {
            setActionItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? { ...i, ...updated } : i));
            setEditingItem(null);
          }}
          onAutosaved={(updated) => {
            setActionItems((prev) => prev.map((i) => i.airtable_id === updated.airtable_id ? { ...i, ...updated } : i));
          }}
          onConverted={() => {
            setActionItems((prev) => prev.filter((i) => i.airtable_id !== editingItem.airtable_id));
            setEditingItem(null);
          }}
          onDeleted={() => {
            setActionItems((prev) => prev.filter((i) => i.airtable_id !== editingItem.airtable_id));
            setEditingItem(null);
          }}
        />
      )}
    </>
  );
}

// ── Meeting Notes ─────────────────────────────────────────────────────────────

// Strip @mention tokens from display text for action payloads
/** Projects (with their nested goals) of an account; goals no project references stay visible. */
function topLevelProjects(all: AccountProject[]): { project: AccountProject; goals: AccountProject[] }[] {
  const byId = new Map(all.map((p) => [String(p.id), p]));
  const claimed = new Set<string>();
  const rows = all.filter((p) => p.kind !== "goal").map((project) => {
    const goals = (project.goal_ids ?? []).map((id) => byId.get(String(id))).filter((g): g is AccountProject => !!g);
    goals.forEach((g) => claimed.add(String(g.id)));
    return { project, goals };
  });
  const orphans = all.filter((p) => p.kind === "goal" && !claimed.has(String(p.id))).map((project) => ({ project, goals: [] as AccountProject[] }));
  return [...rows, ...orphans];
}

function stripMentions(html: string) {
  return htmlToPreviewText(html).replace(/@\S+/g, "").replace(/\s{2,}/g, " ").trim();
}

// Extract @mentioned names from note HTML (or legacy plain text)
function extractMentions(html: string): string[] {
  return (htmlToPreviewText(html).match(/@(\S+)/g) ?? []).map((m) => m.slice(1));
}

// Icon components matching sidebar icons (inline SVG for size control)
function IconChecklist({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/>
      <path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <rect x="2" y="4" width="16" height="14" rx="2"/>
      <path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/>
    </svg>
  );
}
function IconSchedule({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <circle cx="10" cy="10" r="7"/>
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconAgent({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z" strokeLinejoin="round"/>
      <path d="M7 9h6M7 12h4" strokeLinecap="round"/>
    </svg>
  );
}

function NoteRow({
  note,
  eventId,
  eventTitle,
  accountName,
  teamMembers,
  onSave,
  onDelete,
  onActionItemCreated,
}: {
  note: MeetingNote;
  eventId: number;
  eventTitle: string;
  accountName?: string | null;
  teamMembers: TeamMember[];
  onSave: (n: MeetingNote) => void;
  onDelete: (id: number) => void;
  onActionItemCreated?: (item: AirtableActionItem) => void;
}) {
  const currentUser = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.html);
  const [noteReferences, setNoteReferences] = useState<CommentReference[]>([]);

  // Which tooltip is open: null | "action" | "calendar" | "reminder"
  const [openTooltip, setOpenTooltip] = useState<"action" | "calendar" | "reminder" | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipPanelRef = useRef<HTMLDivElement>(null);
  const actionBtnRef = useRef<HTMLButtonElement>(null);
  const calBtnRef = useRef<HTMLButtonElement>(null);
  const remBtnRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null);

  // Action Item form state
  const mentionsInNote = extractMentions(note.html);
  const preselected = teamMembers.filter((m) =>
    mentionsInNote.some((name) => m.full_name.replace(/\s+/g, "").toLowerCase() === name.toLowerCase())
  );
  const [aiAssignees, setAiAssignees] = useState<TeamMember[]>([]);
  const [aiPriority, setAiPriority] = useState<"Low" | "Medium" | "High" | "Critical">("Medium");
  const [aiDue, setAiDue] = useState("");
  const [aiSaved, setAiSaved] = useState(false);

  // Calendar form state
  const [calTitle, setCalTitle] = useState(stripMentions(note.html).slice(0, 80) || "Follow-up Meeting");
  const [calStart, setCalStart] = useState("");
  const [calEnd, setCalEnd] = useState("");
  const [calSaved, setCalSaved] = useState(false);

  // Reminder form state
  const [remDate, setRemDate] = useState("");
  const [remTime, setRemTime] = useState("09:00");
  const [remSaved, setRemSaved] = useState(false);

  const _nlsKey = `note-actions::${note.id}`;
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(_nlsKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  function markNoteDone(kind: "action" | "calendar" | "reminder") {
    setDoneActions((p) => { const n = new Set([...p, kind]); try { localStorage.setItem(_nlsKey, JSON.stringify([...n])); } catch {} return n; });
  }

  function openTooltipAt(which: "action" | "calendar" | "reminder") {
    const btn = which === "action" ? actionBtnRef.current : which === "calendar" ? calBtnRef.current : remBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const panelHeight = which === "reminder" ? 180 : 360;
      const spaceBelow = window.innerHeight - r.bottom - 6;
      if (spaceBelow < panelHeight && r.top > panelHeight) {
        setTooltipPos({ top: r.top - panelHeight - 6, right: window.innerWidth - r.right });
      } else {
        setTooltipPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
      }
    }
    setOpenTooltip(which === openTooltip ? null : which);
  }

  // Close tooltip on outside click — check both the button bar and the floating tooltip panel
  useEffect(() => {
    if (!openTooltip) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inBar = tooltipRef.current?.contains(target);
      const inPanel = tooltipPanelRef.current?.contains(target);
      if (!inBar && !inPanel) setOpenTooltip(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTooltip]);

  // Pre-fill assignees from mentions whenever tooltip opens
  useEffect(() => {
    if (openTooltip === "action") setAiAssignees(preselected);
    if (openTooltip === "calendar") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
      const end = new Date(tomorrow); end.setHours(11, 0, 0, 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      setCalStart(fmt(tomorrow)); setCalEnd(fmt(end));
      setCalTitle(stripMentions(note.html).slice(0, 80) || "Follow-up Meeting");
    }
    if (openTooltip === "reminder") {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      setRemDate(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTooltip]);

  function commitEdit() {
    setEditing(false);
    const trimmed = editText.trim();
    if (!trimmed || trimmed === note.html) return;
    schedulerApi.updateMeetingNote(note.id, {
      html: trimmed,
      text: htmlToPreviewText(trimmed),
      ...(noteReferences.length > 0 && { references: noteReferences }),
    })
      .then(({ data }) => onSave(data))
      .catch(() => {});
  }

  // ── Action submit handlers ────────────────────────────────────────────────

  function submitActionItem() {
    const assignees = aiAssignees.length > 0 ? aiAssignees : preselected;
    const primary = assignees[0];
    const assigneeName = primary?.full_name || currentUser?.display_name || "";
    const assigneeId = primary ? "" : currentUser?.airtable_collaborator_id || "";
    airtableApi.createActionItem({
      task: stripMentions(note.html),
      task_details: note.html,
      status: "Open",
      priority: aiPriority,
      due_date: aiDue || null,
      account_name: accountName ?? undefined,
      assignee_name: assigneeName,
      assignee_airtable_id: assigneeId,
    } as Parameters<typeof airtableApi.createActionItem>[0])
      .then(({ data }) => {
        setAiSaved(true);
        markNoteDone("action");
        onActionItemCreated?.(data);
        setTimeout(() => { setAiSaved(false); setOpenTooltip(null); }, 1400);
      })
      .catch(() => {});
  }

  function submitMeeting() {
    if (!calStart || !calEnd) return;
    const attendees = aiAssignees.map((m) => ({
      email: m.email, displayName: m.full_name, responseStatus: "needsAction" as const,
    }));
    schedulerApi.createEvent({
      title: calTitle,
      description: `From meeting note: ${note.html}`,
      start_datetime: new Date(calStart).toISOString(),
      end_datetime: new Date(calEnd).toISOString(),
      attendees,
    } as Parameters<typeof schedulerApi.createEvent>[0])
      .then(() => { setCalSaved(true); markNoteDone("calendar"); setTimeout(() => { setCalSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  function submitReminder() {
    if (!remDate) return;
    const due = new Date(`${remDate}T${remTime}:00`);
    schedulerApi.createReminder({
      title: stripMentions(note.html).slice(0, 200) || "Meeting note reminder",
      body: htmlToPreviewText(note.html),
      resource_type: "calendar_event",
      resource_id: eventId,
      resource_label: eventTitle,
      due_at: due.toISOString(),
    } as Parameters<typeof schedulerApi.createReminder>[0])
      .then(() => { setRemSaved(true); markNoteDone("reminder"); setTimeout(() => { setRemSaved(false); setOpenTooltip(null); }, 1400); })
      .catch(() => {});
  }

  function handleSendToAgent() {
    window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: htmlToPreviewText(note.html) } }));
  }

  return (
    <li className="group relative flex items-start gap-2 px-3 py-2 hover:bg-gray-50 transition-colors">
      <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-[var(--twilio-navy)] shrink-0 opacity-50" />

      {/* Text or edit input — buttons float right so first line shares space, subsequent lines use full width */}
      <div className="flex-1 min-w-0 pb-0.5">
        {editing ? (
          <div
            onBlur={() => commitEdit()}
            onKeyDownCapture={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setEditText(note.html); }
            }}
          >
            <RichTextMentionEditor
              value={editText}
              onChange={setEditText}
              onSubmit={() => commitEdit()}
              onReferenceInsert={(ref) => {
                setNoteReferences((prev) => {
                  const exists = prev.find((r) => r.resource_type === ref.resource_type && r.resource_id === ref.resource_id);
                  return exists ? prev : [...prev, ref];
                });
              }}
              placeholder="Add a note…"
              minHeightClassName="min-h-[32px]"
              autoFocus
            />
          </div>
        ) : (
          <div
            className="text-sm text-[var(--twilio-navy)] leading-relaxed cursor-text prose prose-sm max-w-none rich-text"
            onClick={() => { setEditing(true); setEditText(note.html); }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(note.html)) }}
          />
        )}
        {/* Hover action icons — CSS float so text wraps naturally beneath them */}
        {!editing && (
          <div ref={tooltipRef} className="float-right flex items-center gap-0.5 bg-transparent group-hover:bg-gray-50/90 rounded-md px-0.5 ml-1 transition-colors">
            {/* Action Item */}
            <button ref={actionBtnRef} onClick={() => openTooltipAt("action")} title="Create action item"
              className={`p-1 rounded transition-colors ${doneActions.has("action") ? "text-blue-600 opacity-100" : openTooltip === "action" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
              <IconChecklist className="w-3.5 h-3.5" />
            </button>

            {/* Calendar */}
            <button ref={calBtnRef} onClick={() => openTooltipAt("calendar")} title="Create meeting"
              className={`p-1 rounded transition-colors ${doneActions.has("calendar") ? "text-blue-600 opacity-100" : openTooltip === "calendar" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
              <IconCalendar className="w-3.5 h-3.5" />
            </button>

            {/* Reminder */}
            <button ref={remBtnRef} onClick={() => openTooltipAt("reminder")} title="Set reminder"
              className={`p-1 rounded transition-colors ${doneActions.has("reminder") ? "text-blue-600 opacity-100" : openTooltip === "reminder" ? "text-[var(--twilio-navy)] bg-gray-100 opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100"}`}>
              <IconSchedule className="w-3.5 h-3.5" />
            </button>

            {/* Agent */}
            <button onClick={handleSendToAgent} title="Send to agent chat"
              className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] hover:bg-gray-100">
              <IconAgent className="w-3.5 h-3.5" />
            </button>

            <span className="h-3 w-px bg-gray-200 mx-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />

            {/* Delete */}
            <button onClick={() => onDelete(note.id)} title="Delete note"
              className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 text-[var(--twilio-gray-40)] hover:text-red-500 hover:bg-red-50">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Author — right-aligned, only visible on hover */}
        {!editing && note.author_display && (
          <div className="text-right text-[10px] text-[var(--twilio-gray-40)] opacity-0 group-hover:opacity-100 transition-opacity" title={note.author_display}>
            {note.author_display}
          </div>
        )}

      </div>

      {/* Floating tooltip panels — portalled to body so overflow:hidden ancestors can't clip them */}
      {!editing && (
        <div>
          {/* ── Action Item tooltip ───────────────────────────────────────── */}
          {openTooltip === "action" && tooltipPos && createPortal(
            <div ref={tooltipPanelRef} className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Action Item</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{stripMentions(note.html)}</div>

              {/* Assignees multi-select */}
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Assign to</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}
                      <button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  value=""
                  onChange={(e) => {
                    const member = teamMembers.find((m) => String(m.id) === e.target.value);
                    if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]);
                  }}
                >
                  <option value="">+ Add assignee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}{m.title ? ` — ${m.title}` : ""}</option>
                  ))}
                </select>
              </div>

              {/* Priority + Due date */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Priority</p>
                  <select value={aiPriority} onChange={(e) => setAiPriority(e.target.value as typeof aiPriority)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white">
                    {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Due date</p>
                  <input type="date" value={aiDue} onChange={(e) => setAiDue(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white" />
                </div>
              </div>

              <button onClick={submitActionItem} disabled={aiSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${aiSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700"}`}>
                {aiSaved ? "✓ Created" : "Create Action Item"}
              </button>
            </div>
          , document.body)}

          {/* ── Calendar tooltip ──────────────────────────────────────────── */}
          {openTooltip === "calendar" && tooltipPos && createPortal(
            <div ref={tooltipPanelRef} className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Create Meeting</p>

              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Title</p>
                <input value={calTitle} onChange={(e) => setCalTitle(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Start</p>
                  <input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">End</p>
                  <input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
              </div>

              {/* Invite attendees — reuse aiAssignees pool */}
              <div>
                <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Invite</p>
                <div className="flex flex-wrap gap-1 mb-1">
                  {aiAssignees.map((m) => (
                    <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-100 text-indigo-700">
                      {m.full_name}
                      <button onClick={() => setAiAssignees((prev) => prev.filter((a) => a.id !== m.id))} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  value=""
                  onChange={(e) => {
                    const member = teamMembers.find((m) => String(m.id) === e.target.value);
                    if (member && !aiAssignees.find((a) => a.id === member.id)) setAiAssignees((prev) => [...prev, member]);
                  }}>
                  <option value="">+ Add attendee…</option>
                  {teamMembers.filter((m) => !aiAssignees.find((a) => a.id === m.id)).map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>

              <button onClick={submitMeeting} disabled={!calStart || !calEnd || calSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${calSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {calSaved ? "✓ Created" : "Create Meeting"}
              </button>
            </div>
          , document.body)}

          {/* ── Reminder tooltip ──────────────────────────────────────────── */}
          {openTooltip === "reminder" && tooltipPos && createPortal(
            <div ref={tooltipPanelRef} className="fixed z-[9999] w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2.5" style={{ top: tooltipPos.top, right: tooltipPos.right }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">Set Reminder</p>
              <div className="text-xs text-[var(--twilio-gray-80)] bg-gray-50 rounded-lg px-2 py-1.5 line-clamp-2">{stripMentions(note.html)}</div>

              {/* Quick picks */}
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "In 1 hour", mins: 60 },
                  { label: "Tomorrow 9am", mins: null },
                  { label: "In 2 days", mins: null, days: 2 },
                ].map(({ label, mins, days }) => (
                  <button key={label}
                    onClick={() => {
                      const d = new Date();
                      if (mins) { d.setMinutes(d.getMinutes() + mins); }
                      else if (days) { d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); }
                      else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
                      const pad = (n: number) => String(n).padStart(2, "0");
                      setRemDate(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
                      setRemTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
                    }}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors">
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Date</p>
                  <input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] text-[var(--twilio-gray-60)] mb-1">Time</p>
                  <input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
              </div>

              <button onClick={submitReminder} disabled={!remDate || remSaved}
                className={`w-full text-xs font-semibold py-1.5 rounded-lg transition-colors ${remSaved ? "bg-emerald-500 text-white" : "bg-[var(--twilio-navy)] text-white hover:bg-indigo-700 disabled:opacity-40"}`}>
                {remSaved ? "✓ Reminder Set" : "Set Reminder"}
              </button>
            </div>
          , document.body)}
        </div>
      )}
    </li>
  );
}

// ── Gong / Meeting Summary paste section ──────────────────────────────────────

function detectMentionsInSummary(
  text: string,
  teamMembers: TeamMember[],
  accountTeamMembers: { id?: number; full_name: string }[] = [],
): { members: TeamMember[]; display: string } {
  // Build a set of full_names on the account team for O(1) lookup
  const accountNames = new Set(accountTeamMembers.map((m) => m.full_name.toLowerCase()));

  const found: TeamMember[] = [];
  for (const m of teamMembers) {
    const first = m.full_name.split(" ")[0];
    const fullPat = new RegExp(`(?<!@)\\b${m.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const firstPat = new RegExp(`(?<!@)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (fullPat.test(text) || firstPat.test(text)) {
      if (!found.find((f) => f.id === m.id)) found.push(m);
    }
  }

  // Only rewrite names for members who are on this account's team
  console.log("[detectMentions] accountTeamMembers:", accountTeamMembers.map((m) => m.full_name), "found:", found.map((m) => m.full_name));
  let display = text;
  for (const m of found) {
    if (!accountNames.has(m.full_name.toLowerCase())) continue;
    const first = m.full_name.split(" ")[0];
    const fullPat = new RegExp(`(?<!@)\\b${m.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const firstPat = new RegExp(`(?<!@)\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    display = display.replace(fullPat, `@${m.full_name}`).replace(firstPat, `@${m.full_name}`);
  }

  return { members: found, display };
}

type GongItem = { kind: "heading"; text: string } | { kind: "subheading"; text: string } | { kind: "bullet"; text: string };

// Section headings recognised from Gong ("Recap", "Key Points", "Next Steps")
// and Zoom ("Quick recap", "Next steps", "Summary", and named sub-sections like "Use Case Discussion Planning")
const GONG_HEADINGS = /^(recap|quick\s+recap|key\s+points?|next\s+steps?|summary|collaboration):?$/i;

// A line is a Zoom "Next steps" person-name subheading when it is a standalone
// name with NO bullet prefix and falls inside the "Next steps" section.
// We use a simple heuristic: not a bullet, not a known heading, and under 40
// characters (person names are short).
function isPersonSubheading(line: string, inNextSteps: boolean): boolean {
  if (!inNextSteps) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Must not start with a bullet marker
  if (/^[\s]*[-•*▪◦–—]/.test(trimmed)) return false;
  if (/^[\s]*\d+[.)]/.test(trimmed)) return false;
  // Must not be a known section heading itself
  if (GONG_HEADINGS.test(trimmed.replace(/:$/, ""))) return false;
  // Short, no sentence-ending punctuation — looks like a name
  return trimmed.length <= 50 && !/[.?!]$/.test(trimmed);
}

function parseBullets(text: string): GongItem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  let inNextSteps = false;
  const result: GongItem[] = [];
  for (const l of lines) {
    const stripped = l.replace(/^[\s]*[-•*▪◦–—][\s]+/, "").replace(/^[\s]*\d+[.)]\s+/, "").trim();
    const headingText = stripped.replace(/:$/, "");
    if (GONG_HEADINGS.test(headingText)) {
      inNextSteps = /next\s+steps?/i.test(headingText);
      result.push({ kind: "heading", text: headingText });
    } else if (isPersonSubheading(l, inNextSteps)) {
      result.push({ kind: "subheading", text: stripped });
    } else {
      result.push({ kind: "bullet", text: stripped });
    }
  }
  return result;
}

function renderWithMentions(text: string): React.ReactNode {
  return renderMeetingNoteText(text);
}

function GongActionTooltip({ kind, noteText, eventId, accountName, airtableAccountId, mentionedMembers, anchorRect, onDone, onCreated, onClose }: {
  kind: "action" | "reminder" | "calendar";
  noteText: string;
  eventId: number;
  accountName?: string | null;
  airtableAccountId?: number | null;
  mentionedMembers?: TeamMember[];
  anchorRect: DOMRect;
  onDone?: (kind: "action" | "reminder" | "calendar") => void;
  onCreated?: (item: AirtableActionItem) => void;
  onClose: () => void;
}) {
  const currentUser = useCurrentUser();
  const [priority, setPriority] = useState<"Low"|"Medium"|"High"|"Critical">("Medium");
  const [due, setDue] = useState("");
  const [remDate, setRemDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateKey(d); });
  const [remTime, setRemTime] = useState("09:00");
  const [calTitle, setCalTitle] = useState(noteText.slice(0, 80));
  const [calStart, setCalStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10,0,0,0); return toLocalDatetimeValue(d.toISOString()); });
  const [calEnd, setCalEnd] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11,0,0,0); return toLocalDatetimeValue(d.toISOString()); });
  const [done, setDone] = useState(false);
  const tooltipElRef = useRef<HTMLDivElement>(null);
  // Compute fixed position from anchor: prefer below, flip above if too close to viewport bottom
  const TOOLTIP_HEIGHT_ESTIMATE = 180;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < TOOLTIP_HEIGHT_ESTIMATE + 8;
  const fixedTop = openUpward ? anchorRect.top - TOOLTIP_HEIGHT_ESTIMATE - 4 : anchorRect.bottom + 4;
  const fixedRight = window.innerWidth - anchorRect.right;

  const stripped = noteText.replace(/@\S+/g, "").trim();
  const assignee = mentionedMembers?.[0];

  async function submit() {
    if (kind === "action") {
      const { data } = await airtableApi.createActionItem({
        task: stripped, status: "Open", priority, due_date: due || null,
        account: airtableAccountId ?? undefined,
        account_name: accountName ?? undefined,
        assignee_name: assignee?.full_name || currentUser?.display_name || "",
        assignee_airtable_id: assignee ? String(assignee.id) : currentUser?.airtable_collaborator_id || "",
      } as Parameters<typeof airtableApi.createActionItem>[0]);
      onCreated?.(data);
      localStorage.setItem("actionItemsUpdated", String(Date.now()));
      window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated", newValue: String(Date.now()) }));
    } else if (kind === "reminder") {
      await schedulerApi.createReminder({ title: stripped.slice(0, 200) || "Note reminder", body: noteText, resource_type: "calendar_event", resource_id: eventId, due_at: new Date(`${remDate}T${remTime}:00`).toISOString() } as Parameters<typeof schedulerApi.createReminder>[0]);
    } else {
      await schedulerApi.createEvent({ title: calTitle, description: `From meeting note: ${noteText}`, start_datetime: new Date(calStart).toISOString(), end_datetime: new Date(calEnd).toISOString() } as Parameters<typeof schedulerApi.createEvent>[0]);
    }
    setDone(true);
    onDone?.(kind);
    setTimeout(onClose, 1200);
  }

  const label = kind === "action" ? "Create Action Item" : kind === "reminder" ? "Set Reminder" : "Create Meeting";

  return (
    <div ref={tooltipElRef} style={{ position: "fixed", top: fixedTop, right: fixedRight, zIndex: 9999, background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "10px", padding: "10px 12px", width: "240px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-gray-500)", margin: 0 }}>{label}</p>
      <div style={{ fontSize: "0.75rem", background: "var(--surface-subtle)", borderRadius: "5px", padding: "4px 7px", color: "var(--text-gray-700)", lineHeight: 1.4, maxHeight: "40px", overflow: "hidden" }}>{stripped}</div>
      {kind === "action" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Priority</p>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }}>
              {(["Low","Medium","High","Critical"] as const).map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Due date</p>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} />
          </div>
        </div>
      )}
      {kind === "reminder" && (
        <div style={{ display: "flex", gap: "6px" }}>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Date</p><input type="date" value={remDate} onChange={(e) => setRemDate(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Time</p><input type="time" value={remTime} onChange={(e) => setRemTime(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
        </div>
      )}
      {kind === "calendar" && (
        <>
          <div><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Title</p><input value={calTitle} onChange={(e) => setCalTitle(e.target.value)} style={{ width: "100%", fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: "6px" }}>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>Start</p><input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
            <div style={{ flex: 1 }}><p style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", marginBottom: "3px" }}>End</p><input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)} style={{ width: "100%", fontSize: "0.6875rem", border: "1px solid var(--border-subtle)", borderRadius: "5px", padding: "3px 6px", outline: "none" }} /></div>
          </div>
        </>
      )}
      <button onClick={() => void submit()} style={{ padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: done ? "#10b981" : "#6366f1", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}>
        {done ? "✓ Done" : label}
      </button>
    </div>
  );
}

function _strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 120); i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function GongBulletRow({ text, eventId, accountName, airtableAccountId, isLast, onCreatedActionItem, mentionedMembers, persistKey }: { text: string; eventId: number; accountName?: string | null; airtableAccountId?: number | null; isLast: boolean; onCreatedActionItem?: (item: AirtableActionItem) => void; mentionedMembers?: TeamMember[]; persistKey: string }) {
  const [openAction, setOpenAction] = useState<"action" | "reminder" | "calendar" | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [doneActions, setDoneActions] = useState<Set<"action" | "calendar" | "reminder">>(() => {
    try { const v = localStorage.getItem(persistKey); return v ? new Set(JSON.parse(v) as ("action" | "calendar" | "reminder")[]) : new Set(); } catch { return new Set(); }
  });
  const tooltipRef = useRef<HTMLDivElement>(null);

  function openWith(kind: "action" | "reminder" | "calendar", e: React.MouseEvent<HTMLButtonElement>) {
    if (openAction === kind) { setOpenAction(null); setAnchorRect(null); return; }
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setOpenAction(kind);
  }

  useEffect(() => {
    if (!openAction) return;
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setOpenAction(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openAction]);

  return (
    <div className="group" style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "6px 10px", borderBottom: isLast ? undefined : "1px solid rgba(0,0,0,0.05)", position: "relative" }}>
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#9ca3af", flexShrink: 0, marginTop: "7px" }} />
      <p style={{ flex: 1, fontSize: "0.8125rem", color: "var(--text-ink)", lineHeight: 1.5, margin: 0 }}>{renderWithMentions(text)}</p>
      <div ref={tooltipRef} style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
        <button title="Create action item" onClick={(e) => openWith("action", e)} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("action") ? "#2563eb" : "var(--text-gray-400)" }} className={doneActions.has("action") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round"/><path d="M3 5l1.5 1.5L7 3M3 10l1.5 1.5L7 8M3 15l1.5 1.5L7 13" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button title="Set reminder" onClick={(e) => openWith("reminder", e)} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("reminder") ? "#2563eb" : "var(--text-gray-400)" }} className={doneActions.has("reminder") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button title="Create meeting" onClick={(e) => openWith("calendar", e)} style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: doneActions.has("calendar") ? "#2563eb" : "var(--text-gray-400)" }} className={doneActions.has("calendar") ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: "12px", height: "12px" }}><rect x="2" y="4" width="16" height="14" rx="2"/><path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round"/></svg>
        </button>
        {openAction && anchorRect && (
          <GongActionTooltip
            kind={openAction}
            noteText={text}
            eventId={eventId}
            accountName={accountName}
            airtableAccountId={airtableAccountId}
            mentionedMembers={mentionedMembers}
            anchorRect={anchorRect}
            onDone={(kind) => setDoneActions((prev) => { const n = new Set([...prev, kind]); try { localStorage.setItem(persistKey, JSON.stringify([...n])); } catch {} return n; })}
            onCreated={onCreatedActionItem}
            onClose={() => { setOpenAction(null); setAnchorRect(null); }}
          />
        )}
      </div>
    </div>
  );
}

function MeetingSummarySection({ eventId, meetingId, existingNotes, existingZoomNotes, accountName, airtableAccountId, accountTeamMembers, onCreatedActionItem }: {
  eventId: number;
  meetingId?: number;
  existingNotes?: string;
  existingZoomNotes?: string;
  accountName?: string | null;
  airtableAccountId?: number | null;
  accountTeamMembers?: AccountTeamMember[];
  onCreatedActionItem?: (item: AirtableActionItem) => void;
}) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  // Both providers are held at once and `raw`/`items`/`showPaste` view the active one —
  // the same shape as the other two summary panels. Whitespace-only counts as empty:
  // Airtable richText reports "\n" forever once a cell has been written and cleared.
  const [notesBySource, setNotesBySource] = useState<Record<MeetingNotesSource, string>>(() => ({
    gong: existingNotes?.trim() ? existingNotes : "",
    zoom: existingZoomNotes?.trim() ? existingZoomNotes : "",
  }));
  const [source, setSource] = useState<MeetingNotesSource>(() =>
    preferredMeetingSource(existingNotes, existingZoomNotes)
  );
  const initialText = notesBySource[source];
  const [raw, setRaw] = useState(initialText);
  const [items, setItems] = useState<(GongItem & { mentionedMembers?: TeamMember[] })[]>(() =>
    initialText.trim() ? parseBullets(initialText) : []
  );
  const [showPaste, setShowPaste] = useState(!initialText.trim());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const resolvedMeetingId = useRef<number | undefined>(meetingId);

  useEffect(() => {
    teamApi.listMembers().then(({ data }) => setTeamMembers(data.results ?? [])).catch(() => {});
  }, []);

  function showSource(next: MeetingNotesSource, store: Record<MeetingNotesSource, string>) {
    setSource(next);
    const text = store[next] ?? "";
    setRaw(text);
    setItems(text.trim() ? parseBullets(text) : []);
    setShowPaste(!text.trim());
  }

  /** Save `text` to whichever provider the toggle is on. Used by every save path. */
  async function saveForSource(text: string) {
    setNotesBySource((prev) => ({ ...prev, [source]: text }));
    if (resolvedMeetingId.current) {
      const save = source === "zoom"
        ? airtableApi.updateMeetingZoomNotesByPk
        : airtableApi.updateMeetingGongNotesByPk;
      await save(resolvedMeetingId.current, text);
      return;
    }
    const save = source === "zoom"
      ? airtableApi.updateMeetingZoomNotes
      : airtableApi.updateMeetingGongNotes;
    const { data } = await save(eventId, text);
    resolvedMeetingId.current = data.id;
  }

  // Re-initialize when the target event/meeting changes as well as when its notes text
  // does — the identity half is what the other two summary panels already check, and
  // without it switching from a meeting whose notes were just pasted to one that has no
  // notes leaves both `existing*` props undefined, so the guard never fires: the previous
  // meeting's notes stay on screen and `resolvedMeetingId` keeps pointing at its row.
  const prevEventRef = useRef(eventId);
  const prevMeetingRef = useRef(meetingId);
  const prevExistingRef = useRef(existingNotes);
  const prevExistingZoomRef = useRef(existingZoomNotes);
  useEffect(() => {
    const identityChanged = eventId !== prevEventRef.current || meetingId !== prevMeetingRef.current;
    if (identityChanged || existingNotes !== prevExistingRef.current || existingZoomNotes !== prevExistingZoomRef.current) {
      prevEventRef.current = eventId;
      prevMeetingRef.current = meetingId;
      prevExistingRef.current = existingNotes;
      prevExistingZoomRef.current = existingZoomNotes;
      resolvedMeetingId.current = meetingId;
      const store: Record<MeetingNotesSource, string> = {
        gong: existingNotes?.trim() ? existingNotes : "",
        zoom: existingZoomNotes?.trim() ? existingZoomNotes : "",
      };
      setNotesBySource(store);
      showSource(preferredMeetingSource(store.gong, store.zoom), store);
    }
  }, [eventId, existingNotes, existingZoomNotes, meetingId]);

  async function persistAndNotify(text: string, parsed: GongItem[]) {
    const notified = new Set<number>();
    const enriched = parsed.map((item) => {
      if (item.kind !== "bullet") return item;
      const { members, display } = detectMentionsInSummary(item.text, teamMembers, accountTeamMembers ?? []);
      return { ...item, text: display, mentionedMembers: members };
    });
    setItems(enriched);
    setShowPaste(false);

    if (!resolvedMeetingId.current && !eventId) return;
    setSaveState("saving");
    try {
      await saveForSource(text.trim());
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }

    const summaryText = enriched.filter((i) => i.kind === "bullet").map((i) => `• ${i.text}`).join("\n");
    for (const item of enriched) {
      if (item.kind !== "bullet" || !item.mentionedMembers?.length) continue;
      for (const member of item.mentionedMembers) {
        if (notified.has(member.id) || !member.slack_handle) continue;
        notified.add(member.id);
        const msg = `👋 You were mentioned in meeting notes${accountName ? ` for *${accountName}*` : ""}:\n\n${summaryText}`;
        integrationsApi.notifySlackMention(member.slack_handle, msg).catch(() => {});
      }
    }
  }

  async function handleParse() {
    const parsed = parseBullets(raw);
    if (parsed.length === 0) return;
    await persistAndNotify(raw, parsed);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.trim()) return;
    const ta = e.target as HTMLTextAreaElement;
    const before = ta.value.slice(0, ta.selectionStart ?? 0);
    const after = ta.value.slice(ta.selectionEnd ?? ta.value.length);
    const fullText = before + pasted + after;
    setRaw(fullText);
    const parsed = parseBullets(fullText);
    if (parsed.length > 0) {
      void persistAndNotify(fullText, parsed);
    } else {
      void saveRaw(fullText);
    }
  }

  async function saveRaw(text: string) {
    if (!text.trim()) return;
    if (!resolvedMeetingId.current && !eventId) return;
    setSaveState("saving");
    try {
      await saveForSource(text.trim());
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  async function handleClear() {
    setItems([]);
    setRaw("");
    setShowPaste(true);
    if (!resolvedMeetingId.current && !eventId) return;
    setSaveState("saving");
    try {
      // Clears only the active provider — the other one's notes stay put.
      await saveForSource("");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {saveState === "saving" && <span style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)" }}>Saving…</span>}
          {saveState === "saved" && <span style={{ fontSize: "0.6875rem", color: "#16a34a" }}>✓ Saved</span>}
          {saveState === "error" && <span style={{ fontSize: "0.6875rem", color: "#dc2626" }}>Save failed</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <MeetingSummarySourceToggle
            value={source}
            onChange={(next) => showSource(next, notesBySource)}
            hasGong={!!notesBySource.gong.trim()}
            hasZoom={!!notesBySource.zoom.trim()}
          />
          {items.length > 0 && (
            <button onClick={() => void handleClear()} style={{ fontSize: "0.6875rem", color: "var(--text-gray-400)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Clear
            </button>
          )}
          <button onClick={() => setShowPaste((v) => !v)} style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showPaste ? "Hide" : items.length > 0 ? "Edit paste" : "+ Paste summary"}
          </button>
        </div>
      </div>

      {showPaste && (
        <div style={{ marginBottom: "8px" }}>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onPaste={handlePaste}
            onBlur={() => { if (raw.trim()) void saveRaw(raw); }}
            rows={7}
            placeholder={source === "zoom"
              ? "Paste your Zoom AI Companion summary or any bulleted text here…"
              : "Paste your Gong AI summary, meeting notes, or any bulleted text here…"}
            style={{ width: "100%", fontSize: "0.8125rem", border: "1px solid var(--border-subtle)", borderRadius: "7px", padding: "8px 10px", outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box", color: "var(--text-ink)" }}
          />
          <button onClick={() => void handleParse()} disabled={!raw.trim()} style={{ marginTop: "5px", width: "100%", padding: "5px 0", fontSize: "0.75rem", fontWeight: 700, background: "#6366f1", color: "#fff", border: "none", borderRadius: "6px", cursor: raw.trim() ? "pointer" : "not-allowed", opacity: raw.trim() ? 1 : 0.4 }}>
            Parse & Save
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: "8px", background: "var(--surface-card)", overflow: "hidden" }}>
          {items.map((item, i) => {
            if (item.kind === "heading") {
              return (
                <div key={i} style={{ padding: "6px 10px 3px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "capitalize", color: "var(--text-ink)", margin: 0, letterSpacing: "0.01em" }}>{item.text}</p>
                </div>
              );
            }
            if (item.kind === "subheading") {
              return (
                <div key={i} style={{ padding: "4px 10px 2px 20px", background: "rgba(99,102,241,0.04)" }}>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#6366f1", margin: 0, letterSpacing: "0.01em" }}>{item.text}</p>
                </div>
              );
            }
            const isLast = i === items.length - 1 || items[i + 1]?.kind === "heading" || items[i + 1]?.kind === "subheading";
            return (
              <GongBulletRow key={i} persistKey={`gong-actions::${eventId}::${_strHash(item.text)}`} text={item.text} eventId={eventId} accountName={accountName} airtableAccountId={airtableAccountId} isLast={isLast} onCreatedActionItem={onCreatedActionItem} mentionedMembers={item.mentionedMembers} />
            );
          })}
        </div>
      )}

      {!showPaste && items.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center h-16">
          <button onClick={() => setShowPaste(true)} className="text-sm text-[var(--twilio-gray-40)] hover:text-indigo-500 transition-colors">
            + Paste Gong, Zoom, or meeting summary
          </button>
        </div>
      )}
    </div>
  );
}

function MeetingNotesSection({
  eventId,
  eventTitle,
  accountName,
  notes,
  setNotes,
  locallyCreatedNoteIds,
  onActionItemCreated,
}: {
  eventId: number;
  eventTitle: string;
  accountName?: string | null;
  notes: MeetingNote[];
  setNotes: React.Dispatch<React.SetStateAction<MeetingNote[]>>;
  locallyCreatedNoteIds: MutableRefObject<Set<number>>;
  onActionItemCreated?: (item: AirtableActionItem) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const draftEditorRef = useRef<RichTextMentionEditorHandle>(null);

  useEffect(() => {
    teamApi.listMembers().then(({ data }) => setTeamMembers(data.results ?? [])).catch(() => {});
  }, []);

  // An unsent draft belongs to the event it was typed against. The editor is built once
  // (`value` alone does not push into ProseMirror), so the ref's clear() is what actually
  // empties it — without this, Enter on the next event posts the previous one's text.
  const prevEventIdRef = useRef(eventId);
  useEffect(() => {
    if (prevEventIdRef.current === eventId) return;
    prevEventIdRef.current = eventId;
    setDraft("");
    setSaveError(false);
    draftEditorRef.current?.clear();
  }, [eventId]);

  async function handleAddNote() {
    const text = draft.trim();
    if (!text || saving) return;
    // Synthetic events (negative IDs) don't have a DB record — notes can't be saved
    if (eventId <= 0) { setSaveError(true); return; }
    setSaving(true);
    setSaveError(false);
    try {
      const { data } = await schedulerApi.createMeetingNote({
        event: eventId,
        html: text,
        text: htmlToPreviewText(text),
        position: notes.length,
      });
      locallyCreatedNoteIds.current.add(data.id);
      setNotes((prev) => prev.some((n) => n.id === data.id) ? prev : [...prev, data]);
      setDraft("");
      draftEditorRef.current?.clear();
    } catch (err) {
      console.error("[MeetingNotes] Failed to save note:", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function handleSaveEdit(updated: MeetingNote) {
    setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  }

  async function handleDelete(id: number) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try { await schedulerApi.deleteMeetingNote(id); } catch { /* best effort */ }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* New note input */}
      <div className={`relative flex items-start gap-2 px-3 py-2 ${notes.length > 0 ? "border-b border-gray-100" : ""}`}>
        <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
        <div className="flex-1">
          <RichTextMentionEditor
            ref={draftEditorRef}
            value={draft}
            onChange={(html) => { setDraft(html); if (saveError) setSaveError(false); }}
            onSubmit={() => void handleAddNote()}
            placeholder="Add a note…"
            minHeightClassName="min-h-[32px]"
          />
        </div>
        {draft.trim() && (
          <button
            onClick={() => void handleAddNote()}
            disabled={saving}
            className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 shrink-0 transition-colors self-start mt-0.5"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        )}
        {saveError && (
          <span className="text-[10px] text-red-500 shrink-0 self-start mt-1">
            {eventId <= 0 ? "Sync event to save notes" : "Save failed — try again"}
          </span>
        )}
      </div>
      {notes.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              eventId={eventId}
              eventTitle={eventTitle}
              accountName={accountName}
              teamMembers={teamMembers}
              onSave={handleSaveEdit}
              onDelete={handleDelete}
              onActionItemCreated={onActionItemCreated}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountCard({
  account,
  matchMethod,
}: {
  account: AirtableAccount;
  matchMethod?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div className="col-span-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Account</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[var(--twilio-navy)] font-semibold">{account.name}</p>
          {account.health_score && (
            <span className="text-[11px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {account.health_score}
            </span>
          )}
          {matchMethod && (
            <span className="text-[11px] bg-gray-100 text-[var(--twilio-gray-60)] px-2 py-0.5 rounded-full">
              via {matchMethod}
            </span>
          )}
        </div>
        {account.email_domain && (
          <p className="text-[11px] text-[var(--twilio-gray-60)] mt-0.5">{account.email_domain}</p>
        )}
      </div>
      {account.open_ticket_count > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Open tickets</p>
          <p className="text-[var(--twilio-navy)]">{account.open_ticket_count}</p>
        </div>
      )}
      {account.time_budget > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Time budget</p>
          <p className="text-[var(--twilio-navy)]">{formatDuration(account.time_budget)}</p>
        </div>
      )}
      {account.total_meeting_duration > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Total meetings</p>
          <p className="text-[var(--twilio-navy)]">{formatDuration(account.total_meeting_duration)}</p>
        </div>
      )}
      {account.next_meeting && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--twilio-gray-60)]">Next meeting</p>
          <p className="text-[var(--twilio-navy)]">
            {new Date(account.next_meeting).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        </div>
      )}
    </div>
  );
}

function AirtableMeetingSection({
  meetings,
  eventTitle,
}: {
  meetings: AirtableMeeting[];
  eventTitle: string;
}) {
  const match =
    meetings.find((m) => m.name.toLowerCase().includes(eventTitle.toLowerCase())) ??
    meetings[0];

  if (!match) return null;

  return (
    <section>
      <SectionHeading>Meeting Record</SectionHeading>
      <div className="space-y-4">
        {match.expected_topics && (
          <div>
            <p className="text-sm font-medium text-[var(--twilio-navy)] mb-1">Expected Topics</p>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-[var(--twilio-gray-80)] whitespace-pre-wrap">
              {match.expected_topics}
            </div>
          </div>
        )}
        {/* Read-only view of whatever notes exist. Gong wins when both do, matching the
            editable panel's default; falling back to Zoom keeps a Zoom-only meeting from
            reading as "no notes yet". */}
        {(match.gong_notes?.trim() || match.zoom_notes?.trim()) ? (
          <div>
            <p className="text-sm font-medium text-[var(--twilio-navy)] mb-1">
              Meeting Notes
              <span className="ml-1.5 text-xs font-normal text-[var(--twilio-gray-60)]">
                {match.gong_notes?.trim() ? "Gong" : "Zoom"}
              </span>
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-[var(--twilio-gray-80)] whitespace-pre-wrap">
              {match.gong_notes?.trim() ? match.gong_notes : match.zoom_notes}
            </div>
            {match.gong_url && (
              <a
                href={match.gong_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-500 hover:underline mt-1 inline-block"
              >
                View Gong recording →
              </a>
            )}
            {match.zoom_url && (
              <a
                href={match.zoom_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-500 hover:underline mt-1 inline-block ml-3"
              >
                View Zoom recording →
              </a>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-[var(--twilio-navy)] mb-1">Meeting Notes</p>
            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-3 text-sm text-[var(--twilio-gray-60)] italic">
              Notes will appear here after the meeting.
            </div>
          </div>
        )}
        <div className="flex gap-3">
          {match.customer_slack && (
            <a href={match.customer_slack} target="_blank" rel="noopener noreferrer"
              className="text-sm text-indigo-500 hover:underline">
              Customer Slack →
            </a>
          )}
          {match.account_team_slack && (
            <a href={match.account_team_slack} target="_blank" rel="noopener noreferrer"
              className="text-sm text-indigo-500 hover:underline">
              Account Team Slack →
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
