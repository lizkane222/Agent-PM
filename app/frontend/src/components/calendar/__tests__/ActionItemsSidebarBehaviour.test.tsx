import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ActionItemsSidebar from "../ActionItemsSidebar";
import { apiClient } from "../../../lib/api";
import { mockActionItem } from "../../../test/handlers/action_items";
import type { AirtableActionItem } from "../../../types";

/**
 * Behaviour of the single, extracted sidebar that CalendarPage mounts: the props the page passes
 * (colors, accountFilter), the silent reload, and the delete path that also clears calendar blocks.
 */

vi.mock("../../comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../hooks/useExportTray", () => ({
  useExportTray: () => ({ addToTray: vi.fn(), isSelected: vi.fn(() => false), exportMode: false }),
}));
vi.mock("../../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../action-items/StepsPanel", () => ({ default: () => null }));

const row = (id: number, task: string, account: string | null = "Acme Corp"): AirtableActionItem => ({
  ...mockActionItem, id, airtable_id: `rec${id}`, task, account_name: account,
});

function serve(rows: AirtableActionItem[], hold?: { ms: number; gets: number }) {
  const state = { gets: 0, deleted: [] as string[], eventDeletes: [] as string[], eventQueries: [] as (string | null)[] };
  server.use(
    http.get("/api/v1/airtable/action-items/", async () => {
      state.gets += 1;
      if (hold && state.gets > hold.gets) await new Promise((r) => setTimeout(r, hold.ms));
      return HttpResponse.json(rows);
    }),
    http.delete("/api/v1/airtable/action-items/:id/", ({ params }) => { state.deleted.push(String(params.id)); return new HttpResponse(null, { status: 204 }); }),
    http.get("/api/v1/scheduler/events/", ({ request }) => {
      state.eventQueries.push(new URL(request.url).searchParams.get("agentpm_airtable_id"));
      return HttpResponse.json([
        { id: 501, calendar_id: "work_tracking" },
        { id: 502, calendar_id: "primary" },
      ]);
    }),
    http.delete("/api/v1/scheduler/events/:id/", ({ params }) => { state.eventDeletes.push(String(params.id)); return new HttpResponse(null, { status: 204 }); }),
    http.get("/api/v1/airtable/action-items/:id/attachments/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/scheduler/scheduled-occurrences/", () => HttpResponse.json({ results: [], count: 0 })),
  );
  return state;
}

describe("extracted ActionItemsSidebar", () => {
  beforeEach(() => { localStorage.clear(); });

  it("paints cards with the action-item color it is given", async () => {
    serve([row(1, "Alpha")]);
    const colors = { colorFor: (t: string) => (t === "action_item" ? "#112233" : "#445566") };
    const { container } = render(<ActionItemsSidebar colors={colors as never} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(container.querySelector('[data-accent="#112233"]')).not.toBeNull();
  });

  it("narrows to the account selected in the Accounts sidebar, case-insensitively, and says so", async () => {
    serve([row(1, "Alpha", "Acme Corp"), row(2, "Bravo", "Beta Inc")]);
    render(<ActionItemsSidebar accountFilter="ACME corp" />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-account-filter")).toHaveTextContent("ACME corp");
  });

  it("opens the modal for a pushed-in expandItemId once the list has loaded", async () => {
    serve([row(1, "Alpha")]);
    render(<ActionItemsSidebar expandItemId="rec1" />);
    // the real modal renders the task in an input
    await waitFor(() => expect(screen.getAllByDisplayValue("Alpha").length).toBeGreaterThan(0));
  });

  it("reloads on a broadcast without ever replacing the list with 'Loading…'", async () => {
    const state = serve([row(1, "Alpha")], { ms: 200, gets: 1 });
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    await act(async () => { await apiClient.post("/airtable/action-items/", { task: "x" }).catch(() => {}); });
    // the second GET is held open; the list must stay on screen while it is in flight
    await waitFor(() => expect(state.gets).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("deleting removes the card, deletes the record and clears its work-tracking calendar blocks only", async () => {
    const state = serve([row(1, "Alpha")]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Remove"));
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    await waitFor(() => expect(state.eventDeletes).toEqual(["501"]));
    expect(state.deleted).toEqual(["1"]);
    expect(state.eventQueries).toEqual(["rec1"]);
  });

  it("puts the card back when the delete is refused", async () => {
    serve([row(1, "Alpha")]);
    server.use(http.delete("/api/v1/airtable/action-items/:id/", () => HttpResponse.json({ detail: "no" }, { status: 403 })));
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Remove"));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
  });
});
