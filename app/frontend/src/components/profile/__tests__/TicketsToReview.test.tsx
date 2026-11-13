import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockTicketToReview, mockAccount } from "../../../test/handlers/accounts";
import type { AccountTicket } from "../../../types";

const reportError = vi.fn();
vi.mock("../../../context/AppErrorContext", () => ({ useAppError: () => ({ reportError }) }));

import TicketsToReview from "../TicketsToReview";

const BASE = "/api/v1/accounts/tickets";
const page = (results: AccountTicket[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });
const renderIt = (hash = "") => render(<MemoryRouter initialEntries={[`/profile${hash}`]}><TicketsToReview /></MemoryRouter>);

beforeEach(() => { reportError.mockReset(); });

describe("TicketsToReview", () => {
  it("renders nothing when there is nothing to review", async () => {
    const { container } = renderIt();
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it("lists pending records and requests only needs_review", async () => {
    let url = "";
    server.use(http.get(`${BASE}/`, ({ request }) => { url = request.url; return page([mockTicketToReview]); }));
    renderIt("#ticket-review");
    expect(await screen.findByText("Login broken")).toBeInTheDocument();
    expect(screen.getByText("Zendesk", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/\[Zendesk\] Ticket 77/)).toBeInTheDocument();
    expect(screen.getByText(/customer reports login errors/)).toBeInTheDocument();
    expect(document.getElementById("ticket-review")).not.toBeNull();
    expect(url).toContain("review=needs_review");
  });

  it("assigns to the chosen account and category, then the row disappears", async () => {
    let assigned = false;
    let body: { account?: number; kind?: string } = {};
    server.use(
      http.get(`${BASE}/`, () => page(assigned ? [] : [mockTicketToReview])),
      http.post(`${BASE}/:id/assign/`, async ({ request }) => { body = (await request.json()) as typeof body; assigned = true; return HttpResponse.json({ ...mockTicketToReview, account: 1 }); }),
    );
    renderIt();
    await screen.findByText("Login broken");
    const add = screen.getByRole("button", { name: "Add to account" });
    expect(add).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("option", { name: mockAccount.company_name })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: String(mockAccount.id) } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "product_gap" } });
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByText("Login broken")).toBeNull());
    expect(body).toEqual({ account: mockAccount.id, kind: "product_gap" });
  });

  it("dismisses after confirmation", async () => {
    let deleted = 0;
    server.use(
      http.get(`${BASE}/`, () => page(deleted ? [] : [mockTicketToReview])),
      http.delete(`${BASE}/:id/`, () => { deleted++; return new HttpResponse(null, { status: 204 }); }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderIt();
    const btn = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(btn);
    expect(deleted).toBe(0);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByText("Login broken")).toBeNull());
    expect(deleted).toBe(1);
    confirm.mockRestore();
  });

  it("with `kinds`, shows only those kinds (the others are pinned in their own sections)", async () => {
    server.use(http.get(`${BASE}/`, () => page([
      { ...mockTicketToReview, id: 601, kind: "jira", title: "A JIRA" },
      { ...mockTicketToReview, id: 602, kind: "zendesk", title: "A Zendesk" },
    ])));
    render(<MemoryRouter><TicketsToReview kinds={["zendesk"]} /></MemoryRouter>);
    expect(await screen.findByText("A Zendesk")).toBeInTheDocument();
    expect(screen.queryByText("A JIRA")).toBeNull();
  });

  it("with an empty `kinds`, renders nothing", async () => {
    server.use(http.get(`${BASE}/`, () => page([mockTicketToReview])));
    const { container } = render(<MemoryRouter><TicketsToReview kinds={[]} /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 60));
    expect(container).toBeEmptyDOMElement();
  });
});
