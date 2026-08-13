import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import CalendarPage from "../CalendarPage";

// ── Mock FullCalendar ─────────────────────────────────────────────────────────
// FullCalendar requires browser rendering APIs not available in jsdom. Swap it
// for a lightweight stub that fires datesSet immediately (triggering fetchEvents)
// and renders event elements so contextmenu listeners wired up by eventDidMount
// can be exercised.
vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");

  const FullCalendarMock = React.forwardRef(function FullCalendarMock(
    props: Record<string, unknown>,
    _ref: unknown,
  ) {
    const { datesSet, events, eventDidMount, select } = props as {
      datesSet?: (info: {
        startStr: string;
        endStr: string;
        view: { type: string };
      }) => void;
      events?: Array<{
        id: string;
        title: string;
        extendedProps?: unknown;
      }>;
      eventDidMount?: (info: { event: unknown; el: HTMLElement }) => void;
      select?: (info: { startStr: string; endStr: string }) => void;
    };

    const calledRef = React.useRef(new Set<string>());

    // Fire datesSet on mount so CalendarPage's handleDatesSet → fetchEvents runs.
    React.useEffect(() => {
      datesSet?.({
        startStr: "2026-07-28T00:00:00.000Z",
        endStr: "2026-08-04T00:00:00.000Z",
        view: { type: "timeGridWeek" },
      });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return React.createElement(
      "div",
      { "data-testid": "fullcalendar" },
      // Test-only trigger for FullCalendar's `select` prop (drag-to-create on the grid).
      React.createElement("button", {
        "data-testid": "trigger-date-select",
        onClick: () => select?.({ startStr: "2026-07-28T10:00:00", endStr: "2026-07-28T11:00:00" }),
      }),
      events?.map((ev) =>
        React.createElement("div", {
          key: ev.id,
          "data-testid": "calendar-event",
          "data-event-id": ev.id,
          // Call eventDidMount once per element so contextmenu listeners attach.
          ref: (el: HTMLElement | null) => {
            if (el && eventDidMount && !calledRef.current.has(ev.id)) {
              calledRef.current.add(ev.id);
              eventDidMount({ event: ev, el });
            }
          },
        }, ev.title),
      ),
    );
  });

  return { default: FullCalendarMock };
});

vi.mock("@fullcalendar/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/interaction", () => ({ default: {} }));

// ── Mock sub-components that trigger their own API calls ──────────────────────
vi.mock("../../components/calendar/DayBar", () => ({ default: () => null }));
vi.mock("../../components/calendar/LogTimePanel", () => ({ default: () => null }));
vi.mock("../../components/calendar/MeetingDetail", () => ({ default: () => null }));
// CreateEventModal has its own extensive UI/API surface (guests, video conferencing, etc.)
// covered by its own component test — here we stub just enough to drive CalendarPage's
// onSave wiring: a title field and Save/Cancel buttons.
vi.mock("../../components/calendar/CreateEventModal", async () => {
  const React = await import("react");
  return {
    default: function CreateEventModalMock(props: {
      draft: { title: string; description: string; category: string; type: string };
      onChange: (updater: (d: unknown) => unknown) => void;
      onSave: (payload: unknown) => Promise<void>;
      onCancel: () => void;
      saving: boolean;
    }) {
      return React.createElement("div", { "data-testid": "create-event-modal-mock" }, [
        React.createElement("input", {
          key: "title",
          "data-testid": "mock-title-input",
          value: props.draft.title,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            props.onChange((d) => ({ ...(d as object), title: e.target.value })),
        }),
        React.createElement(
          "button",
          {
            key: "save",
            onClick: () =>
              void props.onSave({
                draft: props.draft,
                assembledDescription: props.draft.description,
                attendees: [],
                meetLink: "",
                effectiveCategory: props.draft.category,
                sendInvites: false,
              }),
          },
          props.saving ? "Saving…" : "Create",
        ),
        React.createElement("button", { key: "cancel", onClick: props.onCancel }, "Cancel"),
      ]);
    },
  };
});

// Real component, but its own account-fetching effect and drag/drop are irrelevant here —
// stub renders just enough (the unlinked-count button) to exercise CalendarPage's wiring.
vi.mock("../../components/calendar/AccountsSidebar", async () => {
  const React = await import("react");
  return {
    default: function AccountsSidebarMock(props: { onShowUnlinkedView?: () => void; unlinkedCount?: number }) {
      return props.onShowUnlinkedView
        ? React.createElement(
            "button",
            { onClick: props.onShowUnlinkedView },
            `Unlinked (${props.unlinkedCount ?? 0})`,
          )
        : null;
    },
  };
});
vi.mock("../../components/calendar/EventDetailPanel", () => ({ default: () => null }));
vi.mock("../../components/calendar/ItemsSidebar", () => ({ default: () => null }));
vi.mock("../../components/calendar/RsvpDot", () => ({ default: () => null }));

// ── Mock cross-cutting hooks / utilities ──────────────────────────────────────
vi.mock("../../hooks/useLogGlow", () => ({ useLogGlow: () => {} }));
vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn() }),
}));
vi.mock("../../lib/appLog", () => ({ addLog: vi.fn() }));
vi.mock("../../assets/icons/Calendar.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── Helper ────────────────────────────────────────────────────────────────────

function renderPage() {
  render(
    <AppErrorProvider>
      <CalendarPage />
    </AppErrorProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CalendarPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    // CalendarPage eagerly loads all accounts on mount for auto-linking;
    // add quiet handlers so onUnhandledRequest:"error" doesn't fail the tests.
    server.use(
      http.get("/api/v1/airtable/accounts/", () =>
        HttpResponse.json({ results: [] }),
      ),
      http.get("/api/v1/accounts/accounts/", () =>
        HttpResponse.json({ results: [], count: 0 }),
      ),
      http.get("/api/v1/accounts/admin-account/", () =>
        HttpResponse.json({ id: 1, company_name: "Admin" }),
      ),
    );
  });

  it("renders FullCalendar stub and Sync button without crashing", async () => {
    renderPage();
    expect(screen.getByTestId("fullcalendar")).toBeInTheDocument();
    expect(screen.getByText("Sync Google Calendar")).toBeInTheDocument();
  });

  it("renders event titles after fetchEvents completes", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Q3 Planning")).toBeInTheDocument();
      expect(screen.getByText("Customer Demo")).toBeInTheDocument();
    });
  });

  it("unlinked count reflects events with no account link, and switching to the unlinked view keeps them visible", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Q3 Planning")).toBeInTheDocument();
      expect(screen.getByText("Customer Demo")).toBeInTheDocument();
    });
    // Neither mock event has an eventAccountLinks entry, so both count as unlinked.
    const unlinkedBtn = await screen.findByText("Unlinked (2)");
    fireEvent.click(unlinkedBtn);
    await waitFor(() => {
      expect(screen.getByText("Q3 Planning")).toBeInTheDocument();
      expect(screen.getByText("Customer Demo")).toBeInTheDocument();
    });
  });

  it("drag-selecting a date range opens the create-event modal and Save creates the event", async () => {
    let createdBody: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/v1/scheduler/events/", async ({ request }) => {
        createdBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...mockCalendarEvents[0], id: 99, title: (createdBody as { title: string }).title }, { status: 201 });
      }),
    );

    renderPage();
    await screen.findByTestId("fullcalendar");
    expect(screen.queryByTestId("create-event-modal-mock")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("trigger-date-select"));
    const titleInput = await screen.findByTestId("mock-title-input");
    fireEvent.change(titleInput, { target: { value: "New Sync" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createdBody?.["title"]).toBe("New Sync"));
    await waitFor(() => expect(screen.queryByTestId("create-event-modal-mock")).not.toBeInTheDocument());
    expect(screen.getByText('Created "New Sync"')).toBeInTheDocument();
  });

  it("Cancel closes the create-event modal without saving", async () => {
    renderPage();
    await screen.findByTestId("fullcalendar");
    fireEvent.click(screen.getByTestId("trigger-date-select"));
    await screen.findByTestId("create-event-modal-mock");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("create-event-modal-mock")).not.toBeInTheDocument();
  });

  it("datesSet callback triggers the events API call", async () => {
    let eventApiCalls = 0;
    server.use(
      http.get("/api/v1/scheduler/events/", () => {
        eventApiCalls++;
        return HttpResponse.json(mockCalendarEvents);
      }),
    );

    renderPage();
    await waitFor(() => expect(eventApiCalls).toBeGreaterThan(0));
  });

  it("right-clicking a calendar event shows the context menu", async () => {
    renderPage();

    // Wait for events to load and render in the stub.
    const eventEls = await screen.findAllByTestId("calendar-event");

    // The contextmenu listener was wired up by eventDidMount; fire it now.
    fireEvent.contextMenu(eventEls[0]);

    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });
  });

  it("Sync button shows Syncing… then re-enables after successful sync", async () => {
    server.use(
      http.post("/api/v1/integrations/google/sync/", () =>
        HttpResponse.json({ detail: "Synced", event_count: 2 }),
      ),
    );

    renderPage();
    await screen.findByTestId("fullcalendar");

    const syncBtn = screen.getByRole("button", { name: "Sync Google Calendar" });
    fireEvent.click(syncBtn);

    await waitFor(() =>
      expect(screen.getByText("Syncing…")).toBeInTheDocument(),
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Sync Google Calendar" }),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
  });

  it("handleSync API error surfaces via toast message", async () => {
    server.use(
      http.post("/api/v1/integrations/google/sync/", () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    renderPage();
    await screen.findByTestId("fullcalendar");

    const syncBtn = screen.getByRole("button", { name: "Sync Google Calendar" });
    fireEvent.click(syncBtn);

    // handleSync shows a toast (not AppErrorBanner) on sync failure.
    await waitFor(() =>
      expect(screen.getByText(/Google Calendar sync failed/)).toBeInTheDocument(),
    );
  });
});
