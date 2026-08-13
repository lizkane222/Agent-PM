import { useState, useRef, useEffect } from "react";
import { accountsApi } from "../../lib/api";
import type { Attendee, Account, TeamMember, CustomerContact } from "../../types";

function CustomerContactQuickForm({
  defaultName, defaultEmail, saving, onSave, onBack,
}: {
  defaultName: string; defaultEmail: string; saving: boolean;
  onSave: (name: string, email: string, role: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [role, setRole] = useState("");
  return (
    <div className="p-3 flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-[var(--twilio-navy)]">Add as customer contact</p>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *"
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none" />
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role / title"
        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none" />
      <div className="flex items-center justify-between pt-0.5">
        <button onClick={onBack} className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors">← Back</button>
        <button
          disabled={saving || !name.trim()}
          onClick={() => onSave(name.trim(), email.trim(), role.trim())}
          className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >{saving ? "Adding…" : "Add"}</button>
      </div>
    </div>
  );
}

export function AttendeeList({
  attendees,
  responseColor,
  account,
  teamMembers,
  contacts,
  onContactsChange,
}: {
  attendees: Attendee[];
  responseColor: Record<string, string>;
  account?: Account | null;
  teamMembers: TeamMember[];
  contacts: CustomerContact[];
  onAccountUpdated?: (a: Account) => void;
  onContactsChange?: (c: CustomerContact[]) => void;
}) {
  const [popover, setPopover] = useState<{ index: number; mode: "pick" | "twilio-search" | "customer-form" } | null>(null);
  const [search, setSearch] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
        setSearch("");
      }
    }
    if (popover) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [popover]);

  const currentAttendee = popover != null ? attendees[popover.index] : null;

  async function handleAddToTwilio(memberId: number) {
    if (!account || addingMember) return;
    setAddingMember(true);
    try {
      await accountsApi.addTeamMember(account.id, memberId);
    } finally {
      setAddingMember(false);
      setPopover(null);
      setSearch("");
    }
  }

  async function handleAddAsContact(name: string, email: string, role: string) {
    if (!account || addingContact) return;
    setAddingContact(true);
    try {
      const { data } = await accountsApi.createContact(account.id, { name, email, role });
      onContactsChange?.([...(contacts ?? []), data]);
    } finally {
      setAddingContact(false);
      setPopover(null);
      setSearch("");
    }
  }

  const filteredMembers = teamMembers.filter((m) =>
    !search.trim() ||
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <p className="font-medium mb-1.5">Attendees ({attendees.length})</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {attendees.map((a, i) => (
          <div key={i} className="group relative" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, background: responseColor[a.responseStatus] ?? "#888", display: "inline-block" }} title={a.responseStatus} />
            <span style={{ fontSize: "0.75rem", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.displayName
                ? <><span style={{ fontWeight: 500 }}>{a.displayName}</span> <span className="opacity-50">{a.email}</span></>
                : a.email}
            </span>
            {account && (
              <button
                onClick={() => { setPopover({ index: i, mode: "pick" }); setSearch(""); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-indigo-600 hover:bg-indigo-50"
                style={{ fontSize: "14px", lineHeight: 1 }}
                title="Add to team or contacts"
              >+</button>
            )}

            {/* Popover */}
            {popover?.index === i && (
              <div ref={popoverRef} className="absolute right-0 top-6 z-50 rounded-xl shadow-xl border border-gray-100 bg-white overflow-hidden" style={{ width: "220px" }}>
                {popover.mode === "pick" && (
                  <div className="p-1.5 flex flex-col gap-0.5">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--twilio-gray-60)]">
                      {a.displayName || a.email}
                    </p>
                    <button
                      onClick={() => setPopover({ index: i, mode: "twilio-search" })}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--twilio-navy)] hover:bg-indigo-50 rounded-lg transition-colors text-left"
                    >
                      <span className="text-indigo-500">👥</span> Add to Twilio Team
                    </button>
                    <button
                      onClick={() => setPopover({ index: i, mode: "customer-form" })}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--twilio-navy)] hover:bg-indigo-50 rounded-lg transition-colors text-left"
                    >
                      <span className="text-indigo-500">🏢</span> Add as Customer Contact
                    </button>
                  </div>
                )}

                {popover.mode === "twilio-search" && (
                  <div className="p-3 flex flex-col gap-2">
                    <p className="text-[11px] font-semibold text-[var(--twilio-navy)]">Link to Twilio Team member</p>
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-[var(--twilio-navy)] focus:border-indigo-400 focus:outline-none"
                    />
                    <div className="max-h-32 overflow-y-auto flex flex-col gap-0.5">
                      {filteredMembers.length === 0
                        ? <p className="text-[11px] text-gray-400 italic px-1">No matches</p>
                        : filteredMembers.map((m) => (
                          <button
                            key={m.id}
                            disabled={addingMember}
                            onClick={() => void handleAddToTwilio(m.id)}
                            className="flex flex-col items-start px-2 py-1.5 text-left rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-40"
                          >
                            <span className="text-xs font-medium text-[var(--twilio-navy)]">{m.full_name}</span>
                            <span className="text-[10px] text-[var(--twilio-gray-60)]">{m.email}</span>
                          </button>
                        ))
                      }
                    </div>
                    <button onClick={() => setPopover({ index: i, mode: "pick" })} className="text-[11px] text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] transition-colors text-left">← Back</button>
                  </div>
                )}

                {popover.mode === "customer-form" && currentAttendee && (
                  <CustomerContactQuickForm
                    defaultName={currentAttendee.displayName ?? ""}
                    defaultEmail={currentAttendee.email}
                    saving={addingContact}
                    onSave={(name, email, role) => void handleAddAsContact(name, email, role)}
                    onBack={() => setPopover({ index: i, mode: "pick" })}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
