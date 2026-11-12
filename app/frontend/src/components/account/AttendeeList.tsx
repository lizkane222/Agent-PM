import { useState, useRef, useEffect } from "react";
import { accountsApi, teamApi } from "../../lib/api";
import { addLog } from "../../lib/appLog";
import { allEmails } from "../../lib/teamEmails";
import { useAppError } from "../../context/AppErrorContext";
import { permissionMessage } from "../../lib/permissions";
import { AttendeeActionButton } from "./AttendeeActionButton";
import { guestName, knownFullName, matchAttendee } from "../../lib/attendeeMatch";
import { fullNameFromEmail } from "../../lib/nameFromEmail";
import type { Attendee, Account, AccountTeamMember, TeamMember, CustomerContact } from "../../types";

export const ATTENDEE_RESPONSE_COLOR: Record<string, string> = {
  accepted: "#15803d", declined: "#dc2626", tentative: "#a16207", needsAction: "#888",
};

function CustomerContactQuickForm({
  defaultName, defaultEmail, saving, onSave, onBack, nameGuessed = false,
}: {
  defaultName: string; defaultEmail: string; saving: boolean; nameGuessed?: boolean;
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
      {nameGuessed && name === defaultName && <p className="text-[10px] text-amber-600 -mt-1">Name guessed from the email address. Please check it.</p>}
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
  onAccountUpdated,
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
  const { reportError } = useAppError();
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
  // The account's team as last returned by the server, so a guest turns into a check mark at once
  // (the parent's copy of the account is not refreshed from here).
  const [teamOverride, setTeamOverride] = useState<AccountTeamMember[] | null>(null);
  useEffect(() => { setTeamOverride(null); }, [account]);
  const accountTeam = teamOverride ?? account?.team_members ?? [];

  async function handleAddToTwilio(memberId: number) {
    if (!account || addingMember) return;
    setAddingMember(true);
    try {
      // Record the address this guest was invited under on the team member (once), then make
      // sure they are on the account's team. Both are idempotent.
      const member = teamMembers.find((m) => m.id === memberId);
      const guestEmail = (currentAttendee?.email ?? "").trim();
      if (member && guestEmail && !allEmails(member).some((e) => e.toLowerCase() === guestEmail.toLowerCase())) {
        await teamApi.addMemberEmail(memberId, guestEmail);
      }
      const { data } = await accountsApi.addTeamMember(account.id, memberId);
      setTeamOverride(data.team_members ?? []);
      onAccountUpdated?.(data);
      addLog({
        category: "account",
        message: `Linked ${guestEmail || "a guest"} to Twilio team member "${member?.full_name ?? memberId}"`,
        resource: { type: "account", id: account.id },
      });
    } catch (err) {
      // Adding someone else to an account, or an address to someone else, is PM/Admin only.
      reportError(permissionMessage(err, "Could not add them to the account."), "AttendeeList");
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
            {(() => {
              // A guest with a check mark and a full name shows the name alone; the address is the tooltip.
              const known = account ? knownFullName(a, matchAttendee(a, contacts ?? [], accountTeam)) : "";
              return (
                <span title={known ? a.email : undefined} style={{ fontSize: "0.75rem", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {known
                    ? <span style={{ fontWeight: 500 }}>{known}</span>
                    : a.displayName
                      ? <><span style={{ fontWeight: 500 }}>{a.displayName}</span> <span className="opacity-50">{a.email}</span></>
                      : a.email}
                </span>
              );
            })()}
            {account && (
              <AttendeeActionButton
                attendee={a}
                account={account}
                contacts={contacts ?? []}
                accountTeamMembers={accountTeam}
                onContactsChange={onContactsChange}
                onAdd={() => { setPopover({ index: i, mode: "pick" }); setSearch(""); }}
              />
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
                    defaultName={guestName(currentAttendee) || fullNameFromEmail(currentAttendee.email).name}
                    nameGuessed={!guestName(currentAttendee) && !!fullNameFromEmail(currentAttendee.email).name}
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
