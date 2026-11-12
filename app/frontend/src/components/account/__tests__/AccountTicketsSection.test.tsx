import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockAccount, mockTicket } from "../../../test/handlers/accounts";
import type { AccountTicket } from "../../../types";

const reportError = vi.fn();
vi.mock("../../../context/AppErrorContext", () => ({ useAppError: () => ({ reportError }) }));
vi.mock("../../shared/RichTextMentionEditor", () => ({
  default: ({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit?: () => void }) => (
    <textarea aria-label="notes editor" value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit?.(); } }} />
  ),
}));

import AccountTicketsSection from "../AccountTicketsSection";

const BASE = "/api/v1/accounts/tickets";
const page = (results: AccountTicket[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });
const renderSection = (kind: "jira" | "zendesk" | "product_gap" = "jira") =>
  render(<MemoryRouter><AccountTicketsSection account={mockAccount} kind={kind} /></MemoryRouter>);

beforeEach(() => { reportError.mockReset(); });

describe("AccountTicketsSection", () => {
  it("shows the per-kind empty state", async () => {
    renderSection("product_gap");
    expect(await screen.findByText(/No product gaps recorded/)).toBeInTheDocument();
  });

  it("renders a card with title, key, link, status, datetimes and a comment trigger", async () => {
    server.use(http.get(`${BASE}/`, () => page([{ ...mockTicket, resolved_at: "2026-03-05T09:00:00Z", status: "resolved" }])));
    renderSection();
    const card = await screen.findByTestId("ticket-card-501");
    expect(within(card).getByLabelText("Ticket title")).toHaveValue("Segment sync fails");
    expect(within(card).getByText("ENG-1")).toBeInTheDocument();
    const link = within(card).getByRole("link");
    expect(link).toHaveAttribute("href", mockTicket.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(within(card).getByText("Resolved", { selector: "button" })).toBeInTheDocument();
    // source dates win over created_at/updated_at; tooltip carries the full ISO
    expect(card.querySelector('[title="2026-03-01T10:00:00Z"]')).not.toBeNull();
    expect(card.querySelector('[title="2026-03-02T11:30:00Z"]')).not.toBeNull();
    expect(card.querySelector('[title="2026-03-05T09:00:00Z"]')).not.toBeNull();
    expect(within(card).getByLabelText("Add a comment")).toBeInTheDocument();
  });

  it("falls back to created_at/updated_at and hides Resolved when unset", async () => {
    server.use(http.get(`${BASE}/`, () => page([{ ...mockTicket, source_created_at: null, source_updated_at: null }])));
    renderSection();
    const card = await screen.findByTestId("ticket-card-501");
    expect(card.querySelector('[title="2026-03-03T00:00:00Z"]')).not.toBeNull();
    expect(within(card).queryByText(/^Resolved /)).toBeNull();
  });

  it("pasting a link POSTs it and shows the new card", async () => {
    let body: Partial<AccountTicket> = {};
    let created = false;
    server.use(
      http.get(`${BASE}/`, () => page(created ? [{ ...mockTicket, id: 600, title: "New one" }] : [])),
      http.post(`${BASE}/`, async ({ request }) => { body = (await request.json()) as Partial<AccountTicket>; created = true; return HttpResponse.json({ ...mockTicket, id: 600 }, { status: 201 }); }),
    );
    renderSection();
    const input = await screen.findByLabelText(/Paste a link/);
    fireEvent.change(input, { target: { value: "https://jira.example.com/browse/ENG-9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByTestId("ticket-card-600")).toBeInTheDocument();
    expect(body).toMatchObject({ account: 1, kind: "jira", url: "https://jira.example.com/browse/ENG-9" });
  });

  it("reports an error when adding fails", async () => {
    server.use(http.post(`${BASE}/`, () => HttpResponse.json({ detail: "Bad link" }, { status: 400 })));
    renderSection();
    const input = await screen.findByLabelText(/Paste a link/);
    fireEvent.change(input, { target: { value: "https://x.test/1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(reportError).toHaveBeenCalledWith("Bad link"));
  });

  it("adds manually with title, url and status", async () => {
    let body: Partial<AccountTicket> = {};
    server.use(http.post(`${BASE}/`, async ({ request }) => { body = (await request.json()) as Partial<AccountTicket>; return HttpResponse.json(mockTicket, { status: 201 }); }));
    renderSection("zendesk");
    fireEvent.click(await screen.findByText("Add manually"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Printer" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://s.test/2" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "waiting" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(body).toMatchObject({ kind: "zendesk", title: "Printer", url: "https://s.test/2", status: "waiting" }));
  });

  it("changing the status PATCHes it", async () => {
    let body: Partial<AccountTicket> = {};
    server.use(
      http.get(`${BASE}/`, () => page([mockTicket])),
      http.patch(`${BASE}/:id/`, async ({ request }) => { body = (await request.json()) as Partial<AccountTicket>; return HttpResponse.json({ ...mockTicket, ...body }); }),
    );
    renderSection();
    const card = await screen.findByTestId("ticket-card-501");
    fireEvent.click(within(card).getByRole("button", { name: /Open/ }));
    fireEvent.change(within(card).getByRole("combobox"), { target: { value: "waiting" } });
    await waitFor(() => expect(body).toEqual({ status: "waiting" }));
  });

  it("saves notes on Enter and edits the title on blur", async () => {
    const bodies: Partial<AccountTicket>[] = [];
    server.use(
      http.get(`${BASE}/`, () => page([mockTicket])),
      http.patch(`${BASE}/:id/`, async ({ request }) => { const b = (await request.json()) as Partial<AccountTicket>; bodies.push(b); return HttpResponse.json({ ...mockTicket, ...b }); }),
    );
    renderSection();
    const card = await screen.findByTestId("ticket-card-501");
    fireEvent.click(within(card).getByRole("button", { name: /Notes/ }));
    const notes = within(card).getByLabelText("notes editor");
    fireEvent.change(notes, { target: { value: "<p>hi</p>" } });
    fireEvent.keyDown(notes, { key: "Enter" });
    await waitFor(() => expect(bodies).toContainEqual({ notes: "<p>hi</p>" }));
    const title = within(card).getByLabelText("Ticket title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.blur(title);
    await waitFor(() => expect(bodies).toContainEqual({ title: "Renamed" }));
  });

  it("deletes only after confirmation", async () => {
    let deleted = 0;
    server.use(
      http.get(`${BASE}/`, () => page([mockTicket])),
      http.delete(`${BASE}/:id/`, () => { deleted++; return new HttpResponse(null, { status: 204 }); }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderSection();
    const del = await screen.findByLabelText(/^Delete /);
    fireEvent.click(del);
    expect(deleted).toBe(0);
    fireEvent.click(del);
    await waitFor(() => expect(deleted).toBe(1));
    confirm.mockRestore();
  });

  it("filters by status", async () => {
    server.use(http.get(`${BASE}/`, () => page([mockTicket, { ...mockTicket, id: 502, title: "Closed one", status: "closed" }])));
    renderSection();
    await screen.findByTestId("ticket-card-502");
    fireEvent.click(screen.getByRole("button", { name: "Closed", pressed: false }));
    expect(screen.queryByTestId("ticket-card-501")).toBeNull();
    expect(screen.getByTestId("ticket-card-502")).toBeInTheDocument();
  });

  describe("the card: wrapped title, notes behind their heading, and comments you can add", () => {
    const serveOne = (over: Partial<AccountTicket> = {}) => server.use(
      http.get(`${BASE}/`, () => page([{ ...mockTicket, ...over }])),
      http.patch(`${BASE}/:id/`, async ({ request }) => HttpResponse.json({ ...mockTicket, ...over, ...(await request.json() as object) })),
    );

    it("the title is a wrapping text area, not a one-line box", async () => {
      serveOne({ title: "A very long ticket title that would never fit on one line of a narrow card " .repeat(3) });
      renderSection();
      const title = (await screen.findByLabelText("Ticket title")) as HTMLTextAreaElement;
      expect(title.tagName).toBe("TEXTAREA");
      expect(title.rows).toBe(1);
      expect(title.className).toContain("resize-none");
      // It cannot take a line break (Enter commits instead), so it stays a single paragraph.
      fireEvent.change(title, { target: { value: "one\ntwo" } });
      expect(title.value).toBe("one two");
    });

    it("Enter in the title commits it instead of adding a line", async () => {
      const bodies: Partial<AccountTicket>[] = [];
      server.use(
        http.get(`${BASE}/`, () => page([mockTicket])),
        http.patch(`${BASE}/:id/`, async ({ request }) => { const b = (await request.json()) as Partial<AccountTicket>; bodies.push(b); return HttpResponse.json({ ...mockTicket, ...b }); }),
      );
      renderSection();
      const title = await screen.findByLabelText("Ticket title");
      fireEvent.change(title, { target: { value: "Retitled" } });
      title.focus();
      fireEvent.keyDown(title, { key: "Enter" });
      fireEvent.blur(title);
      await waitFor(() => expect(bodies).toContainEqual({ title: "Retitled" }));
    });

    it("notes are hidden until the Notes heading is clicked", async () => {
      serveOne({ notes: "" });
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      expect(within(card).queryByLabelText("notes editor")).toBeNull();
      const heading = within(card).getByRole("button", { name: /Notes/ });
      expect(heading.getAttribute("aria-expanded")).toBe("false");
      expect(within(card).getByText("Add a note")).toBeInTheDocument();
      fireEvent.click(heading);
      expect(within(card).getByLabelText("notes editor")).toBeInTheDocument();
      expect(heading.getAttribute("aria-expanded")).toBe("true");
    });

    it("a saved note shows under the heading while the editor is closed", async () => {
      serveOne({ notes: "<p>Customer confirmed the fix</p>" });
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      expect(within(card).getByTestId("ticket-notes-text").textContent).toBe("Customer confirmed the fix");
      expect(within(card).queryByLabelText("notes editor")).toBeNull();
    });

    it("adding a note saves it; clicking outside closes the editor and the note stays visible", async () => {
      const bodies: Partial<AccountTicket>[] = [];
      server.use(
        http.get(`${BASE}/`, () => page([{ ...mockTicket, notes: "" }])),
        http.patch(`${BASE}/:id/`, async ({ request }) => { const b = (await request.json()) as Partial<AccountTicket>; bodies.push(b); return HttpResponse.json({ ...mockTicket, ...b }); }),
      );
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      fireEvent.click(within(card).getByRole("button", { name: /Notes/ }));
      const editor = within(card).getByLabelText("notes editor");
      fireEvent.change(editor, { target: { value: "<p>Called the customer</p>" } });
      fireEvent.keyDown(editor, { key: "Enter" });
      await waitFor(() => expect(bodies).toContainEqual({ notes: "<p>Called the customer</p>" }));
      // Still open after saving...
      expect(within(card).getByLabelText("notes editor")).toBeInTheDocument();
      // ...and a click elsewhere closes it, leaving the note on show.
      fireEvent.mouseDown(document.body);
      expect(within(card).queryByLabelText("notes editor")).toBeNull();
      expect(within(card).getByTestId("ticket-notes-text").textContent).toBe("Called the customer");
    });

    it("clicking outside saves a note that was typed but not submitted", async () => {
      const bodies: Partial<AccountTicket>[] = [];
      server.use(
        http.get(`${BASE}/`, () => page([{ ...mockTicket, notes: "" }])),
        http.patch(`${BASE}/:id/`, async ({ request }) => { const b = (await request.json()) as Partial<AccountTicket>; bodies.push(b); return HttpResponse.json({ ...mockTicket, ...b }); }),
      );
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      fireEvent.click(within(card).getByRole("button", { name: /Notes/ }));
      fireEvent.change(within(card).getByLabelText("notes editor"), { target: { value: "<p>half done</p>" } });
      fireEvent.mouseDown(document.body);
      await waitFor(() => expect(bodies).toContainEqual({ notes: "<p>half done</p>" }));
    });

    it("clicking inside the notes area does not close it", async () => {
      serveOne({ notes: "" });
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      fireEvent.click(within(card).getByRole("button", { name: /Notes/ }));
      fireEvent.mouseDown(within(card).getByLabelText("notes editor"));
      expect(within(card).getByLabelText("notes editor")).toBeInTheDocument();
    });

    it("the Comments heading opens a composer; Enter posts the comment to this ticket", async () => {
      let body: Record<string, unknown> = {};
      serveOne();
      server.use(http.post("*/api/v1/comments/comments/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 9, ...body, author_display: "Me" }, { status: 201 });
      }));
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      expect(within(card).queryByPlaceholderText(/Write a comment/)).toBeNull();
      const heading = within(card).getByRole("button", { name: /Comments/ });
      expect(heading.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(heading);
      const box = await within(card).findByPlaceholderText(/Write a comment/);
      fireEvent.change(box, { target: { value: "Waiting on engineering" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(body).toMatchObject({ resource_type: "account_ticket", resource_id: 501, content: "Waiting on engineering" }));
    });

    it("the comment composer closes when you click outside it", async () => {
      serveOne();
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      fireEvent.click(within(card).getByRole("button", { name: /Comments/ }));
      await within(card).findByPlaceholderText(/Write a comment/);
      fireEvent.mouseDown(document.body);
      expect(within(card).queryByPlaceholderText(/Write a comment/)).toBeNull();
    });

    it("notes and comments open independently", async () => {
      serveOne({ notes: "" });
      renderSection();
      const card = await screen.findByTestId("ticket-card-501");
      fireEvent.click(within(card).getByRole("button", { name: /Notes/ }));
      // Pressing inside the Comments area is "outside" the notes area, so it closes notes.
      fireEvent.mouseDown(within(card).getByTestId("ticket-comments"));
      expect(within(card).queryByLabelText("notes editor")).toBeNull();
    });
  });
});
