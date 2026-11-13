import { useEffect, useState } from "react";
import { accountsApi } from "../../lib/api";
import { useTeam } from "../../hooks/useTeam";
import { AttendeeList, ATTENDEE_RESPONSE_COLOR } from "../account/AttendeeList";
import type { Attendee, Account, CustomerContact } from "../../types";

/**
 * A meeting's guests on the calendar page, with the same per-guest actions as the account
 * page's meeting panel (already a contact / update a contact / add as contact or team member).
 * Those actions need an account, so they appear once the meeting is linked to one; without it
 * the list still shows every guest's name and email.
 */
export function CalendarAttendees({ attendees, accountId }: { attendees: Attendee[]; accountId: number | null }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const { data: teamMembers } = useTeam();

  useEffect(() => {
    setAccount(null);
    setContacts([]);
    if (accountId == null) return;
    let cancelled = false;
    accountsApi.getAccount(accountId)
      .then(({ data }) => { if (!cancelled) setAccount(data); })
      .catch(() => { /* guests are still listed, just without the actions */ });
    accountsApi.listContacts(accountId)
      .then(({ data }) => { if (!cancelled) setContacts(Array.isArray(data) ? data : data.results); })
      .catch(() => { /* same */ });
    return () => { cancelled = true; };
  }, [accountId]);

  return (
    <AttendeeList
      attendees={attendees}
      responseColor={ATTENDEE_RESPONSE_COLOR}
      account={account}
      teamMembers={teamMembers ?? []}
      contacts={contacts}
      onAccountUpdated={setAccount}
      onContactsChange={setContacts}
    />
  );
}
