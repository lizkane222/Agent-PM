import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockContact } from "../../../test/handlers/accounts";
import { AttendeeActionButton } from "../AttendeeActionButton";
import type { Attendee, Account, CustomerContact, AccountTeamMember } from "../../../types";

const account = { id: 1 } as Account;
const att = (email: string, displayName?: string): Attendee => ({ email, displayName, responseStatus: "accepted" });
const team: AccountTeamMember[] = [
  { id: 5, full_name: "Tina Twilio", title: "", email: "tina@twilio.com", avatar_url: "", slack_handle: "" },
];

function Harness({ attendee, initial, onAdd = () => {} }: { attendee: Attendee; initial: CustomerContact[]; onAdd?: () => void }) {
  const [contacts, setContacts] = useState(initial);
  return (
    <AttendeeActionButton attendee={attendee} account={account} contacts={contacts}
      accountTeamMembers={team} onContactsChange={setContacts} onAdd={onAdd} />
  );
}

describe("AttendeeActionButton", () => {
  it("shows a checkmark when email and name already exist", () => {
    render(<Harness attendee={att("bob@acme.com", "Bob")} initial={[mockContact]} />);
    expect(screen.getByRole("img", { name: "Already a contact" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a checkmark for a Twilio team match", () => {
    render(<Harness attendee={att("tina@twilio.com", "Tina Twilio")} initial={[]} />);
    expect(screen.getByRole("img", { name: "Already on the team" })).toBeInTheDocument();
  });

  it("keeps + for an unknown guest and calls onAdd", async () => {
    const onAdd = vi.fn();
    render(<Harness attendee={att("new@acme.com", "New Person")} initial={[mockContact]} onAdd={onAdd} />);
    await userEvent.click(screen.getByTitle("Add to team or contacts"));
    expect(onAdd).toHaveBeenCalled();
  });

  it("patches only the missing email, then flips to a checkmark", async () => {
    let body: Record<string, unknown> | null = null;
    let stored: CustomerContact = { ...mockContact, name: "Jane Doe", email: "" };
    server.use(
      http.patch("/api/v1/accounts/contacts/:id/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        stored = { ...stored, ...body };
        return HttpResponse.json(stored);
      }),
      http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [stored], count: 1 })),
    );
    render(<Harness attendee={att("jane@acme.com", "Jane Doe")} initial={[stored]} />);
    const btn = screen.getByRole("button", { name: "Add email jane@acme.com to Jane Doe" });
    await userEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("img", { name: "Already a contact" })).toBeInTheDocument());
    expect(body).toEqual({ email: "jane@acme.com" });
  });

  it("patches only the name when the contact has an email but no name", async () => {
    let body: Record<string, unknown> | null = null;
    let stored: CustomerContact = { ...mockContact, name: "", email: "jane.doe@acme.com" };
    server.use(
      http.patch("/api/v1/accounts/contacts/:id/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        stored = { ...stored, ...body };
        return HttpResponse.json(stored);
      }),
      http.get("/api/v1/accounts/contacts/", () => HttpResponse.json({ results: [stored], count: 1 })),
    );
    render(<Harness attendee={att("jane.doe@acme.com")} initial={[stored]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add name Jane Doe \(inferred/ }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Already a contact" })).toBeInTheDocument());
    expect(body).toEqual({ name: "Jane Doe" });
  });

  it("keeps the update icon when the PATCH fails", async () => {
    server.use(http.patch("/api/v1/accounts/contacts/:id/", () => new HttpResponse(null, { status: 500 })));
    render(<Harness attendee={att("jane@acme.com", "Jane Doe")} initial={[{ ...mockContact, name: "Jane Doe", email: "" }]} />);
    await userEvent.click(screen.getByRole("button", { name: /Add email/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Add email/ })).not.toBeDisabled());
    expect(screen.queryByRole("img")).toBeNull();
  });
});
