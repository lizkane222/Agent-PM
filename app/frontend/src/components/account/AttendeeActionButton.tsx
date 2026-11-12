import { useState } from "react";
import { accountsApi } from "../../lib/api";
import { addLog } from "../../lib/appLog";
import { useAppError } from "../../context/AppErrorContext";
import { permissionMessage } from "../../lib/permissions";
import { matchAttendee } from "../../lib/attendeeMatch";
import type { Attendee, Account, CustomerContact, AccountTeamMember } from "../../types";

/**
 * The per-guest icon in a meeting's attendee list:
 *  - green check  : already a customer contact / on the Twilio team
 *  - plus + arrow : update the existing contact with the ONE missing data point
 *  - "+"          : no match, add as a new contact / team member (caller opens its popover)
 */
export function AttendeeActionButton({
  attendee, account, contacts, accountTeamMembers, onContactsChange, onAdd,
}: {
  attendee: Attendee;
  account: Account;
  contacts: CustomerContact[];
  accountTeamMembers: AccountTeamMember[];
  onContactsChange?: (c: CustomerContact[]) => void;
  onAdd: () => void;
}) {
  const { reportError } = useAppError();
  const [saving, setSaving] = useState(false);
  const match = matchAttendee(attendee, contacts, accountTeamMembers);

  if (match.state === "known-contact" || match.state === "known-team") {
    return (
      <span role="img" aria-label={match.label} title={match.label}
        className="shrink-0 w-5 h-5 flex items-center justify-center text-green-600">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }

  if (match.state === "update") {
    const { update } = match;
    async function run() {
      if (saving) return;
      setSaving(true);
      try {
        // Only the missing data point is sent; an existing value is never overwritten.
        await accountsApi.updateContact(update.contact.id, { [update.field]: update.value });
        addLog({
          category: "account",
          message: `Updated customer contact "${update.contact.name || update.contact.email}": added ${update.field} ${update.value}`,
          resource: { type: "account", id: account.id },
        });
        const { data } = await accountsApi.listContacts(account.id);
        const list = Array.isArray(data) ? data : data.results;
        onContactsChange?.(list);
      } catch (err) {
        reportError(permissionMessage(err, "Could not update the contact."), "AttendeeList");
      } finally {
        setSaving(false);
      }
    }
    return (
      <button
        type="button"
        onClick={() => void run()}
        disabled={saving}
        aria-label={update.tooltip}
        title={update.tooltip}
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 11v8M5 15h8" />
          <path d="M17 10V3M14 6l3-3 3 3" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={onAdd}
      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-indigo-600 hover:bg-indigo-50"
      style={{ fontSize: "14px", lineHeight: 1 }}
      title="Add to team or contacts"
    >+</button>
  );
}
