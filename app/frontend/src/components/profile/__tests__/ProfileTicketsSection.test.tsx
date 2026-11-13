import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockTicket, mockTicketToReview, mockAccount } from "../../../test/handlers/accounts";
import type { AccountTicket } from "../../../types";

const reportError = vi.fn();
vi.mock("../../../context/AppErrorContext", () => ({ useAppError: () => ({ reportError }) }));
// The cards embed comment widgets that need their provider; they are not what is under test.
vi.mock("../../comments/CommentTrigger", () => ({ default: () => null }));
vi.mock("../../comments/CommentPreviewList", () => ({ default: () => null }));

import ProfileTicketsSection from "../ProfileTicketsSection";

const BASE = "/api/v1/accounts/tickets";
const page = (results: AccountTicket[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });
const acme = { ...mockAccount, id: 1, company_name: "Acme Corp" };
const globex = { ...mockAccount, id: 2, company_name: "Globex" };
const t = (over: Partial<AccountTicket>): AccountTicket => ({ ...mockTicket, ...over });

/** Serve confirmed tickets and the needs-review queue, honouring the `kind` / `review` params. */
function serve(confirmed: AccountTicket[], review: AccountTicket[] = [], seen: string[] = []) {
  server.use(http.get(`${BASE}/`, ({ request }) => {
    const u = new URL(request.url);
    seen.push(u.search);
    if (u.searchParams.get("review") === "needs_review") return page(review);
    const kind = u.searchParams.get("kind");
    return page(confirmed.filter((x) => !kind || x.kind === kind));
  }));
}

const renderIt = (kind: AccountTicket["kind"] = "jira", hash = "") =>
  render(<MemoryRouter initialEntries={[`/profile${hash}`]}><ProfileTicketsSection kind={kind} accounts={[acme, globex]} /></MemoryRouter>);

beforeEach(() => { reportError.mockReset(); });

describe("ProfileTicketsSection", () => {
  it("lists the kind's records across accounts, each naming its account", async () => {
    serve([
      t({ id: 1, kind: "jira", title: "Fix login", account: 1, account_name: "Acme Corp" }),
      t({ id: 2, kind: "jira", title: "Slow export", account: 2, account_name: "Globex" }),
      t({ id: 3, kind: "zendesk", title: "Not mine to show", account: 1, account_name: "Acme Corp" }),
    ]);
    renderIt("jira");
    expect(await screen.findByDisplayValue("Fix login")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Slow export")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Not mine to show")).toBeNull();
    const names = screen.getAllByTestId("ticket-account").map((a) => a.textContent);
    expect(names).toEqual(["Acme Corp", "Globex"]);
    expect(screen.getAllByTestId("ticket-account")[0].getAttribute("href")).toBe("/accounts/1");
  });

  it("asks for this kind with no account, so it spans every account", async () => {
    const seen: string[] = [];
    serve([], [], seen);
    renderIt("zendesk");
    await waitFor(() => expect(seen.some((s) => s.includes("kind=zendesk"))).toBe(true));
    expect(seen.filter((s) => s.includes("kind=zendesk")).every((s) => !s.includes("account="))).toBe(true);
  });

  it("uses the same empty text as an account's page", async () => {
    serve([]);
    renderIt("product_gap");
    expect(await screen.findByText("No product gaps recorded for this account yet.")).toBeInTheDocument();
  });

  it("filters by status like the account page", async () => {
    serve([t({ id: 1, title: "Open one", status: "open" }), t({ id: 2, title: "Done one", status: "resolved" })]);
    renderIt("jira");
    await screen.findByDisplayValue("Open one");
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by status" })).getByRole("button", { name: "Resolved" }));
    expect(screen.queryByDisplayValue("Open one")).toBeNull();
    expect(screen.getByDisplayValue("Done one")).toBeInTheDocument();
  });

  describe("an email that matched no account", () => {
    const stray = (over: Partial<AccountTicket> = {}) => ({ ...mockTicketToReview, kind: "jira" as const, title: "Stray JIRA", ...over });

    it("is pinned at the front of its kind's list, above confirmed records", async () => {
      serve([t({ id: 1, kind: "jira", title: "Confirmed A" }), t({ id: 2, kind: "jira", title: "Confirmed B" })], [stray()]);
      const { container } = renderIt("jira");
      const pinned = await screen.findByTestId(`review-row-${mockTicketToReview.id}`);
      expect(pinned.getAttribute("data-ticket-pinned")).toBe("true");
      expect(within(pinned).getByText(/Pinned/)).toBeInTheDocument();
      await screen.findByDisplayValue("Confirmed A");
      const order = Array.from(container.querySelectorAll("[data-testid^='review-row-'], [data-testid^='ticket-card-']")).map((e) => e.getAttribute("data-testid"));
      expect(order[0]).toBe(`review-row-${mockTicketToReview.id}`);
      expect(order.slice(1)).toHaveLength(2);
    });

    it("stays pinned whatever the status filter says", async () => {
      serve([t({ id: 1, kind: "jira", title: "Resolved one", status: "resolved" })], [stray()]);
      renderIt("jira");
      await screen.findByDisplayValue("Resolved one");
      fireEvent.click(within(screen.getByRole("group", { name: "Filter by status" })).getByRole("button", { name: "In Progress" }));
      expect(screen.queryByDisplayValue("Resolved one")).toBeNull();
      expect(screen.getByTestId(`review-row-${mockTicketToReview.id}`)).toBeInTheDocument();
    });

    it("appears only in the section for its own kind", async () => {
      serve([], [stray({ kind: "zendesk" })]);
      renderIt("jira");
      await new Promise((r) => setTimeout(r, 60));
      expect(screen.queryByTestId(`review-row-${mockTicketToReview.id}`)).toBeNull();
      // and the "nothing here" text still shows, since no record belongs in this list
      expect(screen.getByText("No JIRA tickets linked to this account yet.")).toBeInTheDocument();
    });

    it("can be filed on an account, which unpins it", async () => {
      let filed = false;
      let body: { account?: number; kind?: string } = {};
      server.use(
        http.get(`${BASE}/`, ({ request }) => {
          const u = new URL(request.url);
          if (u.searchParams.get("review") === "needs_review") return page(filed ? [] : [stray()]);
          return page(filed ? [t({ id: 9, kind: "jira", title: "Stray JIRA", account: 1, account_name: "Acme Corp" })] : []);
        }),
        http.post(`${BASE}/:id/assign/`, async ({ request }) => {
          body = (await request.json()) as typeof body; filed = true;
          return HttpResponse.json({ ...mockTicketToReview, account: 1, review_state: "confirmed" });
        }),
      );
      renderIt("jira");
      const row = await screen.findByTestId(`review-row-${mockTicketToReview.id}`);
      await waitFor(() => expect(within(row).getByRole("option", { name: "Acme Corp" })).toBeInTheDocument());
      fireEvent.change(within(row).getByLabelText("Account"), { target: { value: "1" } });
      fireEvent.click(within(row).getByRole("button", { name: "Add to account" }));
      await waitFor(() => expect(body.account).toBe(1));
      await waitFor(() => expect(screen.queryByTestId(`review-row-${mockTicketToReview.id}`)).toBeNull());
      expect(await screen.findByDisplayValue("Stray JIRA")).toBeInTheDocument();
    });

    it("can be dismissed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      let gone = false;
      server.use(
        http.get(`${BASE}/`, ({ request }) =>
          new URL(request.url).searchParams.get("review") === "needs_review" ? page(gone ? [] : [stray()]) : page([])),
        http.delete(`${BASE}/:id/`, () => { gone = true; return new HttpResponse(null, { status: 204 }); }),
      );
      renderIt("jira");
      fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(screen.queryByTestId(`review-row-${mockTicketToReview.id}`)).toBeNull());
    });

    it("scrolls to the pinned card when the notification link (#ticket-review) is followed", async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      serve([], [stray()]);
      renderIt("jira", "#ticket-review");
      await screen.findByTestId(`review-row-${mockTicketToReview.id}`);
      await waitFor(() => expect(scroll).toHaveBeenCalled());
    });
  });

  describe("adding from a pasted link", () => {
    it("needs an account first", async () => {
      serve([]);
      renderIt("jira");
      const box = await screen.findByLabelText(/Paste a link/);
      fireEvent.change(box, { target: { value: "https://x.atlassian.net/browse/AB-1" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.stringMatching(/Choose an account/)));
    });

    it("creates the record on the chosen account and kind", async () => {
      let body: Partial<AccountTicket> = {};
      serve([]);
      server.use(http.post(`${BASE}/`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...mockTicket, ...body, id: 77 }, { status: 201 });
      }));
      renderIt("zendesk");
      fireEvent.change(await screen.findByLabelText(/Account for a new/), { target: { value: "2" } });
      const box = screen.getByLabelText(/Paste a link/);
      fireEvent.change(box, { target: { value: "https://acme.zendesk.com/agent/tickets/5" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(body).toMatchObject({ account: 2, kind: "zendesk", url: "https://acme.zendesk.com/agent/tickets/5" }));
    });

    it("ignores text that is not a link", async () => {
      let posted = false;
      serve([]);
      server.use(http.post(`${BASE}/`, () => { posted = true; return HttpResponse.json({}, { status: 201 }); }));
      renderIt("jira");
      fireEvent.change(await screen.findByLabelText(/Account for a new/), { target: { value: "1" } });
      const box = screen.getByLabelText(/Paste a link/);
      fireEvent.change(box, { target: { value: "not a link" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 60));
      expect(posted).toBe(false);
    });
  });
});
