import { describe, it, expect } from "vitest";
import { allEmails, preferredEmail, parseEmailList } from "../teamEmails";
import { matchAttendee } from "../attendeeMatch";

describe("teamEmails", () => {
  it("prefers the twilio.com address even when it is an additional one", () => {
    expect(preferredEmail({ email: "me@segment.com", additional_emails: ["x@sendgrid.com", "me@twilio.com"] })).toBe("me@twilio.com");
  });
  it("keeps the primary when no twilio address exists", () => {
    expect(preferredEmail({ email: "me@segment.com", additional_emails: ["x@sendgrid.com"] })).toBe("me@segment.com");
  });
  it("falls back to the first additional when the primary is blank, and to '' when none", () => {
    expect(preferredEmail({ email: "", additional_emails: ["x@sendgrid.com"] })).toBe("x@sendgrid.com");
    expect(preferredEmail({ email: "" })).toBe("");
  });
  it("does not match a lookalike domain", () => {
    expect(preferredEmail({ email: "a@nottwilio.com", additional_emails: ["a@twilio.com.evil.io"] })).toBe("a@nottwilio.com");
  });
  it("lists addresses once, primary first", () => {
    expect(allEmails({ email: "A@x.com", additional_emails: ["a@x.com", "b@y.com"] })).toEqual(["A@x.com", "b@y.com"]);
  });
  it("parses a pasted list", () => {
    expect(parseEmailList("a@x.com, b@y.com;  c@z.com")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });
  it("recognises a guest invited under a team member's additional address", () => {
    const m = matchAttendee(
      { email: "me@segment.com", responseStatus: "accepted" }, [],
      [{ id: 1, full_name: "Me", title: "", email: "me@twilio.com", additional_emails: ["me@segment.com"], avatar_url: "", slack_handle: "" }],
    );
    expect(m.state).toBe("known-team");
  });
});
