import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ActionItemCalendarNotes from "../ActionItemCalendarNotes";

describe("ActionItemCalendarNotes", () => {
  it("lists notes from the item's calendar blocks, read-only", async () => {
    let param: string | null = null;
    server.use(
      http.get("/api/v1/scheduler/meeting-notes/", ({ request }) => {
        param = new URL(request.url).searchParams.get("action_item");
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [
          { id: 1, event: 9, author: 1, author_username: "ana", author_display: "Ana", html: "<p>Spoke to <b>Bob</b></p>",
            text: "Spoke to Bob", due_date: null, position: 0, created_at: "2026-10-14T16:00:00Z", updated_at: "" },
        ] });
      }),
    );
    render(<ActionItemCalendarNotes airtableId="recAAA001" />);
    expect(await screen.findByTestId("action-item-calendar-notes")).toHaveTextContent("Calendar notes (1)");
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(param).toBe("recAAA001");
  });

  it("renders nothing when there are no notes", async () => {
    server.use(http.get("/api/v1/scheduler/meeting-notes/", () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })));
    const { container } = render(<ActionItemCalendarNotes airtableId="recAAA001" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("never fetches for an unsaved local blank", async () => {
    let calls = 0;
    server.use(http.get("/api/v1/scheduler/meeting-notes/", () => { calls++; return HttpResponse.json({ results: [] }); }));
    render(<ActionItemCalendarNotes airtableId="local-1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });
});
