/**
 * CreateEventModal — Google-Calendar-style event creation form.
 *
 * Sections: title · category · date/time · account · guests · description
 *           (linked action items + artifacts) · video conferencing
 *           · notification · repeat
 */

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { airtableApi, accountsApi, teamApi } from "../../lib/api";
import type { NewEventDraft, EventCategory, GuestEntry } from "../../types/calendar";
import type { AirtableActionItem } from "../../types/airtable";
import type { AccountArtifact } from "../../types/accounts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SavePayload {
  draft: NewEventDraft;
  assembledDescription: string;
  attendees: { email: string; displayName: string; responseStatus: "needsAction" }[];
  meetLink: string;
  effectiveCategory: string;
  sendInvites: boolean;
}

interface Props {
  draft: NewEventDraft;
  onChange: (updater: (prev: NewEventDraft) => NewEventDraft) => void;
  onSave: (payload: SavePayload) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  zoomConnected: boolean;
  /** Ref to the eagerly-loaded accounts list — read at call time, not render time. */
  allAccountsRef: MutableRefObject<{ id: number; name: string }[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_META: { id: EventCategory; label: string; icon: string; color: string }[] = [
  { id: "meeting",          label: "Meeting",          icon: "🗓", color: "bg-blue-500 border-blue-500 text-white" },
  { id: "task",             label: "Task",             icon: "✓",  color: "bg-violet-500 border-violet-500 text-white" },
  { id: "out_of_office",   label: "Out of Office",    icon: "🚫", color: "bg-rose-500 border-rose-500 text-white" },
  { id: "focus_time",      label: "Focus Time",       icon: "🎯", color: "bg-amber-500 border-amber-500 text-white" },
  { id: "working_location", label: "Working Location", icon: "📍", color: "bg-emerald-500 border-emerald-500 text-white" },
  { id: "appointment",     label: "Appointment",      icon: "📅", color: "bg-indigo-500 border-indigo-500 text-white" },
];

const NOTIFICATION_OPTIONS: { value: number | null; label: string }[] = [
  { value: null,  label: "No notification" },
  { value: 5,    label: "5 minutes before" },
  { value: 10,   label: "10 minutes before" },
  { value: 15,   label: "15 minutes before" },
  { value: 30,   label: "30 minutes before" },
  { value: 60,   label: "1 hour before" },
  { value: 120,  label: "2 hours before" },
  { value: 1440, label: "1 day before" },
];

const REPEAT_OPTIONS = [
  { value: "none",      label: "Does not repeat" },
  { value: "daily",     label: "Daily (30 days)" },
  { value: "weekly",    label: "Weekly (12 weeks)" },
  { value: "biweekly",  label: "Every 2 weeks (12×)" },
  { value: "monthly",   label: "Monthly (12 months)" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

const INTERNAL_DOMAINS = ["twilio.com", "segment.com", "sendgrid.com", "sendgrid.net"];
function isInternalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

function toDatetimeLocal(iso: string): string {
  // "YYYY-MM-DDTHH:MM:SS" → "YYYY-MM-DDTHH:MM"
  return iso.slice(0, 16);
}

function fromDatetimeLocal(val: string): string {
  // "YYYY-MM-DDTHH:MM" → "YYYY-MM-DDTHH:MM:00"
  return val.length === 16 ? `${val}:00` : val;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreateEventModal({ draft, onChange, onSave, onCancel, saving, zoomConnected, allAccountsRef }: Props) {
  const titleRef = useRef<HTMLInputElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ── Guest picker state ────────────────────────────────────────────────────
  const [guestQuery, setGuestQuery] = useState("");
  const [guestFocused, setGuestFocused] = useState(false);
  const [guestSuggestions, setGuestSuggestions] = useState<GuestEntry[]>([]);
  const [guestSuggestionsAll, setGuestSuggestionsAll] = useState<GuestEntry[]>([]);
  const [loadingGuests, setLoadingGuests] = useState(false);
  const [twilioTeamEntries, setTwilioTeamEntries] = useState<GuestEntry[]>([]);
  const [accountContactEntries, setAccountContactEntries] = useState<GuestEntry[]>([]);

  // ── Save-contact prompt state ─────────────────────────────────────────────
  const [saveContactPrompt, setSaveContactPrompt] = useState<{ email: string } | null>(null);
  const [saveContactName, setSaveContactName] = useState("");
  const [saveContactAccountId, setSaveContactAccountId] = useState<number | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  // ── Linked action items state ─────────────────────────────────────────────
  const [availableActionItems, setAvailableActionItems] = useState<AirtableActionItem[]>([]);
  const [availableArtifacts, setAvailableArtifacts] = useState<AccountArtifact[]>([]);
  const [showLinkItems, setShowLinkItems] = useState(false);
  const [showLinkArtifacts, setShowLinkArtifacts] = useState(false);

  // ── Invite prompt state ───────────────────────────────────────────────────
  const [showInvitePrompt, setShowInvitePrompt] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Omit<SavePayload, "sendInvites"> | null>(null);

  // Focus title on mount
  useEffect(() => { titleRef.current?.focus(); }, []);

  // Load all Twilio team members once on mount
  useEffect(() => {
    teamApi.listMembers({ page_size: "200" }).then((res) => {
      const members = res.data.results ?? [];
      setTwilioTeamEntries(
        members
          .filter((m) => m.email)
          .map((m) => ({ email: m.email, name: m.full_name || m.email, source: "twilio-team" as const }))
      );
    }).catch(() => {});
  }, []);

  // Load customer contacts when account changes (Twilio team loaded globally above)
  useEffect(() => {
    const acct = draft.selectedAccount;
    setAccountContactEntries([]);
    setAvailableActionItems([]);
    setAvailableArtifacts([]);
    if (!acct) return;

    setLoadingGuests(true);
    accountsApi.listContacts(acct.id)
      .then((res) => {
        const contacts = res?.data?.results ?? [];
        setAccountContactEntries(
          contacts
            .filter((c) => c.email)
            .map((c) => ({ email: c.email, name: c.name || c.email, source: "customer-contact" as const }))
        );
      })
      .catch(() => {})
      .finally(() => setLoadingGuests(false));

    // Load action items for linking
    airtableApi.listActionItems({ account_name: acct.name, page_size: "30" }).then((res) => {
      const items = Array.isArray(res.data) ? res.data : (res.data as { results?: AirtableActionItem[] }).results ?? [];
      setAvailableActionItems(items.filter((i) => i.status === "Open" || i.status === "In Progress").slice(0, 20));
    }).catch(() => {});

    // Load artifacts for linking
    accountsApi.listArtifacts(acct.id).then((res) => {
      setAvailableArtifacts(Array.isArray(res.data) ? res.data.slice(0, 20) : []);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.selectedAccount?.id]);

  // Merge Twilio team + account contacts → guestSuggestionsAll (dedup by email)
  useEffect(() => {
    const seen = new Set<string>();
    const merged: GuestEntry[] = [];
    for (const e of [...twilioTeamEntries, ...accountContactEntries]) {
      if (!seen.has(e.email)) {
        seen.add(e.email);
        merged.push(e);
      }
    }
    setGuestSuggestionsAll(merged);
  }, [twilioTeamEntries, accountContactEntries]);

  // Filter guest suggestions by query
  useEffect(() => {
    const q = guestQuery.trim().toLowerCase();
    if (!q) {
      setGuestSuggestions(guestSuggestionsAll.slice(0, 10));
    } else {
      setGuestSuggestions(
        guestSuggestionsAll.filter(
          (g) => g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q)
        ).slice(0, 10)
      );
    }
  }, [guestQuery, guestSuggestionsAll]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const addGuest = (g: GuestEntry) => {
    if (draft.guests.find((x) => x.email === g.email)) return;
    onChange((d) => ({ ...d, guests: [...d.guests, g] }));
    setGuestQuery("");
  };

  const removeGuest = (email: string) => {
    onChange((d) => ({ ...d, guests: d.guests.filter((g) => g.email !== email) }));
  };

  const addGuestByEmail = (raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!isValidEmail(email)) return;
    if (draft.guests.some((x) => x.email === email)) { setGuestQuery(""); return; }
    // Known contact — add with existing metadata
    const existing = guestSuggestionsAll.find((g) => g.email === email);
    if (existing) { addGuest(existing); return; }
    // Internal domain (Twilio/Segment/SendGrid) — add directly
    if (isInternalEmail(email)) {
      addGuest({ email, name: email, source: "twilio-team" });
      return;
    }
    // Unknown external email — show save-contact prompt
    setSaveContactName("");
    setSaveContactAccountId(null);
    setSaveContactPrompt({ email });
    setGuestQuery("");
  };

  const handleSaveContact = async () => {
    if (!saveContactPrompt || !saveContactAccountId) return;
    const { email } = saveContactPrompt;
    const name = saveContactName.trim() || email;
    setSavingContact(true);
    try {
      await accountsApi.createContact(saveContactAccountId, { name, email, role: "" });
      setAccountContactEntries((prev) => [...prev, { email, name, source: "customer-contact" }]);
    } catch {
      // contact save failed — still add as guest
    } finally {
      setSavingContact(false);
    }
    addGuest({ email, name, source: "customer-contact" });
    setSaveContactPrompt(null);
  };

  const toggleActionItem = (airtableId: string) => {
    onChange((d) => ({
      ...d,
      linkedActionItemIds: d.linkedActionItemIds.includes(airtableId)
        ? d.linkedActionItemIds.filter((id) => id !== airtableId)
        : [...d.linkedActionItemIds, airtableId],
    }));
  };

  const toggleArtifact = (id: number) => {
    onChange((d) => ({
      ...d,
      linkedArtifactIds: d.linkedArtifactIds.includes(id)
        ? d.linkedArtifactIds.filter((x) => x !== id)
        : [...d.linkedArtifactIds, id],
    }));
  };

  const handleConfirmSave = async () => {
    if (!draft.title.trim()) return;

    // Assemble full description
    const parts: string[] = [];
    if (draft.description.trim()) parts.push(draft.description.trim());
    const linkedItems = availableActionItems.filter((i) => draft.linkedActionItemIds.includes(i.airtable_id));
    const linkedArts = availableArtifacts.filter((a) => draft.linkedArtifactIds.includes(a.id));
    if (linkedItems.length) {
      parts.push("Linked Action Items:\n" + linkedItems.map((i) => `• ${i.task}`).join("\n"));
    }
    if (linkedArts.length) {
      parts.push("Linked Artifacts:\n" + linkedArts.map((a) => `• ${a.name}`).join("\n"));
    }
    const assembledDescription = parts.join("\n\n");

    // Attendees
    const attendees = draft.guests.map((g) => ({
      email: g.email,
      displayName: g.name,
      responseStatus: "needsAction" as const,
    }));

    // Meet link
    const meetLink =
      draft.videoConference === "meet"
        ? "https://meet.google.com/new"
        : draft.videoConference === "zoom"
        ? draft.videoConferenceUrl
        : "";

    // Effective category: auto-task if no guests + no video conference
    const effectiveCategory: string =
      draft.category === "meeting" && attendees.length === 0 && draft.videoConference === "none"
        ? "task"
        : draft.category;

    const payload = { draft, assembledDescription, attendees, meetLink, effectiveCategory };

    if (draft.guests.length > 0) {
      setPendingPayload(payload);
      setShowInvitePrompt(true);
      return;
    }

    await onSave({ ...payload, sendInvites: false });
  };

  const handleInviteResponse = async (sendInvites: boolean) => {
    if (!pendingPayload) return;
    setShowInvitePrompt(false);
    const payload = pendingPayload;
    setPendingPayload(null);
    await onSave({ ...payload, sendInvites });
  };

  const isActionItem = draft.type === "action-item";
  const canSave = draft.title.trim().length > 0 && !saving;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">New event</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22z" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 pb-2">
          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            placeholder="Add title"
            value={draft.title}
            onChange={(e) => onChange((d) => ({ ...d, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter" && canSave) { e.preventDefault(); void handleConfirmSave(); }
            }}
            className="w-full text-xl font-medium border-0 border-b-2 border-gray-200 focus:border-gray-200 focus:outline-none px-0 py-2 mb-4 transition-colors placeholder:text-gray-300"
          />

          {/* Type row: calendar event categories + Action Item tab */}
          <div className="mb-4">
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {CATEGORY_META.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange((d) => ({ ...d, type: "meeting", category: c.id }))}
                  className={[
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    !isActionItem && draft.category === c.id
                      ? c.color
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300",
                  ].join(" ")}
                >
                  {c.icon} {c.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChange((d) => ({ ...d, type: "action-item" }))}
                className={[
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  isActionItem
                    ? "bg-violet-600 border-violet-600 text-white"
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300",
                ].join(" ")}
              >
                ✅ Action Item
              </button>
            </div>
            {!isActionItem && draft.category === "meeting" && (
              <p className="text-[10px] text-gray-400 leading-none">
                No guests + no video link → will be saved as a Task
              </p>
            )}
          </div>

          <div className="border-t border-gray-100 my-3" />

          {/* Date / time */}
          <div className="mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="datetime-local"
                value={toDatetimeLocal(draft.start)}
                onChange={(e) =>
                  onChange((d) => ({ ...d, start: fromDatetimeLocal(e.target.value) }))
                }
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <span className="text-gray-400 text-sm">–</span>
              <input
                type="datetime-local"
                value={toDatetimeLocal(draft.end)}
                onChange={(e) =>
                  onChange((d) => ({ ...d, end: fromDatetimeLocal(e.target.value) }))
                }
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer ml-auto">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(e) => onChange((d) => ({ ...d, allDay: e.target.checked }))}
                  className="rounded border-gray-300 text-indigo-500"
                />
                All day
              </label>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{timezone}</p>
          </div>

          <div className="border-t border-gray-100 my-3" />

          {/* Account picker */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">📋 Link to account</label>
            <div className="relative">
              {draft.selectedAccount ? (
                <div className="flex items-center gap-2 border border-indigo-300 bg-indigo-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-indigo-800 flex-1 truncate">{draft.selectedAccount.name}</span>
                  <button
                    type="button"
                    onClick={() => onChange((d) => ({ ...d, selectedAccount: null, accountQuery: "", accountResults: [] }))}
                    className="text-indigo-400 hover:text-indigo-700 shrink-0"
                    aria-label="Remove account"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22z" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search accounts…"
                    value={draft.accountQuery}
                    onFocus={() => {
                      const q = draft.accountQuery.trim();
                      const results = q
                        ? allAccountsRef.current.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
                        : allAccountsRef.current.slice(0, 8);
                      onChange((d) => ({ ...d, accountResults: results }));
                    }}
                    onBlur={() => setTimeout(() => onChange((d) => ({ ...d, accountResults: [] })), 150)}
                    onChange={(e) => {
                      const q = e.target.value;
                      const results = q.trim()
                        ? allAccountsRef.current.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
                        : allAccountsRef.current.slice(0, 8);
                      onChange((d) => ({ ...d, accountQuery: q, accountResults: results }));
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {draft.accountResults.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-40">
                      {draft.accountResults.map((a) => (
                        <li key={a.name}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors truncate"
                            onClick={() => onChange((d) => ({ ...d, selectedAccount: a, accountQuery: "", accountResults: [] }))}
                          >
                            {a.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Guests (hidden for action-item type) */}
          {!isActionItem && (
            <>
              <div className="border-t border-gray-100 my-3" />
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">👥 Guests</label>

                {/* Selected guests */}
                {draft.guests.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {draft.guests.map((g) => (
                      <span
                        key={g.email}
                        className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2.5 py-0.5 text-xs text-gray-700"
                      >
                        <span className="w-4 h-4 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-[9px] font-bold shrink-0">
                          {g.name[0].toUpperCase()}
                        </span>
                        <span className="truncate max-w-[120px]">{g.name}</span>
                        <button
                          type="button"
                          onClick={() => removeGuest(g.email)}
                          className="text-gray-400 hover:text-gray-600 ml-0.5"
                          aria-label={`Remove ${g.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Guest search */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name or paste an email…"
                    value={guestQuery}
                    onChange={(e) => setGuestQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addGuestByEmail(guestQuery);
                      }
                    }}
                    onBlur={() => setTimeout(() => { setGuestSuggestions([]); setGuestFocused(false); }, 200)}
                    onFocus={() => {
                      setGuestFocused(true);
                      if (guestSuggestionsAll.length > 0) {
                        setGuestSuggestions(guestSuggestionsAll.slice(0, 10));
                      }
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {loadingGuests && (
                    <span className="absolute right-3 top-2.5 text-xs text-gray-400">Loading…</span>
                  )}
                  {(() => {
                    if (!guestFocused) return null;
                    const trimmedQuery = guestQuery.trim();
                    const showAddRow =
                      isValidEmail(trimmedQuery) &&
                      !draft.guests.some((x) => x.email === trimmedQuery.toLowerCase());
                    if (!guestSuggestions.length && !showAddRow) return null;
                    return (
                      <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-48">
                        {/* "Add email" row — shown when query looks like a valid new email */}
                        {showAddRow && (
                          <li>
                            <button
                              type="button"
                              onMouseDown={() => addGuestByEmail(trimmedQuery)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2"
                            >
                              <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-base font-light shrink-0">+</span>
                              <span className="flex-1 min-w-0">
                                <span className="block truncate font-medium text-indigo-700">Add &ldquo;{trimmedQuery}&rdquo;</span>
                                <span className="block text-gray-400 text-xs">Add as guest</span>
                              </span>
                            </button>
                          </li>
                        )}
                        {/* Grouped suggestions */}
                        {(["twilio-team", "customer-contact"] as const).map((src) => {
                          const group = guestSuggestions.filter((g) => g.source === src);
                          if (!group.length) return null;
                          return (
                            <li key={src}>
                              <div className="px-3 py-1 text-[10px] text-gray-400 font-semibold uppercase tracking-wide bg-gray-50 sticky top-0">
                                {src === "twilio-team" ? "Twilio Team" : "Customer Contacts"}
                              </div>
                              {group.map((g) => (
                                <button
                                  key={g.email}
                                  type="button"
                                  onMouseDown={() => addGuest(g)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2"
                                >
                                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                                    {g.name[0].toUpperCase()}
                                  </span>
                                  <span className="flex-1 min-w-0">
                                    <span className="block truncate font-medium">{g.name}</span>
                                    <span className="block truncate text-gray-400 text-xs">{g.email}</span>
                                  </span>
                                  {draft.guests.find((x) => x.email === g.email) && (
                                    <svg viewBox="0 0 16 16" fill="#6366f1" className="w-3.5 h-3.5 shrink-0">
                                      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                                    </svg>
                                  )}
                                </button>
                              ))}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            </>
          )}

          <div className="border-t border-gray-100 my-3" />

          {/* Description + linked items */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">📝 Description</label>
            <textarea
              rows={3}
              placeholder="Add description…"
              value={draft.description}
              onChange={(e) => onChange((d) => ({ ...d, description: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />

            {/* Action items linker */}
            {availableActionItems.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkItems((v) => !v)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium"
                >
                  <span>{showLinkItems ? "▾" : "▸"}</span>
                  Link action items
                  {draft.linkedActionItemIds.length > 0 && (
                    <span className="ml-1 bg-indigo-100 text-indigo-700 rounded-full px-1.5">{draft.linkedActionItemIds.length}</span>
                  )}
                </button>
                {showLinkItems && (
                  <ul className="mt-1.5 max-h-32 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                    {availableActionItems.map((item) => (
                      <li key={item.airtable_id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.linkedActionItemIds.includes(item.airtable_id)}
                            onChange={() => toggleActionItem(item.airtable_id)}
                            className="rounded border-gray-300 text-indigo-500"
                          />
                          <span className="text-xs text-gray-700 truncate flex-1">{item.task}</span>
                          <span className={[
                            "text-[10px] px-1.5 rounded-full shrink-0",
                            item.status === "In Progress" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500",
                          ].join(" ")}>{item.status}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Artifacts linker */}
            {availableArtifacts.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkArtifacts((v) => !v)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium"
                >
                  <span>{showLinkArtifacts ? "▾" : "▸"}</span>
                  Link artifacts
                  {draft.linkedArtifactIds.length > 0 && (
                    <span className="ml-1 bg-indigo-100 text-indigo-700 rounded-full px-1.5">{draft.linkedArtifactIds.length}</span>
                  )}
                </button>
                {showLinkArtifacts && (
                  <ul className="mt-1.5 max-h-32 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                    {availableArtifacts.map((art) => (
                      <li key={art.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.linkedArtifactIds.includes(art.id)}
                            onChange={() => toggleArtifact(art.id)}
                            className="rounded border-gray-300 text-indigo-500"
                          />
                          <span className="text-xs text-gray-700 truncate flex-1">{art.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Video conferencing (hidden for action-item) */}
          {!isActionItem && (
            <>
              <div className="border-t border-gray-100 my-3" />
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-2">🎥 Video conferencing</label>
                <div className="flex gap-3 flex-wrap">
                  {(["none", "meet", "zoom"] as const).map((v) => (
                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="videoConference"
                        value={v}
                        checked={draft.videoConference === v}
                        onChange={() => onChange((d) => ({
                          ...d,
                          videoConference: v,
                          videoConferenceUrl: v === "meet" ? "https://meet.google.com/new" : v === "none" ? "" : d.videoConferenceUrl,
                        }))}
                        className="text-indigo-500"
                      />
                      <span className="text-gray-700">
                        {v === "none" ? "None" : v === "meet" ? "Google Meet" : "Zoom"}
                      </span>
                    </label>
                  ))}
                </div>
                {draft.videoConference === "meet" && (
                  <p className="mt-1.5 text-xs text-gray-400">
                    A Meet link will be generated when synced to Google Calendar.
                  </p>
                )}
                {draft.videoConference === "zoom" && (
                  <div className="mt-2 space-y-1.5">
                    <input
                      type="url"
                      placeholder="Paste your Zoom link…"
                      value={draft.videoConferenceUrl}
                      onChange={(e) => onChange((d) => ({ ...d, videoConferenceUrl: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    {zoomConnected ? (
                      <p className="text-[10px] text-gray-400">
                        Zoom is connected. Auto-generate links will be available in a future update.
                      </p>
                    ) : (
                      <p className="text-[10px] text-gray-400">
                        Paste a Zoom link above, or{" "}
                        <a
                          href="/settings"
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-500 hover:underline"
                        >
                          connect Zoom in Settings
                        </a>{" "}
                        to auto-generate links.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="border-t border-gray-100 my-3" />

          {/* Notification */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">🔔 Notification</label>
            <select
              value={draft.notificationMinutes === null ? "null" : String(draft.notificationMinutes)}
              onChange={(e) => {
                const raw = e.target.value;
                onChange((d) => ({ ...d, notificationMinutes: raw === "null" ? null : Number(raw) }));
              }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {NOTIFICATION_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value === null ? "null" : String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Repeat (hidden for action-item) */}
          {!isActionItem && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">🔁 Repeat</label>
              <select
                value={draft.repeatFrequency}
                onChange={(e) =>
                  onChange((d) => ({ ...d, repeatFrequency: e.target.value as NewEventDraft["repeatFrequency"] }))
                }
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {REPEAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {draft.repeatFrequency !== "none" && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Recurring events are created as separate calendar entries.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleConfirmSave()}
            className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Create"}
          </button>
        </div>

        {/* Save-contact prompt — shown when an unknown external email is entered */}
        {saveContactPrompt && (
          <div className="absolute inset-0 bg-white rounded-2xl z-20 flex flex-col px-8 py-8 gap-4 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-900">Save new contact?</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              <span className="font-medium text-gray-800">{saveContactPrompt.email}</span> isn&apos;t linked to any account yet. Would you like to save them as a customer contact?
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={saveContactName}
                  onChange={(e) => setSaveContactName(e.target.value)}
                  placeholder="Contact name"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Link to account</label>
                <select
                  value={saveContactAccountId ?? ""}
                  onChange={(e) => setSaveContactAccountId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                >
                  <option value="">Select an account…</option>
                  {allAccountsRef.current.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                disabled={savingContact || !saveContactAccountId}
                onClick={() => void handleSaveContact()}
                className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {savingContact ? "Saving…" : "Save and add as guest"}
              </button>
              <button
                type="button"
                disabled={savingContact}
                onClick={() => {
                  const email = saveContactPrompt.email;
                  const name = saveContactName.trim() || email;
                  addGuest({ email, name, source: "manual" });
                  setSaveContactPrompt(null);
                }}
                className="w-full py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Add without saving
              </button>
              <button
                type="button"
                onClick={() => setSaveContactPrompt(null)}
                className="w-full py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Send-invitations prompt — overlays the modal when guests are present */}
        {showInvitePrompt && (
          <div className="absolute inset-0 bg-white rounded-2xl flex flex-col items-center justify-center px-8 gap-6 z-10">
            <p className="text-sm text-gray-800 text-center leading-relaxed">
              Would you like to send invitation emails to guests?
            </p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button
                type="button"
                onClick={() => setShowInvitePrompt(false)}
                className="w-full py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Back to editing
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleInviteResponse(false)}
                className="w-full py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Don&apos;t send
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleInviteResponse(true)}
                className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {saving ? "Saving…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
