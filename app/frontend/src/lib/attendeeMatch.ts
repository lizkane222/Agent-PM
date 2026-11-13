// Match a meeting guest against an account's customer contacts and Twilio team.
// Pure; the UI (components/account/AttendeeActionButton.tsx) decides what to render.
//
// Outcomes:
//   known-contact - already a customer contact (email and/or name match, nothing to add)
//   known-team    - already on the account's Twilio team (their record is not a customer
//                   contact and is not editable here, so we never offer an update)
//   update        - exactly one customer contact matches by one data point and the contact
//                   is MISSING the other one, which the guest supplies -> patch only that
//   new           - matches nobody -> "add new contact"
// An existing non-empty value is never overwritten. A name-only match on a contact that
// already has a different email is treated as the same person (avoids duplicates).

import type { Attendee, CustomerContact, AccountTeamMember } from "../types";
import { nameFromEmail } from "./nameFromEmail";
import { allEmails } from "./teamEmails";

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  // "Last, First" -> "First Last" (exactly one comma, both sides non-empty)
  const comma = s.split(",");
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) s = `${comma[1].trim()} ${comma[0].trim()}`;
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** The guest's usable display name ("" when absent or just their email). */
export function guestName(a: Attendee): string {
  const n = (a.displayName ?? "").trim();
  if (!n || n.includes("@")) return "";
  const comma = n.split(",");
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) return `${comma[1].trim()} ${comma[0].trim()}`;
  return n;
}

export interface ContactUpdate {
  contact: CustomerContact;
  field: "email" | "name";
  value: string;
  /** True when the value was inferred from the email rather than supplied by the guest. */
  inferred: boolean;
  tooltip: string;
}

export type AttendeeMatch =
  | { state: "known-contact"; contact: CustomerContact; label: string }
  | { state: "known-team"; member: AccountTeamMember; label: string }
  | { state: "update"; update: ContactUpdate }
  | { state: "new" };

export function matchAttendee(
  attendee: Attendee,
  contacts: CustomerContact[],
  teamMembers: AccountTeamMember[],
): AttendeeMatch {
  const email = normalizeEmail(attendee.email);
  const name = guestName(attendee);
  const nName = normalizeName(name);

  const byEmail = email ? contacts.find((c) => normalizeEmail(c.email) === email) : undefined;
  const byName = nName ? contacts.find((c) => normalizeName(c.name) === nName) : undefined;
  const contact = byEmail ?? byName;

  if (contact) {
    const hasEmail = !!normalizeEmail(contact.email);
    const hasName = !!normalizeName(contact.name);
    const known: AttendeeMatch = { state: "known-contact", contact, label: "Already a contact" };

    if (byEmail && !hasName) {
      // Matched by email; the contact has no name.
      if (nName) return updateOf(contact, "name", name, false, `Add name ${name} to ${contact.email}`);
      const inf = nameFromEmail(attendee.email);
      if (inf.confidence === "high") {
        const v = `${inf.first} ${inf.last}`;
        return updateOf(contact, "name", v, true, `Add name ${v} (inferred from ${contact.email}) to ${contact.email}`);
      }
      return known;
    }
    if (!byEmail && byName && !hasEmail && email) {
      // Matched by name; the contact has no email.
      return updateOf(contact, "email", attendee.email.trim(), false, `Add email ${attendee.email.trim()} to ${contact.name}`);
    }
    return known;
  }

  const member = teamMembers.find((m) => {
    if (email && allEmails(m).some((e) => normalizeEmail(e) === email)) return true;
    if (!nName || normalizeName(m.full_name) !== nName) return false;
    // Name-only match: ignore a customer who merely shares a colleague's name.
    const mEmail = normalizeEmail(m.email);
    if (!email || !mEmail) return true;
    return email.split("@")[1] === mEmail.split("@")[1];
  });
  if (member) return { state: "known-team", member, label: "Already on the team" };

  return { state: "new" };
}

/**
 * For a guest who already has a check mark: their full name (first and last), so the list can show
 * it instead of the address. "" when the guest is not known or no full name is on record.
 */
export function knownFullName(attendee: Attendee, match: AttendeeMatch): string {
  const raw =
    match.state === "known-contact" ? match.contact.name
    : match.state === "known-team" ? match.member.full_name
    : "";
  for (const candidate of [raw, guestName(attendee)]) {
    const n = normalizeDisplay(candidate);
    if (n.includes(" ")) return n;
  }
  return "";
}

function normalizeDisplay(name: string | null | undefined): string {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (!n || n.includes("@")) return "";
  const comma = n.split(",");
  return comma.length === 2 && comma[0].trim() && comma[1].trim() ? `${comma[1].trim()} ${comma[0].trim()}` : n;
}

function updateOf(contact: CustomerContact, field: "email" | "name", value: string, inferred: boolean, tooltip: string): AttendeeMatch {
  return { state: "update", update: { contact, field, value, inferred, tooltip } };
}
