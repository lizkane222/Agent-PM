import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ActionItemsSidebar from "../ActionItemsSidebar";
import { apiClient } from "../../../lib/api";
import type { AirtableActionItem } from "../../../types";

/**
 * The reported bug: an action item created on the Account Detail page never showed up in
 * the Calendar page's action items sidebar. The sidebar always had a listener; nothing ever
 * told it, because three creation paths didn't broadcast. The broadcast now happens in the
 * api client, so any create anywhere reaches this sidebar.
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

const item = (id: number, task: string): AirtableActionItem => ({
  id,
  airtable_id: `rec${id}`,
  account: 1,
  account_name: "Acme Corp",
  task,
  task_details: "",
  status: "Open",
  priority: "High",
  due_date: null,
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  salesforce_task_id: "",
  assignee_airtable_id: "",
  assignee_name: "",
  reminder: null,
  reminder_id: null,
  reminder_due_at: null,
  reminder_status: null,
  linked_meeting: null,
  linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
});

/** Serve a list the test can grow, mimicking the server gaining a row. */
function serve(initial: AirtableActionItem[]) {
  const state = { items: [...initial], statusParams: [] as (string | null)[] };
  server.use(
    http.get("/api/v1/airtable/action-items/", ({ request }) => {
      state.statusParams.push(new URL(request.url).searchParams.get("status"));
      return HttpResponse.json(state.items);
    }),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/team/members/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({ status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"], priority: ["Low", "Medium", "High", "Critical"] })
    ),
    http.get("/api/v1/scheduler/scheduled-occurrences/", () => HttpResponse.json({ results: [], count: 0 })),
    http.post("/api/v1/airtable/action-items/", () => HttpResponse.json(item(2, "Made elsewhere"), { status: 201 })),
  );
  return state;
}

describe("Calendar action items sidebar freshness", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("picks up an action item created elsewhere in the app", async () => {
    const state = serve([item(1, "Already here")]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Already here")).toBeInTheDocument());
    expect(screen.queryByText("Made elsewhere")).not.toBeInTheDocument();

    // Exactly what the Account Detail "New action item" form does — a create through the
    // shared api client, with no explicit broadcast at the call site.
    state.items.push(item(2, "Made elsewhere"));
    await act(async () => {
      await apiClient.post("/airtable/action-items/", { task: "Made elsewhere" });
    });

    // The sidebar debounces its refetch by 500ms.
    await waitFor(
      () => expect(screen.getByText("Made elsewhere")).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });

  it("requests only the statuses it displays", async () => {
    const state = serve([item(1, "Already here")]);
    render(<ActionItemsSidebar />);
    await waitFor(() => expect(screen.getByText("Already here")).toBeInTheDocument());

    // The old filter also asked for Blocked/Backlogged and discarded them, plus a
    // "Complete" status that does not exist in the model. Done is asked for because the
    // sidebar has a Done section (bounded on render to DONE_WINDOW_DAYS).
    expect(state.statusParams[0]).toBe("Open,In Progress,Done");
    expect(state.statusParams[0]).not.toContain("Complete");
    expect(state.statusParams[0]).not.toContain("Backlogged");
  });
});
