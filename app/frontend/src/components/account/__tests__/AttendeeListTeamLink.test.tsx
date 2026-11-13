import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAccount } from "../../../test/handlers/accounts";
import { mockTeamMembers } from "../../../test/handlers/team";
import { AttendeeList, ATTENDEE_RESPONSE_COLOR } from "../AttendeeList";
import type { Account } from "../../../types";

const tina = { ...mockTeamMembers[0], id: 5, full_name: "Tina Twilio", email: "tina@twilio.com", additional_emails: [] as string[] };
const account = { ...mockAccount, id: 1, team_members: [] } as Account;

function setup(guest = "tina@segment.com") {
  const calls: { addEmail: unknown[]; addMember: unknown[] } = { addEmail: [], addMember: [] };
  server.use(
    http.post("/api/v1/team/members/:id/add-email/", async ({ request }) => {
      calls.addEmail.push(await request.json());
      return HttpResponse.json({ ...tina, additional_emails: [guest] });
    }),
    http.post("/api/v1/accounts/accounts/:id/team-members/add/", async ({ request }) => {
      calls.addMember.push(await request.json());
      return HttpResponse.json({
        ...account,
        team_members: [{ id: 5, full_name: "Tina Twilio", title: "", email: "tina@twilio.com", additional_emails: [guest], avatar_url: "", slack_handle: "" }],
      });
    }),
  );
  render(
    <AttendeeList
      attendees={[{ email: guest, responseStatus: "accepted" }]}
      responseColor={ATTENDEE_RESPONSE_COLOR}
      account={account}
      teamMembers={[tina]}
      contacts={[]}
    />,
  );
  return calls;
}

describe("AttendeeList — linking a guest to a Twilio team member", () => {
  it("saves the guest's address on the member, adds them to the account, and shows a check", async () => {
    const calls = setup();
    await userEvent.click(screen.getByTitle("Add to team or contacts"));
    await userEvent.click(screen.getByText("Add to Twilio Team"));
    await userEvent.click(await screen.findByText("Tina Twilio"));

    await waitFor(() => expect(calls.addMember).toEqual([{ member_id: 5 }]));
    expect(calls.addEmail).toEqual([{ email: "tina@segment.com" }]);
    // The + becomes a check without a reload.
    expect(await screen.findByRole("img", { name: "Already on the team" })).toBeInTheDocument();
    expect(screen.queryByTitle("Add to team or contacts")).toBeNull();
  });

  it("does not re-save an address the member already has", async () => {
    const calls = setup("tina@twilio.com");
    await userEvent.click(screen.getByTitle("Add to team or contacts"));
    await userEvent.click(screen.getByText("Add to Twilio Team"));
    await userEvent.click(await screen.findByText("Tina Twilio"));
    await waitFor(() => expect(calls.addMember).toHaveLength(1));
    expect(calls.addEmail).toEqual([]);
  });

  it("keeps the + and adds nothing to the account when the address is refused", async () => {
    const calls = setup();
    server.use(
      http.post("/api/v1/team/members/:id/add-email/", () =>
        HttpResponse.json({ detail: "no" }, { status: 403 }),
      ),
    );
    await userEvent.click(screen.getByTitle("Add to team or contacts"));
    await userEvent.click(screen.getByText("Add to Twilio Team"));
    await userEvent.click(await screen.findByText("Tina Twilio"));
    await waitFor(() => expect(screen.getByTitle("Add to team or contacts")).toBeInTheDocument());
    expect(calls.addMember).toEqual([]);
  });
});

describe("AttendeeList — name instead of address for known guests", () => {
  const known = { ...account, team_members: [{ id: 5, full_name: "Tina Twilio", title: "", email: "tina@twilio.com", additional_emails: [], avatar_url: "", slack_handle: "" }] } as Account;
  const renderList = (email: string, contacts = [] as never[], displayName?: string) =>
    render(<AttendeeList attendees={[{ email, displayName, responseStatus: "accepted" }]} responseColor={ATTENDEE_RESPONSE_COLOR}
      account={known} teamMembers={[tina]} contacts={contacts} />);

  it("shows the full name with the address only as a tooltip", () => {
    renderList("tina@twilio.com");
    const name = screen.getByText("Tina Twilio");
    expect(name.closest("[title]")).toHaveAttribute("title", "tina@twilio.com");
    expect(screen.queryByText("tina@twilio.com")).toBeNull();
  });

  it("still shows the address for a guest without a check", () => {
    renderList("stranger@acme.com");
    expect(screen.getByText("stranger@acme.com")).toBeInTheDocument();
  });

  it("keeps the address when the known person has only one name", () => {
    const one = { ...known, team_members: [{ ...known.team_members[0], full_name: "Tina" }] } as Account;
    render(<AttendeeList attendees={[{ email: "tina@twilio.com", responseStatus: "accepted" }]} responseColor={ATTENDEE_RESPONSE_COLOR}
      account={one} teamMembers={[tina]} contacts={[]} />);
    expect(screen.getByText("tina@twilio.com")).toBeInTheDocument();
  });
});
