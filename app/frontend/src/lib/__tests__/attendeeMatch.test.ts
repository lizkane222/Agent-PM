import { describe, it, expect } from "vitest";
import { matchAttendee, normalizeName, guestName } from "../attendeeMatch";
import { mockContact } from "../../test/handlers/accounts";
import type { Attendee, CustomerContact, AccountTeamMember } from "../../types";

const att = (email: string, displayName?: string): Attendee => ({ email, displayName, responseStatus: "accepted" });
const contact = (p: Partial<CustomerContact>): CustomerContact => ({ ...mockContact, ...p });
const member = (p: Partial<AccountTeamMember>): AccountTeamMember => ({
  id: 9, full_name: "Tina Twilio", title: "", email: "tina@twilio.com", avatar_url: "", slack_handle: "", ...p,
});

describe("normalizeName", () => {
  it("trims, collapses, strips punctuation and diacritics", () => {
    expect(normalizeName("  José   Núñez ")).toBe("jose nunez");
    expect(normalizeName("O'Brien, Pat")).toBe("pat obrien");
    expect(normalizeName("Mary-Ann  Smith.")).toBe("mary ann smith");
    expect(normalizeName(null)).toBe("");
  });
  it("guestName ignores email-as-name and flips Last, First", () => {
    expect(guestName(att("a@x.com", "a@x.com"))).toBe("");
    expect(guestName(att("a@x.com", "Doe, Jane"))).toBe("Jane Doe");
  });
});

describe("matchAttendee", () => {
  it("email and name both on one contact -> known", () => {
    const m = matchAttendee(att("JANE@acme.com", "jane doe"), [contact({ name: "Jane Doe", email: "jane@acme.com" })], []);
    expect(m.state).toBe("known-contact");
  });
  it("matches 'Last, First' guest names", () => {
    const m = matchAttendee(att("x@acme.com", "Doe, Jane"), [contact({ name: "Jane Doe", email: "x@acme.com" })], []);
    expect(m.state).toBe("known-contact");
  });
  it("name match, contact has no email -> update email only", () => {
    const m = matchAttendee(att("jane@acme.com", "Jane Doe"), [contact({ name: "Jane Doe", email: "" })], []);
    expect(m.state).toBe("update");
    if (m.state === "update") {
      expect(m.update.field).toBe("email");
      expect(m.update.value).toBe("jane@acme.com");
      expect(m.update.tooltip).toBe("Add email jane@acme.com to Jane Doe");
    }
  });
  it("email match, contact has no name, guest has one -> update name", () => {
    const m = matchAttendee(att("jane@acme.com", "Jane Doe"), [contact({ name: "", email: "jane@acme.com" })], []);
    expect(m.state === "update" && m.update.field === "name" && m.update.value === "Jane Doe" && !m.update.inferred).toBe(true);
  });
  it("email match, no name anywhere -> uses high-confidence inference only", () => {
    const hi = matchAttendee(att("jane.doe@acme.com"), [contact({ name: "", email: "jane.doe@acme.com" })], []);
    expect(hi.state === "update" && hi.update.value === "Jane Doe" && hi.update.inferred).toBe(true);
    if (hi.state === "update") expect(hi.update.tooltip).toContain("inferred");
    const lo = matchAttendee(att("jdoe@acme.com"), [contact({ name: "", email: "jdoe@acme.com" })], []);
    expect(lo.state).toBe("known-contact");
  });
  it("never overwrites: different existing email on a name match stays known", () => {
    const m = matchAttendee(att("new@acme.com", "Jane Doe"), [contact({ name: "Jane Doe", email: "old@acme.com" })], []);
    expect(m.state).toBe("known-contact");
  });
  it("team member by email or name -> known-team", () => {
    expect(matchAttendee(att("TINA@twilio.com"), [], [member({})]).state).toBe("known-team");
    expect(matchAttendee(att("tina@twilio.com", "Tina Twilio"), [], [member({})]).state).toBe("known-team");
  });
  it("a customer sharing a colleague's name on another domain is not the colleague", () => {
    expect(matchAttendee(att("tina@acme.com", "Tina Twilio"), [], [member({})]).state).toBe("new");
  });
  it("no match -> new", () => {
    expect(matchAttendee(att("z@z.com", "Zed"), [contact({})], [member({})]).state).toBe("new");
  });
});
