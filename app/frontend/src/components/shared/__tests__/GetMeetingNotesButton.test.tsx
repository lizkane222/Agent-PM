/**
 * The one behavioural difference that matters between the button's two hosts: the
 * account detail page scopes the scan to its own account, the profile and role pages
 * cover every account the user is on. Getting that backwards either hides imports the
 * user asked for or reports imports the page can't show.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/msw-server";
import { mockMeetingNotesReport } from "../../../test/handlers/integrations";
import { GetMeetingNotesButton } from "../GetMeetingNotesButton";

const SCAN_PATH = "/api/v1/integrations/gmail/meeting-notes/";

/** Capture the request body the button sends. */
function captureBody(report: object = mockMeetingNotesReport) {
  const seen: { body?: unknown } = {};
  server.use(
    http.post(SCAN_PATH, async ({ request }) => {
      seen.body = await request.json();
      return HttpResponse.json(report);
    })
  );
  return seen;
}

const click = () => userEvent.click(screen.getByRole("button", { name: /GET Meeting Notes/i }));

describe("GetMeetingNotesButton — scope", () => {
  it("sends this account's identity when scoped", async () => {
    const seen = captureBody();
    render(
      <GetMeetingNotesButton scope={{ account: "recACME001", accountName: "Acme Corp" }} />
    );

    await click();

    await waitFor(() => expect(seen.body).toBeDefined());
    expect(seen.body).toEqual({ account: "recACME001", account_name: "Acme Corp" });
  });

  it("falls back to the name alone for an account with no Airtable link", async () => {
    const seen = captureBody();
    render(<GetMeetingNotesButton scope={{ accountName: "Admin" }} />);

    await click();

    await waitFor(() => expect(seen.body).toBeDefined());
    expect(seen.body).toEqual({ account_name: "Admin" });
  });

  it("sends no filter at all when unscoped", async () => {
    const seen = captureBody();
    render(<GetMeetingNotesButton />);

    await click();

    await waitFor(() => expect(seen.body).toBeDefined());
    expect(seen.body).toEqual({});
  });

  it("names the account in the empty result when scoped", async () => {
    captureBody({ ...mockMeetingNotesReport, scanned_emails: 2, scanned_meetings: 1 });
    render(<GetMeetingNotesButton scope={{ accountName: "Acme Corp" }} />);

    await click();

    expect(await screen.findByText(/No new meeting notes found for Acme Corp/i)).toBeInTheDocument();
    expect(screen.getByText(/2 recap emails against 1 meeting/i)).toBeInTheDocument();
  });

  it("says 'across your accounts' in the empty result when unscoped", async () => {
    captureBody();
    render(<GetMeetingNotesButton />);

    await click();

    expect(
      await screen.findByText(/No new meeting notes found across your accounts/i)
    ).toBeInTheDocument();
  });

  it("names each meeting's account when unscoped, so a cross-account import is legible", async () => {
    captureBody({
      ...mockMeetingNotesReport,
      updated: [
        { meeting_id: 1, airtable_id: "recA", meeting_name: "Acme Sync", date: null, account_name: "Acme Corp", sources: ["gong"] },
        { meeting_id: 2, airtable_id: "recB", meeting_name: "Beta Kickoff", date: null, account_name: "Beta Corp", sources: ["zoom"] },
      ],
    });
    render(<GetMeetingNotesButton />);

    await click();

    await screen.findByText(/Added notes to 2 meetings/i);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows.some((r) => /Acme Sync.*gong.*Acme Corp/i.test(r))).toBe(true);
    expect(rows.some((r) => /Beta Kickoff.*zoom.*Beta Corp/i.test(r))).toBe(true);
  });

  it("omits the account on rows when scoped, since every row is that account", async () => {
    captureBody({
      ...mockMeetingNotesReport,
      updated: [{
        meeting_id: 1, airtable_id: "recA", meeting_name: "Acme Sync",
        date: null, account_name: "Acme Corp", sources: ["gong"],
      }],
    });
    render(<GetMeetingNotesButton scope={{ accountName: "Acme Corp" }} />);

    await click();

    await screen.findByText(/Added notes to 1 meeting/i);
    const row = screen.getByRole("listitem").textContent ?? "";
    expect(row).toMatch(/Acme Sync/);
    expect(row).not.toMatch(/Acme Corp/);
  });

  it("mentions the scope in the button tooltip", () => {
    const { unmount } = render(<GetMeetingNotesButton scope={{ accountName: "Acme Corp" }} />);
    expect(screen.getByRole("button")).toHaveAttribute("title", expect.stringContaining("Acme Corp"));
    unmount();

    render(<GetMeetingNotesButton />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "title", expect.stringContaining("all of your accounts")
    );
  });
});

describe("GetMeetingNotesButton — states", () => {
  it("calls onImported after a successful scan", async () => {
    captureBody();
    const onImported = vi.fn();
    render(<GetMeetingNotesButton onImported={onImported} />);

    await click();

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it("does not call onImported when the scan fails", async () => {
    server.use(http.post(SCAN_PATH, () => new HttpResponse(null, { status: 500 })));
    const onImported = vi.fn();
    render(<GetMeetingNotesButton onImported={onImported} />);

    await click();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("surfaces the backend's message when Gmail is not connected", async () => {
    server.use(
      http.post(SCAN_PATH, () =>
        HttpResponse.json({ detail: "Gmail not connected. Connect Gmail from Settings." }, { status: 400 })
      )
    );
    render(<GetMeetingNotesButton />);

    await click();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Gmail not connected/i);
  });

  it("explains a link-only email instead of looking like a failure", async () => {
    // The user can see these emails in their inbox, so silence reads as a bug.
    captureBody({
      ...mockMeetingNotesReport,
      scanned_emails: 5,
      scanned_meetings: 3,
      no_summary_in_email: 2,
      recordings_linked: 2,
      skipped: [
        { meeting_id: 1, meeting_name: "Liz/Sean weekly", reason: "email_has_no_summary", sources_without_summary: ["zoom"] },
        { meeting_id: 2, meeting_name: "SA Tech Sync", reason: "email_has_no_summary", sources_without_summary: ["zoom"] },
      ],
    });
    render(<GetMeetingNotesButton />);

    await click();

    expect(
      await screen.findByText(/2 meetings had emails that link to a summary instead of containing it/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Saved 2 recording links/i)).toBeInTheDocument();
  });

  it("uses singular wording for a single link-only email", async () => {
    captureBody({
      ...mockMeetingNotesReport,
      no_summary_in_email: 1,
      recordings_linked: 1,
      skipped: [{ meeting_id: 1, meeting_name: "Liz/Sean weekly", reason: "email_has_no_summary" }],
    });
    render(<GetMeetingNotesButton />);

    await click();

    expect(
      await screen.findByText(/1 meeting had an email that links to a summary/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Saved 1 recording link\./i)).toBeInTheDocument();
  });

  it("stays quiet about link-only emails when there were none", async () => {
    captureBody();
    render(<GetMeetingNotesButton />);

    await click();

    await screen.findByRole("status");
    expect(screen.queryByText(/links to a summary/i)).not.toBeInTheDocument();
  });

  it("reports the per-run summary limit", async () => {
    captureBody({ ...mockMeetingNotesReport, summaries_truncated: true, max_summaries: 25 });
    render(<GetMeetingNotesButton />);

    await click();

    expect(await screen.findByText(/Stopped at the per-run limit of 25/i)).toBeInTheDocument();
  });
});
