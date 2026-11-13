import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, fireEvent, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { mockCalendarEvents, mockReminders } from "../../test/handlers/scheduler";
import { toLocalDatetimeValue } from "../../lib/datetimeLocal";
import { mockActionItem } from "../../test/handlers/action_items";
import { mockGmailCredential } from "../../test/handlers/integrations";
import { mockUserProfile } from "../../test/handlers/team";
import { mockAgentSkill, mockPagePin, pagePinsFor } from "../../test/handlers/skills";
import { mockArtifact, mockCodeArtifact } from "../../test/handlers/accounts";
import {
  mockPlannedEntry,
  mockSkippedEvent,
  weekPlanReport,
} from "../../test/handlers/salesforce";
import {
  DARK_TEXT,
  DEFAULT_CATEGORY_COLORS,
  EVENT_CATEGORY_META,
  EVENT_TYPE_META,
  IMPORTANT_PALETTE,
  borderFor,
  readableTextColor,
  tint,
  withAlpha,
} from "../../lib/eventColors";
import CalendarPage from "../CalendarPage";
import { OCCURRENCE_MS } from "../../lib/reminderSections";

// A 30-second clock tick would make "moves to Historical by itself" a 30-second test.
vi.mock("../../lib/reminderSections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/reminderSections")>()),
  REMINDER_CLOCK_TICK_MS: 60,
}));
import { NotificationDefaultsProvider } from "../../context/NotificationDefaultsContext";

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
    const { datesSet, events, eventDidMount, select, eventClick, customButtons, headerToolbar, drop, eventDrop } = props as {
      datesSet?: (info: {
        startStr: string;
        endStr: string;
        view: { type: string };
      }) => void;
      eventDrop?: (info: unknown) => void;
      customButtons?: Record<string, { text: string; click: () => void }>;
      headerToolbar?: { left?: string; center?: string; right?: string };
      events?: Array<{
        id: string;
        title: string;
        start?: string;
        end?: string;
        editable?: boolean;
        durationEditable?: boolean;
        backgroundColor?: string;
        borderColor?: string;
        extendedProps?: unknown;
      }>;
      eventDidMount?: (info: { event: unknown; el: HTMLElement }) => void;
      select?: (info: { startStr: string; endStr: string }) => void;
      eventClick?: (info: { event: unknown }) => void;
      drop?: (info: { dateStr: string }) => void;
    };

    const calledRef = React.useRef(new Set<string>());

    // Minimal getApi() so page code that navigates (search "jump to") is observable.
    React.useImperativeHandle(_ref as React.Ref<unknown>, () => ({
      getApi: () => ({
        gotoDate: (d: string) => { (window as unknown as Record<string, unknown>).__TEST_GOTO_DATE__ = d; },
        changeView: () => {},
        getDate: () => new Date("2026-07-28T00:00:00Z"),
        view: { type: "timeGridWeek", activeStart: new Date("2026-07-28T00:00:00Z"), activeEnd: new Date("2026-08-04T00:00:00Z") },
        refetchEvents: () => {},
        unselect: () => {},
      }),
    }));

    // Fire datesSet on mount so CalendarPage's handleDatesSet → fetchEvents runs.
    React.useEffect(() => {
      datesSet?.({
        startStr: "2026-07-28T00:00:00.000Z",
        endStr: "2026-08-04T00:00:00.000Z",
        view: { type: "timeGridWeek" },
      });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // The real toolbar's `right` slot, rendered in order so placement is assertable.
    // Space-separated groups, comma-separated buttons within a group; a name that is
    // not a customButton is an FC built-in (prev, today, dayGridMonth, …) and gets a
    // placeholder so its position still counts.
    const toolbarButtons = (headerToolbar?.right ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((group) => group.split(","))
      .filter(Boolean)
      .map((name) =>
        React.createElement(
          "button",
          {
            key: name,
            className: `fc-${name}-button`,
            "data-fc-button": name,
            onClick: customButtons?.[name]?.click,
          },
          customButtons?.[name]?.text ?? name,
        ),
      );

    return React.createElement(
      "div",
      { "data-testid": "fullcalendar" },
      React.createElement(
        "div",
        { className: "fc-header-toolbar", "data-testid": "fc-toolbar-right" },
        toolbarButtons,
      ),
      // Test-only trigger for FullCalendar's `select` prop (drag-to-create on the grid).
      React.createElement("button", {
        "data-testid": "trigger-date-select",
        onClick: () => select?.({ startStr: "2026-07-28T10:00:00", endStr: "2026-07-28T11:00:00" }),
      }),
      // Test-only trigger for a week change. The real FullCalendar calls `datesSet`
      // every time the user pages to another week; the mount-only effect above cannot
      // exercise that, and week navigation is exactly where the "past weeks are empty"
      // bug lives. The target range is read off a global so a test can aim it.
      React.createElement("button", {
        "data-testid": "trigger-dates-set",
        onClick: () => {
          const g = globalThis as Record<string, unknown>;
          datesSet?.({
            startStr: (g.__TEST_RANGE_START__ as string) ?? "2026-07-21T00:00:00.000Z",
            endStr: (g.__TEST_RANGE_END__ as string) ?? "2026-07-28T00:00:00.000Z",
            view: { type: "timeGridWeek" },
          });
        },
      }),
      // Test-only trigger for FullCalendar's `drop` prop — dragging an action item from the
      // sidebar onto the grid. The real event carries a dateStr and the dragged id is read
      // off `window[CALENDAR_DRAG_KEY]`, which a test sets before clicking.
      React.createElement("button", {
        "data-testid": "trigger-item-drop",
        "data-drop-date": (globalThis as Record<string, unknown>).__TEST_DROP_DATE__ ?? "",
        onClick: () =>
          drop?.({
            dateStr:
              ((globalThis as Record<string, unknown>).__TEST_DROP_DATE__ as string) ??
              "2026-07-30T09:00:00",
          }),
      }),
      events?.map((ev) =>
        React.createElement("div", {
          key: ev.id,
          "data-testid": "calendar-event",
          "data-event-id": ev.id,
          // Surfaced so tests can assert per-category event colors.
          "data-bg-color": ev.backgroundColor,
          "data-border-color": ev.borderColor,
          "data-start": ev.start,
          "data-end": ev.end,
          "data-editable": String(ev.editable),
          "data-duration-editable": String(ev.durationEditable),
          // Test-only: drop this event on `__TEST_EVENT_DROP_TO__` the way FullCalendar's
          // `eventDrop` reports it. `revert` is recorded so a test can see a failed move undone.
          onDoubleClick: () => {
            const g = globalThis as Record<string, unknown>;
            const to = new Date(g.__TEST_EVENT_DROP_TO__ as string);
            eventDrop?.({
              event: { id: ev.id, extendedProps: ev.extendedProps, start: to, end: new Date(to.getTime() + 15 * 60_000),
                       startStr: to.toISOString(), endStr: new Date(to.getTime() + 15 * 60_000).toISOString() },
              revert: () => { g.__TEST_REVERTED__ = true; },
            });
          },
          // Clicking an event fires FullCalendar's eventClick, which is what opens
          // the meeting detail panel in the real app.
          onClick: () => eventClick?.({ event: ev }),
          // Call eventDidMount once per element so contextmenu listeners attach.
          ref: (el: HTMLElement | null): void => {
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
// Real MeetingDetail carries WebSocket + Gong-notes machinery irrelevant here.
// The stub surfaces just the attendance pill so CalendarPage's wiring is exercised.
vi.mock("../../components/calendar/MeetingDetail", async () => {
  const React = await import("react");
  return {
    default: function MeetingDetailMock(props: { attended?: boolean; onToggleAttendance?: () => void }) {
      return React.createElement(
        "button",
        {
          "data-testid": "attendance-toggle",
          "data-attended": props.attended ? "true" : "false",
          onClick: props.onToggleAttendance,
        },
        props.attended ? "Attended" : "Did not attend",
      );
    },
  };
});
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
        React.createElement(
          "button",
          {
            key: "save-invite",
            onClick: () =>
              void props.onSave({
                draft: props.draft,
                assembledDescription: props.draft.description,
                attendees: [
                  { email: "ana@example.com", displayName: "Ana", responseStatus: "needsAction" },
                  { email: "ben@example.com", displayName: "Ben", responseStatus: "needsAction" },
                ],
                meetLink: "",
                effectiveCategory: props.draft.category,
                sendInvites: true,
              }),
          },
          "Create and invite",
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
    default: function AccountsSidebarMock(props: {
      onShowUnlinkedView?: () => void;
      unlinkedCount?: number;
      isUnlinkedView?: boolean;
      onLogTimeMode?: (accountName: string | null) => void;
      logTimeModeAccount?: string | null;
      open?: boolean;
      onToggle?: () => void;
      onSelectAccount?: (name: string | null) => void;
      onLink?: (accountId: number, accountName: string, eventUid?: string) => void;
      updateHistorical?: boolean;
      onUpdateHistoricalChange?: (on: boolean) => void;
      updateSubsequent?: boolean;
      onUpdateSubsequentChange?: (on: boolean) => void;
    }) {
      if (!props.onShowUnlinkedView) return null;
      return React.createElement("div", null, [
        React.createElement(
          "button",
          { key: "toggle", "data-testid": "toggle-accounts-panel", "data-open": props.open ? "true" : "false", onClick: props.onToggle },
          "Toggle Accounts",
        ),
        React.createElement(
          "button",
          { key: "select", "data-testid": "select-account-beta", onClick: () => props.onSelectAccount?.("beta inc") },
          "Select Beta",
        ),
        React.createElement(
          "button",
          {
            key: "unlinked",
            onClick: props.onShowUnlinkedView,
            "data-unlinked-active": props.isUnlinkedView ? "true" : "false",
          },
          `Unlinked (${props.unlinkedCount ?? 0})`,
        ),
        React.createElement("button", {
          key: "hist", "data-testid": "opt-historical", "aria-pressed": !!props.updateHistorical,
          onClick: () => props.onUpdateHistoricalChange?.(!props.updateHistorical),
        }, "historical"),
        React.createElement("button", {
          key: "subseq", "data-testid": "opt-subsequent", "aria-pressed": !!props.updateSubsequent,
          onClick: () => props.onUpdateSubsequentChange?.(!props.updateSubsequent),
        }, "subsequent"),
        React.createElement("button", {
          key: "link", "data-testid": "link-first-event",
          onClick: () => props.onLink?.(7, "Acme Corp", "series1_20260728"),
        }, "Link event"),
        // The real footer button that enters Log Time mode. Stubbed with a fixed
        // account so a test can reach the panel without driving account selection.
        React.createElement(
          "button",
          {
            key: "logtime",
            "data-testid": "enter-log-time",
            onClick: () => props.onLogTimeMode?.(props.logTimeModeAccount ? null : "Acme Corp"),
          },
          props.logTimeModeAccount ? "Exit Log Time" : "Log Time to Salesforce",
        ),
      ]);
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
vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  fetchSharedLogsForResource: vi.fn(async () => []),
  getLogsForResource: vi.fn(() => []),
  patchLog: vi.fn(),
  getLogs: vi.fn(() => []),
  syncLogsFromBackend: vi.fn(async () => {}),
  addBackendLog: vi.fn(),
  LOG_STORAGE_KEY: "appActivityLog",
}));
vi.mock("../../assets/icons/Calendar.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── Helper ────────────────────────────────────────────────────────────────────

/** One calendar block of a reminder as the server returns it: 15 minutes from its start. */
function reminderRow(overrides: Partial<(typeof mockCalendarEvents)[number]> = {}) {
  return {
    ...mockCalendarEvents[0],
    id: 601,
    title: "Follow up with client",
    start_datetime: "2026-07-30T09:00:00Z",
    end_datetime: "2026-07-30T09:15:00Z",
    calendar_id: "reminders",
    reminder: 1,
    google_event_id: "",
    is_synced: false,
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <AppErrorProvider>
        <NotificationDefaultsProvider>
          <CalendarPage />
        </NotificationDefaultsProvider>
      </AppErrorProvider>
    </MemoryRouter>,
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

  describe("recurring-meeting options on account assignment", () => {
    async function linkAndCaptureBody() {
      let body: Record<string, unknown> | null = null;
      server.use(
        http.post("/api/v1/airtable/categorize/", async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ needs_categorization: false });
        }),
      );
      return { fire: async () => { fireEvent.click(screen.getByTestId("link-first-event")); await waitFor(() => expect(body).not.toBeNull()); return body!; } };
    }

    it("sends both options as false by default", async () => {
      renderPage();
      const { fire } = await linkAndCaptureBody();
      const body = await fire();
      expect(body).toMatchObject({ event_uid: "series1_20260728", update_subsequent: false, update_historical: false });
    });

    it("sends the options the user switched on, and marks the other instances as linked", async () => {
      renderPage();
      let body: Record<string, unknown> | null = null;
      server.use(
        http.post("/api/v1/airtable/categorize/", async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            needs_categorization: false,
            series_updated: { subsequent: 1, historical: 1, uids: ["series1_20260804", "series1_20260721"] },
          });
        }),
      );
      fireEvent.click(await screen.findByTestId("opt-subsequent"));
      fireEvent.click(screen.getByTestId("opt-historical"));
      expect(screen.getByTestId("opt-subsequent")).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByTestId("link-first-event"));
      await waitFor(() => expect(body).toMatchObject({ update_subsequent: true, update_historical: true }));
      await waitFor(() => expect(screen.getByText(/\+2 recurring/)).toBeInTheDocument());
    });
  });

  it("renders FullCalendar stub without a manual sync button", async () => {
    renderPage();
    expect(screen.getByTestId("fullcalendar")).toBeInTheDocument();
    expect(screen.queryByText("Sync Google Calendar")).not.toBeInTheDocument();
  });

  it("the Calendar heading is pushed below the top-right button row so it is never covered", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", { name: "Calendar" });
    const scroller = heading.closest(".overflow-auto") as HTMLElement;
    // The button row is `absolute top-4`; the content must start below it (pt-16 = 64px).
    expect(scroller.className).toMatch(/\bpt-16\b/);
    expect(scroller.className).not.toMatch(/\bpy-8\b/);
  });

  it("syncs with Google when the page opens, and a meeting deleted in Google disappears", async () => {
    let syncBodies: unknown[] = [];
    let deletedInGoogle = false;
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json(deletedInGoogle ? mockCalendarEvents.slice(1) : mockCalendarEvents),
      ),
      http.post("/api/v1/integrations/google/sync/", async ({ request }) => {
        syncBodies.push(await request.json());
        deletedInGoogle = true; // the server removed the cancelled event during this sync
        return HttpResponse.json({ detail: "Sync complete.", event_count: 1, changed: 1 });
      }),
    );
    renderPage();
    await waitFor(() => expect(syncBodies).toEqual([{ auto: true }]));
    await waitFor(() => expect(screen.queryByText(mockCalendarEvents[0].title)).not.toBeInTheDocument());
    expect(screen.getByText(mockCalendarEvents[1].title)).toBeInTheDocument();
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

  it("requests both account lists with a widened page_size, so the Create Event account picker isn't truncated", async () => {
    const requested: string[] = [];
    server.use(
      http.get("/api/v1/airtable/accounts/", ({ request }) => {
        requested.push(request.url);
        return HttpResponse.json({ results: [] });
      }),
      http.get("/api/v1/accounts/accounts/", ({ request }) => {
        requested.push(request.url);
        return HttpResponse.json({ results: [], count: 0 });
      }),
    );
    renderPage();
    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(2));

    // Both endpoints paginate at 50 by default; allAccountsRef feeds the Create Event
    // modal's account picker, so without a widened page_size accounts past the 50th
    // silently never appear there.
    for (const url of requested) expect(url).toContain("page_size=500");
  });

  describe("event colors", () => {
    // Each event type carries its own color, chosen by the user from the palettes in
    // lib/eventColors.ts and stored on their profile. Defaults are pastel, so the
    // grid also has to pick readable text rather than the old hardcoded white.
    const DEFAULTS: Array<[string, string]> = [
      ["meeting", DEFAULT_CATEGORY_COLORS.meeting],
      ["task", DEFAULT_CATEGORY_COLORS.task],
      ["out_of_office", DEFAULT_CATEGORY_COLORS.out_of_office],
      ["focus_time", DEFAULT_CATEGORY_COLORS.focus_time],
      ["working_location", DEFAULT_CATEGORY_COLORS.working_location],
      ["appointment", DEFAULT_CATEGORY_COLORS.appointment],
    ];

    // Loosely typed on purpose: the API can return event_category="" (the Django
    // field is blank=True), which the CalendarEvent type does not model.
    function serveEvent(overrides: Record<string, unknown>) {
      server.use(
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([{ ...mockCalendarEvents[0], ...overrides }]),
        ),
      );
    }

    /** Serve a profile carrying the given calendar_colors preferences. */
    function serveColorPrefs(colors: unknown) {
      server.use(
        http.get("/api/v1/team/profiles/me/", () =>
          HttpResponse.json({ ...mockUserProfile, calendar_colors: colors }),
        ),
      );
    }

    async function renderedEvent() {
      renderPage();
      return await waitFor(() => {
        const found = document.querySelector("[data-testid='calendar-event']");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
    }

    async function renderedColor() {
      return (await renderedEvent()).getAttribute("data-bg-color");
    }

    it.each(DEFAULTS)("colors a %s event %s by default", async (category, color) => {
      serveEvent({ event_category: category });
      expect(await renderedColor()).toBe(color);
    });

    it("gives every event type a distinct default color", () => {
      const colors = Object.values(DEFAULT_CATEGORY_COLORS).map((c) => c.toLowerCase());
      expect(new Set(colors).size).toBe(colors.length);
    });

    it("uses the color the user chose over the default", async () => {
      serveColorPrefs({ categories: { task: "#E5A836" } });
      serveEvent({ event_category: "task" });
      expect(await renderedColor()).toBe("#E5A836");
    });

    it("leaves other types on their defaults when one is customized", async () => {
      serveColorPrefs({ categories: { task: "#E5A836" } });
      serveEvent({ event_category: "focus_time" });
      expect(await renderedColor()).toBe(DEFAULT_CATEGORY_COLORS.focus_time);
    });

    it("colors action items with the action_item type color", async () => {
      serveEvent({ calendar_id: "work_tracking", event_category: "task" });
      expect(await renderedColor()).toBe(DEFAULT_CATEGORY_COLORS.action_item);
    });

    it("lets the user recolor action items too", async () => {
      serveColorPrefs({ categories: { action_item: "#297EA1" } });
      serveEvent({ calendar_id: "work_tracking" });
      expect(await renderedColor()).toBe("#297EA1");
    });

    it("keeps cancelled events gray whatever their category", async () => {
      serveEvent({ status: "cancelled", event_category: "task" });
      expect(await renderedColor()).toBe("#d1d5db");
    });

    it("treats a blank category as a meeting", async () => {
      serveEvent({ event_category: "" });
      expect(await renderedColor()).toBe(DEFAULT_CATEGORY_COLORS.meeting);
    });

    it("falls back to defaults when the profile request fails", async () => {
      server.use(
        http.get("/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 500 })),
      );
      serveEvent({ event_category: "task" });
      expect(await renderedColor()).toBe(DEFAULT_CATEGORY_COLORS.task);
    });

    it("picks dark text on the pastel defaults instead of white", async () => {
      serveEvent({ event_category: "task" });
      const el = await renderedEvent();
      expect(el.getAttribute("data-bg-color")).toBe(DEFAULT_CATEGORY_COLORS.task);
      expect(readableTextColor(DEFAULT_CATEGORY_COLORS.task)).toBe(DARK_TEXT);
    });

    it("borders a near-white fill with a darker edge so it stays visible", async () => {
      serveColorPrefs({ categories: { task: "#F0F9F8" } });
      serveEvent({ event_category: "task" });
      const el = await renderedEvent();
      expect(el.getAttribute("data-bg-color")).toBe("#F0F9F8");
      expect(el.getAttribute("data-border-color")).toBe(borderFor("#F0F9F8"));
      expect(el.getAttribute("data-border-color")).not.toBe("#F0F9F8");
    });

    it("borders a mid-tone fill in its own color", async () => {
      serveEvent({ event_category: "focus_time" });
      const el = await renderedEvent();
      expect(el.getAttribute("data-border-color")).toBe(DEFAULT_CATEGORY_COLORS.focus_time);
    });
  });

  describe("Mark as important!", () => {
    function serveEvent(overrides: Record<string, unknown> = {}) {
      server.use(
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([{ ...mockCalendarEvents[0], google_event_id: "gcal-1", ...overrides }]),
        ),
      );
    }

    async function openMenuOnEvent() {
      renderPage();
      const el = await waitFor(() => {
        const found = document.querySelector("[data-testid='calendar-event']");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      fireEvent.contextMenu(el);
      return el;
    }

    it("offers Mark as important! on right-click", async () => {
      serveEvent();
      await openMenuOnEvent();
      expect(await screen.findByText("Mark as important!")).toBeInTheDocument();
    });

    it("keeps the swatches hidden until Mark as important! is clicked", async () => {
      serveEvent();
      await openMenuOnEvent();
      expect(screen.queryByTestId(`important-swatch-${IMPORTANT_PALETTE[0]}`)).not.toBeInTheDocument();
      fireEvent.click(await screen.findByText("Mark as important!"));
      expect(screen.getByTestId(`important-swatch-${IMPORTANT_PALETTE[0]}`)).toBeInTheDocument();
    });

    it("offers exactly the five 90s colors", async () => {
      serveEvent();
      await openMenuOnEvent();
      fireEvent.click(await screen.findByText("Mark as important!"));
      expect(IMPORTANT_PALETTE).toHaveLength(5);
      for (const swatch of IMPORTANT_PALETTE) {
        expect(screen.getByTestId(`important-swatch-${swatch}`)).toBeInTheDocument();
      }
    });

    it("recolors the event with the chosen color and saves it", async () => {
      let patched: Record<string, unknown> | null = null;
      server.use(
        http.patch("/api/v1/team/profiles/me/", async ({ request }) => {
          patched = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ ...mockUserProfile, ...patched });
        }),
      );
      serveEvent();
      await openMenuOnEvent();
      fireEvent.click(await screen.findByText("Mark as important!"));
      fireEvent.click(screen.getByTestId("important-swatch-#842D78"));

      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", "#842D78");
      });
      expect(patched).toEqual({ calendar_colors: { important: { "gcal-1": "#842D78" } } });
    });

    it("overrides the type color for that one event only", async () => {
      server.use(
        http.get("/api/v1/team/profiles/me/", () =>
          HttpResponse.json({
            ...mockUserProfile,
            calendar_colors: { important: { "gcal-1": "#B2336C" } },
          }),
        ),
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([
            { ...mockCalendarEvents[0], id: 1, google_event_id: "gcal-1", event_category: "task" },
            { ...mockCalendarEvents[1], id: 2, google_event_id: "gcal-2", event_category: "task" },
          ]),
        ),
      );
      renderPage();
      await waitFor(() => {
        expect(document.querySelectorAll("[data-testid='calendar-event']").length).toBe(2);
      });
      const [first, second] = Array.from(document.querySelectorAll("[data-testid='calendar-event']"));
      expect(first).toHaveAttribute("data-bg-color", "#B2336C");
      expect(second).toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.task);
    });

    it("offers a clear action once an event is marked, and drops the override", async () => {
      let patched: Record<string, unknown> | null = null;
      server.use(
        http.get("/api/v1/team/profiles/me/", () =>
          HttpResponse.json({
            ...mockUserProfile,
            calendar_colors: { important: { "gcal-1": "#842D78" } },
          }),
        ),
        http.patch("/api/v1/team/profiles/me/", async ({ request }) => {
          patched = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ ...mockUserProfile, ...patched });
        }),
      );
      serveEvent({ event_category: "task" });
      await openMenuOnEvent();
      fireEvent.click(await screen.findByText("Mark as important!"));
      fireEvent.click(screen.getByText("Clear important color"));

      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.task);
      });
      expect(patched).toEqual({ calendar_colors: { important: {} } });
    });

    it("does not offer a clear action on an unmarked event", async () => {
      serveEvent();
      await openMenuOnEvent();
      fireEvent.click(await screen.findByText("Mark as important!"));
      expect(screen.queryByText("Clear important color")).not.toBeInTheDocument();
    });
  });

  describe("attendance persistence", () => {
    // Regression: this status lived in a `absentEventIds` useState, so it vanished on
    // navigation and refresh. It now lives on CalendarEvent.attended, which means the
    // grid reflects it on first paint with no client-side memory at all.
    const GREY_75 = withAlpha("#d1d5db", 0.75);

    function serveEvent(overrides: Record<string, unknown> = {}) {
      server.use(
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([
            { ...mockCalendarEvents[0], id: 7, google_event_id: "gcal-7", event_category: "task", ...overrides },
          ]),
        ),
      );
    }

    async function firstEvent() {
      return await waitFor(() => {
        const found = document.querySelector("[data-testid='calendar-event']");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
    }

    it("renders a Did-not-attend event grey at 75% opacity on first paint", async () => {
      serveEvent({ attended: false });
      renderPage();
      const el = await firstEvent();
      expect(el).toHaveAttribute("data-bg-color", GREY_75);
      expect(el).toHaveAttribute("data-border-color", "#9ca3af");
    });

    it("uses a translucent grey, not the solid grey of a cancelled event", async () => {
      serveEvent({ attended: false });
      renderPage();
      expect((await firstEvent()).getAttribute("data-bg-color")).not.toBe("#d1d5db");
      expect(GREY_75).toContain("0.75");
    });

    it("leaves an explicitly attended event on its type color", async () => {
      serveEvent({ attended: true });
      renderPage();
      expect((await firstEvent()).getAttribute("data-bg-color")).toBe(DEFAULT_CATEGORY_COLORS.task);
    });

    it("treats a null attendance record as attended", async () => {
      serveEvent({ attended: null });
      renderPage();
      expect((await firstEvent()).getAttribute("data-bg-color")).toBe(DEFAULT_CATEGORY_COLORS.task);
    });

    it("treats a missing attendance field as attended", async () => {
      serveEvent();
      renderPage();
      expect((await firstEvent()).getAttribute("data-bg-color")).toBe(DEFAULT_CATEGORY_COLORS.task);
    });

    it("shows the stored status on the meeting panel", async () => {
      serveEvent({ attended: false });
      renderPage();
      fireEvent.click(await firstEvent());
      const pill = await screen.findByTestId("attendance-toggle");
      expect(pill).toHaveAttribute("data-attended", "false");
      expect(pill).toHaveTextContent("Did not attend");
    });

    it("marking Did not attend PATCHes the attendance action and recolors the event", async () => {
      let body: Record<string, unknown> | null = null;
      let url = "";
      server.use(
        http.patch("/api/v1/scheduler/events/:id/attendance/", async ({ request, params }) => {
          body = (await request.json()) as Record<string, unknown>;
          url = String(params.id);
          return HttpResponse.json({ ...mockCalendarEvents[0], id: 7, attended: false });
        }),
      );
      serveEvent();
      renderPage();
      fireEvent.click(await firstEvent());
      fireEvent.click(await screen.findByTestId("attendance-toggle"));

      await waitFor(() => expect(body).not.toBeNull());
      expect(body).toEqual({ attended: false });
      // The DB primary key, not the google_event_id — FullCalendar strips `id` from
      // extendedProps, so this has to come from the fetched events.
      expect(url).toBe("7");
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", GREY_75);
      });
    });

    it("marking it back sends attended: true and restores the type color", async () => {
      let body: Record<string, unknown> | null = null;
      server.use(
        http.patch("/api/v1/scheduler/events/:id/attendance/", async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ ...mockCalendarEvents[0], id: 7, attended: true });
        }),
      );
      serveEvent({ attended: false });
      renderPage();
      fireEvent.click(await firstEvent());
      fireEvent.click(await screen.findByTestId("attendance-toggle"));

      await waitFor(() => expect(body).toEqual({ attended: true }));
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.task);
      });
    });

    it("survives a remount, the way navigating away and back does", async () => {
      serveEvent({ attended: false });
      const first = render(
        <MemoryRouter>
          <AppErrorProvider>
            <CalendarPage />
          </AppErrorProvider>
        </MemoryRouter>,
      );
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", GREY_75);
      });

      // Unmount entirely — any component-local memory of attendance is gone.
      first.unmount();
      expect(document.querySelector("[data-testid='calendar-event']")).toBeNull();

      renderPage();
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", GREY_75);
      });
    });

    it("rolls back when the server rejects the change", async () => {
      server.use(
        http.patch("/api/v1/scheduler/events/:id/attendance/", () =>
          new HttpResponse(null, { status: 400 }),
        ),
      );
      serveEvent();
      renderPage();
      fireEvent.click(await firstEvent());
      fireEvent.click(await screen.findByTestId("attendance-toggle"));

      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.task);
      });
    });

    it("an important color does not mask a Did-not-attend event", async () => {
      server.use(
        http.get("/api/v1/team/profiles/me/", () =>
          HttpResponse.json({
            ...mockUserProfile,
            calendar_colors: { important: { "gcal-7": "#842D78" } },
          }),
        ),
      );
      serveEvent({ attended: false });
      renderPage();
      expect((await firstEvent()).getAttribute("data-bg-color")).toBe(GREY_75);
    });
  });

  describe("attendance from the right-click menu", () => {
    const GREY_75 = withAlpha("#d1d5db", 0.75);

    function serveEvent(overrides: Record<string, unknown> = {}) {
      server.use(
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([
            { ...mockCalendarEvents[0], id: 7, google_event_id: "gcal-7", event_category: "task", ...overrides },
          ]),
        ),
      );
    }

    function captureAttendancePatch() {
      const seen: { body: Record<string, unknown> | null; id: string } = { body: null, id: "" };
      server.use(
        http.patch("/api/v1/scheduler/events/:id/attendance/", async ({ request, params }) => {
          seen.body = (await request.json()) as Record<string, unknown>;
          seen.id = String(params.id);
          const attended = (seen.body as { attended: boolean }).attended;
          return HttpResponse.json({ ...mockCalendarEvents[0], id: 7, attended });
        }),
      );
      return seen;
    }

    async function openMenu() {
      renderPage();
      const el = await waitFor(() => {
        const found = document.querySelector("[data-testid='calendar-event']");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      fireEvent.contextMenu(el);
      return el;
    }

    it("offers Mark as did not attend on an unmarked meeting", async () => {
      serveEvent();
      await openMenu();
      expect(await screen.findByText("Mark as did not attend")).toBeInTheDocument();
      expect(screen.queryByText("Mark as attended")).not.toBeInTheDocument();
    });

    it("offers Mark as attended once the meeting is marked absent", async () => {
      serveEvent({ attended: false });
      await openMenu();
      expect(await screen.findByText("Mark as attended")).toBeInTheDocument();
      expect(screen.queryByText("Mark as did not attend")).not.toBeInTheDocument();
    });

    it("marking absent from the menu PATCHes and greys the event", async () => {
      const patch = captureAttendancePatch();
      serveEvent();
      await openMenu();
      fireEvent.click(await screen.findByText("Mark as did not attend"));

      await waitFor(() => expect(patch.body).toEqual({ attended: false }));
      expect(patch.id).toBe("7");
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", GREY_75);
      });
    });

    it("marking attended from the menu restores the type color", async () => {
      const patch = captureAttendancePatch();
      serveEvent({ attended: false });
      await openMenu();
      fireEvent.click(await screen.findByText("Mark as attended"));

      await waitFor(() => expect(patch.body).toEqual({ attended: true }));
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.task);
      });
    });

    it("closes the menu after toggling", async () => {
      captureAttendancePatch();
      serveEvent();
      await openMenu();
      fireEvent.click(await screen.findByText("Mark as did not attend"));
      await waitFor(() => {
        expect(screen.queryByText("Mark as did not attend")).not.toBeInTheDocument();
        expect(screen.queryByText("Mark as attended")).not.toBeInTheDocument();
      });
    });

    it("keeps the menu and the meeting panel in agreement", async () => {
      captureAttendancePatch();
      serveEvent();
      const el = await openMenu();
      fireEvent.click(await screen.findByText("Mark as did not attend"));

      // Open the panel for the same event — it must show the new status.
      fireEvent.click(el);
      const pill = await screen.findByTestId("attendance-toggle");
      expect(pill).toHaveAttribute("data-attended", "false");
    });

    it("reflects the stored status on a second right-click rather than a stale snapshot", async () => {
      captureAttendancePatch();
      serveEvent();
      const el = await openMenu();
      fireEvent.click(await screen.findByText("Mark as did not attend"));
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", GREY_75);
      });

      fireEvent.contextMenu(el);
      expect(await screen.findByText("Mark as attended")).toBeInTheDocument();
    });

    it("is not offered on a scheduled action item, which has no event row", async () => {
      server.use(
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([
            {
              ...mockCalendarEvents[0],
              id: 8,
              google_event_id: "scheduled-recABC",
              calendar_id: "work_tracking",
            },
          ]),
        ),
      );
      await openMenu();
      // The menu is open (it offers Copy details for every event type)…
      expect(await screen.findByText("Copy details")).toBeInTheDocument();
      // …but attendance is meaningless here.
      expect(screen.queryByText("Mark as did not attend")).not.toBeInTheDocument();
      expect(screen.queryByText("Mark as attended")).not.toBeInTheDocument();
    });
  });

  describe("Colors popover", () => {
    it("opens from the header button and lists every event type", async () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /Colors/ }));
      const panel = await screen.findByRole("dialog", { name: "Event colors" });
      for (const { label } of EVENT_TYPE_META) {
        expect(within(panel).getByText(label)).toBeInTheDocument();
      }
    });

    it("applies a picked swatch to the calendar and persists it", async () => {
      let patched: Record<string, unknown> | null = null;
      server.use(
        http.patch("/api/v1/team/profiles/me/", async ({ request }) => {
          patched = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ ...mockUserProfile, ...patched });
        }),
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([{ ...mockCalendarEvents[0], event_category: "task" }]),
        ),
      );
      renderPage();
      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']")).not.toBeNull();
      });

      fireEvent.click(screen.getByRole("button", { name: /Colors/ }));
      fireEvent.click(await screen.findByTestId("color-row-task"));
      fireEvent.click(screen.getByTestId("swatch-task-#18363E"));

      await waitFor(() => {
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", "#18363E");
      });
      expect(patched).toEqual({ calendar_colors: { categories: { task: "#18363E" } } });
    });

    it("sits in the calendar toolbar, immediately after the month/week/day group", () => {
      renderPage();
      const order = Array.from(
        document.querySelectorAll<HTMLElement>("[data-fc-button]"),
      ).map((el) => el.dataset.fcButton);
      expect(order.slice(-4)).toEqual([
        "dayGridMonth",
        "timeGridWeek",
        "timeGridDay",
        "colorsButton",
      ]);
    });

    it("stays dismissable by its own trigger despite the outside-click listener", async () => {
      // The trigger is a FullCalendar custom button, so it is not a DOM ancestor of
      // the panel: the panel's mousedown-outside handler would close the panel and
      // the click that follows would reopen it. `ignoreSelector` is what prevents it.
      renderPage();
      const button = screen.getByRole("button", { name: /Colors/ });
      fireEvent.click(button);
      expect(await screen.findByRole("dialog", { name: "Event colors" })).toBeInTheDocument();

      fireEvent.mouseDown(button);
      expect(screen.getByRole("dialog", { name: "Event colors" })).toBeInTheDocument();
      fireEvent.click(button);
      expect(screen.queryByRole("dialog", { name: "Event colors" })).not.toBeInTheDocument();
    });

    it("closes when the header button is clicked again", async () => {
      renderPage();
      const button = screen.getByRole("button", { name: /Colors/ });
      fireEvent.click(button);
      expect(await screen.findByRole("dialog", { name: "Event colors" })).toBeInTheDocument();
      fireEvent.click(button);
      expect(screen.queryByRole("dialog", { name: "Event colors" })).not.toBeInTheDocument();
    });
  });

  it("the Unlinked Events / Accounts button toggles the unlinked view on and off", async () => {
    renderPage();
    const unlinkedBtn = await screen.findByText("Unlinked (2)");
    const wrap = () => document.querySelector("[data-content-view]");

    expect(wrap()).toHaveAttribute("data-content-view", "all");
    expect(unlinkedBtn).toHaveAttribute("data-unlinked-active", "false");

    fireEvent.click(unlinkedBtn);
    await waitFor(() => {
      expect(wrap()).toHaveAttribute("data-content-view", "unlinked");
      expect(unlinkedBtn).toHaveAttribute("data-unlinked-active", "true");
    });

    // Clicking again turns it back off rather than being a no-op.
    fireEvent.click(unlinkedBtn);
    await waitFor(() => {
      expect(wrap()).toHaveAttribute("data-content-view", "all");
      expect(unlinkedBtn).toHaveAttribute("data-unlinked-active", "false");
    });
  });

  it("restores the prior content view after Log Time mode is closed, instead of leaving the grid stuck on one account", async () => {
    renderPage();
    const wrap = () => document.querySelector("[data-content-view]");
    const logTimeBtn = await screen.findByTestId("enter-log-time");

    // Starting from "all", entering Log Time force-switches the grid to that account only.
    expect(wrap()).toHaveAttribute("data-content-view", "all");
    fireEvent.click(logTimeBtn);
    await waitFor(() => {
      expect(wrap()).toHaveAttribute("data-content-view", "accounts");
      expect(screen.getByTestId("enter-log-time")).toHaveTextContent("Exit Log Time");
    });

    // Closing it must put the grid back to "all" — not leave it silently filtered to
    // one account, which is what made the calendar look empty after Log Time was used.
    fireEvent.click(screen.getByTestId("enter-log-time"));
    await waitFor(() => {
      expect(wrap()).toHaveAttribute("data-content-view", "all");
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

  describe("meeting invites", () => {
    async function createWithGuests(googleSync: Record<string, unknown>) {
      let body: Record<string, unknown> | null = null;
      server.use(
        http.post("/api/v1/scheduler/events/", async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { ...mockCalendarEvents[0], id: 99, title: "Kickoff", google_sync: googleSync },
            { status: 201 },
          );
        }),
      );
      renderPage();
      await screen.findByTestId("fullcalendar");
      fireEvent.click(screen.getByTestId("trigger-date-select"));
      fireEvent.change(await screen.findByTestId("mock-title-input"), { target: { value: "Kickoff" } });
      fireEvent.click(screen.getByRole("button", { name: "Create and invite" }));
      await waitFor(() => expect(body).not.toBeNull());
      return body as unknown as Record<string, unknown>;
    }

    it("forwards the modal's send-invites answer to the API", async () => {
      const body = await createWithGuests({ status: "ok", invites_sent: true });
      expect(body.send_invites).toBe(true);
      expect((body.attendees as unknown[]).length).toBe(2);
      expect(await screen.findByText('Created "Kickoff" and emailed 2 guests')).toBeInTheDocument();
    });

    it("warns when Google is not connected instead of claiming success", async () => {
      await createWithGuests({ status: "not_connected", invites_sent: false });
      expect(await screen.findByText(/connect Google Calendar in Settings to send invites/)).toBeInTheDocument();
    });

    it("warns when Google rejected the event", async () => {
      await createWithGuests({ status: "failed", invites_sent: false });
      expect(await screen.findByText(/guests were not invited/)).toBeInTheDocument();
    });
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

  describe("sidebar colors follow the user's preferences", () => {
    const ACTION_COLOR = "#842D78"; // 90s purple
    const REMINDER_COLOR = "#174DB1"; // 90s blue

    function withColors(categories: Record<string, string>) {
      server.use(
        http.get("/api/v1/team/profiles/me/", () =>
          HttpResponse.json({ ...mockUserProfile, calendar_colors: { categories } }),
        ),
      );
    }

    /** The one mounted sidebar card. Only one tab is mounted at a time. */
    const card = () => document.querySelector<HTMLElement>("[data-accent]");

    it("paints action-item cards in the configured action-item color", async () => {
      withColors({ action_item: ACTION_COLOR });
      renderPage();

      await waitFor(() => expect(card()).not.toBeNull());
      expect(card()).toHaveAttribute("data-accent", ACTION_COLOR);
      expect(card()).toHaveStyle({ borderLeftColor: ACTION_COLOR });
      // The fill is a wash of the accent so the card text stays readable.
      expect(card()).toHaveStyle({ backgroundColor: tint(ACTION_COLOR, 0.9) });
    });

    it("paints the New Action Item button in the same color", async () => {
      withColors({ action_item: ACTION_COLOR });
      renderPage();

      const newBtn = await screen.findByRole("button", { name: "+ New Action Item" });
      expect(newBtn).toHaveStyle({ backgroundColor: ACTION_COLOR });
      expect(newBtn).toHaveStyle({ color: readableTextColor(ACTION_COLOR) });
    });

    it("paints reminder cards in the configured reminder color", async () => {
      withColors({ reminder: REMINDER_COLOR });
      renderPage();

      // Switching to the Reminders content view forces the reminders tab.
      fireEvent.click(document.querySelector("[data-fc-button='viewReminders']")!);

      await waitFor(() => {
        expect(screen.getByText("Follow up with client")).toBeInTheDocument();
      });
      expect(card()).toHaveAttribute("data-accent", REMINDER_COLOR);
      expect(card()).toHaveStyle({ borderLeftColor: REMINDER_COLOR });
      expect(card()).toHaveStyle({ backgroundColor: tint(REMINDER_COLOR, 0.9) });
    });

    it("falls back to the shipped reminder default when nothing is stored", async () => {
      renderPage();
      fireEvent.click(document.querySelector("[data-fc-button='viewReminders']")!);

      await waitFor(() => {
        expect(screen.getByText("Follow up with client")).toBeInTheDocument();
      });
      expect(card()).toHaveAttribute("data-accent", DEFAULT_CATEGORY_COLORS.reminder);
    });

    it("repaints the reminders sidebar as soon as a reminder color is picked", async () => {
      renderPage();
      fireEvent.click(document.querySelector("[data-fc-button='viewReminders']")!);
      await waitFor(() => {
        expect(screen.getByText("Follow up with client")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /Colors/ }));
      fireEvent.click(await screen.findByTestId("color-row-reminder"));
      fireEvent.click(screen.getByTestId(`swatch-reminder-${REMINDER_COLOR}`));

      await waitFor(() => {
        expect(card()).toHaveAttribute("data-accent", REMINDER_COLOR);
      });
    });

    it("paints a scheduled reminder on the grid from the same reminder color", async () => {
      // A reminder is a server-side row on the "reminders" calendar. It resolves as a reminder
      // (not an action item) and keeps its washed fill with the accent as the edge.
      server.use(http.get("/api/v1/scheduler/events/", () => HttpResponse.json([reminderRow()])));
      withColors({ reminder: REMINDER_COLOR });
      renderPage();

      await waitFor(() => {
        const marker = document.querySelector<HTMLElement>(
          "[data-testid='calendar-event'][data-border-color='#174DB1']",
        );
        expect(marker).not.toBeNull();
        expect(marker).toHaveAttribute("data-bg-color", tint(REMINDER_COLOR, 0.9));
      });
    });
  });
});

// ── Reminders on the calendar ─────────────────────────────────────────────────

describe("CalendarPage — reminders on the calendar", () => {
  const DUE_LOCAL = "2026-12-01T15:00";
  const view = (name: string) => fireEvent.click(document.querySelector(`[data-fc-button='${name}']`)!);
  const markers = () => Array.from(document.querySelectorAll<HTMLElement>("[data-testid='calendar-event']"));

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function serveMarker() {
    server.use(http.get("/api/v1/scheduler/events/", () => HttpResponse.json([reminderRow()])));
  }

  async function openForm() {
    renderPage();
    view("viewReminders"); // forces the Reminders tab
    fireEvent.click(await screen.findByRole("button", { name: "+ New Reminder" }));
    return screen.findByPlaceholderText("Reminder title");
  }

  function captureReminderPosts() {
    const posts: Array<Record<string, unknown>> = [];
    let eventPosts = 0;
    server.use(
      http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posts.push(body);
        return HttpResponse.json({ id: 99, recipients: [], recipient_details: [], occurrences: [], status: "pending", ...body }, { status: 201 });
      }),
      http.post("/api/v1/scheduler/events/", () => { eventPosts++; return HttpResponse.json({}, { status: 201 }); }),
    );
    return { posts, eventPosts: () => eventPosts };
  }

  it("shows a reminder on the grid for 15 minutes from its start time", async () => {
    serveMarker();
    renderPage();
    await waitFor(() => expect(markers()).toHaveLength(1));
    const [marker] = markers();
    expect(marker).toHaveTextContent("Follow up with client");
    expect(marker.dataset.start).toBe("2026-07-30T09:00:00Z");
    expect(new Date(marker.dataset.end!).getTime() - new Date(marker.dataset.start!).getTime()).toBe(15 * 60_000);
  });

  it("lists the reminder in the Reminders view", async () => {
    serveMarker();
    renderPage();
    await waitFor(() => expect(markers()).toHaveLength(1));
    view("viewReminders");
    await waitFor(() => expect(markers()).toHaveLength(1));
  });

  it("keeps the reminder out of the Meetings and Action items views", async () => {
    serveMarker();
    renderPage();
    await waitFor(() => expect(markers()).toHaveLength(1));
    view("viewMeetings");
    await waitFor(() => expect(markers()).toHaveLength(0));
    view("viewActionItems");
    await waitFor(() => expect(markers()).toHaveLength(0));
  });

  it("shows the same reminder at every time it has been added to the calendar", async () => {
    server.use(http.get("/api/v1/scheduler/events/", () => HttpResponse.json([
      reminderRow(),
      reminderRow({ id: 602, start_datetime: "2026-07-31T14:00:00Z", end_datetime: "2026-07-31T14:15:00Z" }),
    ])));
    renderPage();
    await waitFor(() => expect(markers()).toHaveLength(2));
    expect(markers().map((m) => m.dataset.start)).toEqual(["2026-07-30T09:00:00Z", "2026-07-31T14:00:00Z"]);
  });

  it("creating a reminder saves the due time the user picked (their local time) and adds no calendar row itself", async () => {
    const { posts, eventPosts } = captureReminderPosts();
    const title = await openForm();
    fireEvent.change(title, { target: { value: "Call Acme" } });
    fireEvent.change(document.querySelector('input[type="datetime-local"]')!, { target: { value: DUE_LOCAL } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    // The wall clock the user typed, as the real instant — not read as UTC by the server.
    expect(posts[0].due_at).toBe(new Date(DUE_LOCAL).toISOString());
    expect(posts[0]).toMatchObject({ title: "Call Acme", links: [], notify_in_app: true, recipients: [] });
    expect(posts[0]).not.toHaveProperty("confirm_notify_others");
    // The server owns the marker; the client no longer creates a block with its own times.
    expect(eventPosts()).toBe(0);
  });

  it("uses the notification channels from Settings, not just in-app", async () => {
    server.use(http.get("/api/v1/team/profiles/me/", () => HttpResponse.json({
      ...mockUserProfile, notify_default_in_app: true, notify_default_push: true, notify_default_sms: true,
    })));
    const { posts } = captureReminderPosts();
    const title = await openForm();
    // Settings load asynchronously; the form must use them once they have.
    await waitFor(async () => {
      fireEvent.change(title, { target: { value: "Call Acme" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    });
    expect(posts[0]).toMatchObject({ notify_in_app: true, notify_push: true, notify_sms: true, notify_slack: false });
  });

  it("lists every time the reminder is on the calendar and can take one off", async () => {
    const removed: string[] = [];
    server.use(
      http.get("/api/v1/scheduler/reminders/", () => HttpResponse.json({ results: [{
        ...mockReminders[0],
        occurrences: [
          { id: 11, start: "2026-07-30T09:00:00Z", end: "2026-07-30T09:15:00Z" },
          { id: 12, start: "2026-07-31T14:00:00Z", end: "2026-07-31T14:15:00Z" },
        ],
      }], count: 1 })),
      http.delete("/api/v1/scheduler/reminders/:id/occurrences/:eventId/", ({ params }) => {
        removed.push(String(params.eventId));
        return HttpResponse.json({ ...mockReminders[0], occurrences: [] });
      }),
    );
    renderPage();
    view("viewReminders");
    const list = await screen.findByTestId("reminder-occurrences");
    expect(list).toHaveTextContent("On the calendar");
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(list).toHaveTextContent(new Date("2026-07-31T14:00:00Z").toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));

    fireEvent.click(within(list).getAllByRole("button")[1]);
    await waitFor(() => expect(removed).toEqual(["12"]));
  });

  it("says so when the reminder is not on the calendar yet", async () => {
    renderPage();
    view("viewReminders");
    const [first] = await screen.findAllByTestId("reminder-occurrences");
    expect(first).toHaveTextContent("Not on the calendar");
  });

  describe("clicking a reminder on the calendar", () => {
    const START = "2026-07-30T09:00:00Z";

    it("shows its time in the user's time zone, matching the grid — not UTC", async () => {
      serveMarker();
      renderPage();
      fireEvent.click((await screen.findAllByTestId("calendar-event"))[0]);
      const input = await waitFor(() => {
        const el = document.querySelector<HTMLInputElement>('input[type="datetime-local"]');
        expect(el).not.toBeNull();
        return el!;
      });
      expect(input.value).toBe(toLocalDatetimeValue(START));
      expect(screen.getByText("Reminds at (15 min)")).toBeInTheDocument();
    });

    it("moves just that block when the time is changed, and renames the reminder", async () => {
      serveMarker();
      const moves: Array<{ url: string; body: Record<string, unknown> }> = [];
      const renames: Array<Record<string, unknown>> = [];
      server.use(
        http.patch("/api/v1/scheduler/reminders/:id/occurrences/:eventId/", async ({ request }) => {
          moves.push({ url: new URL(request.url).pathname, body: (await request.json()) as Record<string, unknown> });
          return HttpResponse.json(mockReminders[0]);
        }),
        http.patch("/api/v1/scheduler/reminders/:id/", async ({ request }) => {
          renames.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(mockReminders[0]);
        }),
      );
      renderPage();
      fireEvent.click((await screen.findAllByTestId("calendar-event"))[0]);
      const input = await waitFor(() => {
        const el = document.querySelector<HTMLInputElement>('input[type="datetime-local"]');
        expect(el).not.toBeNull();
        return el!;
      });
      fireEvent.change(input, { target: { value: DUE_LOCAL } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(moves).toHaveLength(1));
      // This block's own id (601), and the real instant for the local time typed.
      expect(moves[0].url).toBe("/api/v1/scheduler/reminders/1/occurrences/601/");
      expect(moves[0].body.start).toBe(new Date(DUE_LOCAL).toISOString());
      // The reminder's due time is not patched from here: only title/notes go to the reminder.
      expect(renames.every((r) => !("due_at" in r))).toBe(true);
    });

    it("does not move the block when only the title changes", async () => {
      serveMarker();
      let moves = 0;
      server.use(http.patch("/api/v1/scheduler/reminders/:id/occurrences/:eventId/", () => { moves++; return HttpResponse.json(mockReminders[0]); }));
      renderPage();
      fireEvent.click((await screen.findAllByTestId("calendar-event"))[0]);
      const title = await screen.findByDisplayValue("Follow up with client");
      fireEvent.change(title, { target: { value: "Renamed" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
      expect(moves).toBe(0);
    });
  });

  describe("the reminders sidebar sections", () => {
    // Local noon on the day the fixtures use, with only Date faked: the page's own interval, MSW
    // and testing-library's polling all keep working on real timers.
    const NOW = new Date(2026, 6, 30, 12, 0, 0);
    const iso = (day: number, h: number, m = 0) => new Date(2026, 6, day, h, m).toISOString();
    const rem = (id: number, title: string, due_at: string, over: Record<string, unknown> = {}) => ({
      ...mockReminders[0], id, title, due_at, status: "pending", occurrences: [], ...over,
    });
    const serve = (reminders: unknown[]) =>
      server.use(http.get("/api/v1/scheduler/reminders/", () => HttpResponse.json({ results: reminders, count: reminders.length })));
    const section = (key: string) => {
      const header = document.querySelector<HTMLElement>(`[data-section='${key}']`)!;
      const cards: string[] = [];
      for (let el = header.nextElementSibling; el && !el.matches("[data-section]"); el = el.nextElementSibling) {
        const t = el.querySelector("p.text-\\[13px\\]")?.textContent;
        if (t) cards.push(t);
      }
      return { header: header.textContent ?? "", cards };
    };

    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
    afterEach(() => vi.useRealTimers());

    async function open() {
      renderPage();
      view("viewReminders");
      await screen.findByText("Today", { selector: "h3" }, { timeout: 4000 });
    }

    it("sorts every reminder into Today, Upcoming or Historical", async () => {
      serve([
        rem(1, "Later today", iso(30, 15)),
        rem(2, "Tomorrow", iso(31, 9)),
        rem(3, "Yesterday", iso(29, 9)),
        rem(4, "Done and dismissed", iso(20, 9), { status: "dismissed" }),
        rem(5, "Earlier today", iso(30, 8), { status: "sent" }),
      ]);
      await open();
      await waitFor(() => expect(section("today").cards).toEqual(["Later today"]));
      expect(section("upcoming").cards).toEqual(["Tomorrow"]);
      expect(section("historical").cards).toEqual(["Earlier today", "Yesterday", "Done and dismissed"]);
      expect(section("today").header).toContain("(1)");
    });

    it("asks for every reminder, not just pending ones", async () => {
      let status: string | null = "unset";
      server.use(http.get("/api/v1/scheduler/reminders/", ({ request }) => {
        status = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({ results: [], count: 0 });
      }));
      await open().catch(() => {});
      await waitFor(() => expect(status).toBeNull());
    });

    it("moves a reminder from Today to Historical once its time has finished, without a reload", async () => {
      serve([rem(1, "Soon", iso(30, 12, 10))]);
      await open();
      await waitFor(() => expect(section("today").cards).toEqual(["Soon"]));
      // Still inside its 15 minutes at 12:20.
      vi.setSystemTime(new Date(2026, 6, 30, 12, 20));
      await new Promise((r) => setTimeout(r, 200));
      expect(section("today").cards).toEqual(["Soon"]);
      // Over at 12:25.
      vi.setSystemTime(new Date(2026, 6, 30, 12, 10).getTime() + OCCURRENCE_MS + 1000);
      await waitFor(() => expect(section("historical").cards).toEqual(["Soon"]));
      expect(section("today").cards).toEqual([]);
    });

    it("files a reminder by the next unfinished time it is on the calendar", async () => {
      serve([rem(1, "Twice", iso(29, 9), {
        occurrences: [
          { id: 1, start: iso(29, 9), end: iso(29, 9, 15) },
          { id: 2, start: iso(31, 14), end: iso(31, 14, 15) },
        ],
      })]);
      await open();
      await waitFor(() => expect(section("upcoming").cards).toEqual(["Twice"]));
    });

    it("shows ten past reminders and offers the rest", async () => {
      serve(Array.from({ length: 12 }, (_, i) => rem(i + 1, `Old ${i + 1}`, iso(1 + i, 9), { status: "sent" })));
      await open();
      await waitFor(() => expect(section("historical").cards).toHaveLength(10));
      fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
      await waitFor(() => expect(section("historical").cards).toHaveLength(12));
      expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
    });

    it("says what is empty in each section", async () => {
      serve([rem(1, "Tomorrow", iso(31, 9))]);
      await open();
      expect(await screen.findByText("Nothing else today.")).toBeInTheDocument();
      expect(screen.getByText("No past reminders.")).toBeInTheDocument();
    });

    describe("snoozing", () => {
      const snoozeBody = () => {
        const bodies: Array<Record<string, unknown>> = [];
        server.use(http.post("/api/v1/scheduler/reminders/:id/snooze/", async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          bodies.push(body);
          return HttpResponse.json({ ...mockReminders[0], id: 1, title: "Prep QBR", status: "pending",
            due_at: (body.until as string) ?? iso(30, 14), occurrences: [] });
        }));
        return bodies;
      };
      const openMenu = async () => {
        await open();
        fireEvent.click(await screen.findByRole("button", { name: /Snooze Prep QBR/ }));
        return screen.findByRole("menu", { name: "Snooze until" });
      };

      it("lists Custom first, then the ready-made options", async () => {
        serve([rem(1, "Prep QBR", iso(30, 15), { resource_type: "account", resource_id: 1 })]);
        const menu = await openMenu();
        expect(within(menu).getAllByRole("menuitem").map((b) => b.querySelector("span")?.textContent ?? b.textContent)).toEqual([
          "Custom…", "15 minutes later", "Before end of day", "Tomorrow morning", "Before next account meeting",
        ]);
      });

      it("15 minutes later sends a time 15 minutes from now and updates the card", async () => {
        serve([rem(1, "Prep QBR", iso(30, 12, 5))]);
        const bodies = snoozeBody();
        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole("menuitem", { name: /15 minutes later/ }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        // `from` is the time the card sits under, so that calendar block is the one that moves.
        expect(bodies[0]).toEqual({ until: new Date(2026, 6, 30, 12, 15).toISOString(), from: iso(30, 12, 5) });
        await waitFor(() => expect(screen.queryByRole("menu", { name: "Snooze until" })).toBeNull());
      });

      it("before end of day is 5 PM today and tomorrow morning is 9 AM tomorrow", async () => {
        serve([rem(1, "Prep QBR", iso(30, 12, 5))]);
        const bodies = snoozeBody();
        let menu = await openMenu();
        fireEvent.click(within(menu).getByRole("menuitem", { name: /Before end of day/ }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0]).toEqual({ until: new Date(2026, 6, 30, 17, 0).toISOString(), from: iso(30, 12, 5) });

        fireEvent.click(await screen.findByRole("button", { name: /Snooze Prep QBR/ }));
        menu = await screen.findByRole("menu", { name: "Snooze until" });
        fireEvent.click(within(menu).getByRole("menuitem", { name: /Tomorrow morning/ }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        // (This fake server re-serves the original reminder, so the card is back under 12:05.)
        expect(bodies[1]).toEqual({ until: new Date(2026, 6, 31, 9, 0).toISOString(), from: iso(30, 12, 5) });
      });

      it("Custom lets the user pick any future time", async () => {
        serve([rem(1, "Prep QBR", iso(30, 12, 5))]);
        const bodies = snoozeBody();
        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Custom…" }));
        const input = within(menu).getByLabelText("Snooze until");
        fireEvent.change(input, { target: { value: "2026-08-03T10:30" } });
        fireEvent.click(within(menu).getByRole("button", { name: "Snooze" }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0]).toEqual({ until: new Date("2026-08-03T10:30").toISOString(), from: iso(30, 12, 5) });
      });

      it("Custom refuses a time that has already passed", async () => {
        serve([rem(1, "Prep QBR", iso(30, 12, 5))]);
        const bodies = snoozeBody();
        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Custom…" }));
        fireEvent.change(within(menu).getByLabelText("Snooze until"), { target: { value: "2026-07-29T10:30" } });
        const go = within(menu).getByRole("button", { name: "Snooze" });
        expect(go).toBeDisabled();
        fireEvent.click(go);
        expect(bodies).toHaveLength(0);
      });

      it("before the next account meeting asks the server, and is unavailable without an account", async () => {
        serve([
          rem(1, "Prep QBR", iso(30, 15), { resource_type: "account", resource_id: 1 }),
          rem(2, "Loose end", iso(30, 16)),
        ]);
        const bodies = snoozeBody();
        await open();
        fireEvent.click(await screen.findByRole("button", { name: /Snooze Loose end/ }));
        const noAccount = within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Before next account meeting/ });
        expect(noAccount).toBeDisabled();
        expect(noAccount).toHaveAttribute("title", expect.stringContaining("Link this reminder to an account"));

        fireEvent.click(screen.getByRole("button", { name: "Cancel" })); // close the first menu
        fireEvent.click(screen.getByRole("button", { name: /Snooze Prep QBR/ }));
        const menu = await screen.findByRole("menu", { name: "Snooze until" });
        fireEvent.click(within(menu).getByRole("menuitem", { name: /Before next account meeting/ }));
        await waitFor(() => expect(bodies).toEqual([{ preset: "next_account_meeting", from: iso(30, 15) }]));
      });

      it("shows the server's reason and keeps the menu open when it refuses", async () => {
        serve([rem(1, "Prep QBR", iso(30, 15), { resource_type: "account", resource_id: 1 })]);
        server.use(http.post("/api/v1/scheduler/reminders/:id/snooze/", () =>
          HttpResponse.json({ until: "There is no upcoming meeting on this account to snooze it before." }, { status: 400 })));
        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole("menuitem", { name: /Before next account meeting/ }));
        expect(await within(menu).findByRole("alert")).toHaveTextContent("no upcoming meeting");
        expect(screen.getByRole("menu", { name: "Snooze until" })).toBeInTheDocument();
      });

      it("a historical reminder can be snoozed back to life", async () => {
        serve([rem(1, "Prep QBR", iso(28, 9), { status: "sent" })]);
        const bodies = snoozeBody();
        const menu = await openMenu();
        fireEvent.click(within(menu).getByRole("menuitem", { name: /15 minutes later/ }));
        await waitFor(() => expect(bodies).toHaveLength(1));
      });
    });
  });

  describe("dragging a reminder on the calendar", () => {
    const TO = "2026-07-31T15:30:00.000Z";
    const g = globalThis as Record<string, unknown>;
    beforeEach(() => { g.__TEST_EVENT_DROP_TO__ = TO; g.__TEST_REVERTED__ = false; });

    it("lets a reminder block be dragged to another time, but not stretched", async () => {
      serveMarker();
      renderPage();
      const [block] = await screen.findAllByTestId("calendar-event");
      expect(block.dataset.editable).toBe("true");
      expect(block.dataset.durationEditable).toBe("false");
    });

    it("moves just that block: one request with the new time, the block keeps its 15 minutes", async () => {
      // A server that remembers the move, as the real one does: the page re-reads the calendar
      // afterwards and must get the block back at the new time.
      let row = reminderRow();
      const moves: Array<{ url: string; body: Record<string, unknown> }> = [];
      let eventPatches = 0;
      server.use(
        http.get("/api/v1/scheduler/events/", () => HttpResponse.json([row])),
        http.patch("/api/v1/scheduler/reminders/:id/occurrences/:eventId/", async ({ request }) => {
          const body = (await request.json()) as { start: string };
          moves.push({ url: new URL(request.url).pathname, body });
          row = { ...row, start_datetime: body.start, end_datetime: new Date(new Date(body.start).getTime() + 15 * 60_000).toISOString() };
          return HttpResponse.json(mockReminders[0]);
        }),
        // A reminder must never go through the meeting path (which would push it to Google).
        http.patch("/api/v1/scheduler/events/:id/", () => { eventPatches++; return HttpResponse.json({}); }),
      );
      renderPage();
      fireEvent.doubleClick((await screen.findAllByTestId("calendar-event"))[0]);

      await waitFor(() => expect(moves).toHaveLength(1));
      expect(moves[0].url).toBe("/api/v1/scheduler/reminders/1/occurrences/601/");
      expect(moves[0].body).toEqual({ start: TO });
      // The block is redrawn at the new time straight away.
      await waitFor(() => expect(markers()[0].dataset.start).toBe(TO));
      expect(new Date(markers()[0].dataset.end!).getTime() - new Date(TO).getTime()).toBe(15 * 60_000);
      expect(eventPatches).toBe(0);
    });

    it("puts the block back and says why when the move is refused", async () => {
      serveMarker();
      server.use(http.patch("/api/v1/scheduler/reminders/:id/occurrences/:eventId/", () =>
        HttpResponse.json({ start: "The reminder is already on the calendar at that time." }, { status: 400 })));
      renderPage();
      fireEvent.doubleClick((await screen.findAllByTestId("calendar-event"))[0]);

      await waitFor(() => expect(g.__TEST_REVERTED__).toBe(true));
      await waitFor(() => expect(markers()[0].dataset.start).toBe("2026-07-30T09:00:00Z"));
      expect(await screen.findByText(/already on the calendar at that time/)).toBeInTheDocument();
    });

    it("announces the change so the sidebar's list of times updates", async () => {
      serveMarker();
      server.use(http.patch("/api/v1/scheduler/reminders/:id/occurrences/:eventId/", () => HttpResponse.json(mockReminders[0])));
      let reminderGets = 0;
      server.use(http.get("/api/v1/scheduler/reminders/", () => { reminderGets++; return HttpResponse.json({ results: mockReminders, count: 1 }); }));
      renderPage();
      view("viewReminders");
      await waitFor(() => expect(reminderGets).toBeGreaterThan(0));
      const before = reminderGets;
      fireEvent.doubleClick((await screen.findAllByTestId("calendar-event"))[0]);
      await waitFor(() => expect(reminderGets).toBeGreaterThan(before));
    });
  });

  describe("the sidebar's form matches the Reminders page", () => {
    it("offers the same fields", async () => {
      await openForm();
      expect(screen.getByPlaceholderText("Reminder title")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Notes (optional)")).toBeInTheDocument();
      expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull();
      expect(screen.getByTestId("reminder-links-field")).toBeInTheDocument();
      expect(screen.getByTestId("recipients-hint")).toBeInTheDocument(); // the "also notify" picker, nothing linked yet
      const channels = screen.getByRole("group", { name: "Notify me via" });
      expect(within(channels).getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["In-app", "Laptop", "Phone", "Slack"]);
    });

    it("can link to any of the record types, not only an account", async () => {
      await openForm();
      const field = screen.getByTestId("reminder-links-field");
      fireEvent.click(within(field).getByRole("button", { name: /\+ Link/ }));
      expect(within(field).getAllByRole("option").length).toBeGreaterThan(0); // accounts, by default
      fireEvent.change(within(field).getByLabelText("Record type"), { target: { value: "action_item" } });
      expect(await within(field).findByRole("option", { name: /Draft QBR deck/ })).toBeInTheDocument();
    });

    it("pre-ticks the user's Settings channels and says teammates are reached their own way", async () => {
      server.use(http.get("/api/v1/team/profiles/me/", () => HttpResponse.json({
        ...mockUserProfile, notify_default_in_app: true, notify_default_push: true, notify_default_sms: false,
      })));
      await openForm();
      const channels = screen.getByRole("group", { name: "Notify me via" });
      await waitFor(() => expect(within(channels).getByRole("checkbox", { name: "Laptop" })).toBeChecked());
      expect(within(channels).getByRole("checkbox", { name: "Phone" })).not.toBeChecked();
      expect(screen.getByText(/Anyone you add under .Also notify. is reached the way they chose in their own Settings/)).toBeInTheDocument();
    });

    it("sends the creator's channel choices, and the same fields the Reminders page sends", async () => {
      const { posts } = captureReminderPosts();
      const title = await openForm();
      fireEvent.change(title, { target: { value: "Ping" } });
      fireEvent.click(within(screen.getByRole("group", { name: "Notify me via" })).getByRole("checkbox", { name: "Phone" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({ notify_sms: true, recipients: [] });
      const { buildReminderPayload } = await import("../../lib/reminderDraft");
      const expected = buildReminderPayload({
        title: "x", body: "", dueLocal: "2026-12-01T10:00", links: [], recipients: [],
        channels: { notify_in_app: true, notify_push: false, notify_sms: false, notify_slack: false },
      });
      expect(Object.keys(posts[0]).sort()).toEqual(Object.keys(expected).sort());
    });

    it("lists a teammate who has never signed in, but will not let you pick them", async () => {
      server.use(http.get("/api/v1/scheduler/reminders/recipients/", () => HttpResponse.json({
        results: [{ user_id: null, member_id: 61, name: "Pat Nologin", available: false,
          reason: "Pat Nologin hasn't signed in to AgentPM yet, so there is no way to notify them in the app.", accounts: ["Acme Corp"] }],
        sources: ["Acme Corp"], accounts: ["Acme Corp"],
      })));
      await openForm();
      await linkAcme();
      fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
      const pat = await screen.findByRole("checkbox", { name: /Pat Nologin/ });
      expect(pat).toBeDisabled();
      expect(screen.getByTestId("recipient-m61")).toHaveAttribute("title", expect.stringContaining("hasn't signed in"));
    });
  });

  it("re-reads the calendar after a reminder is created so the marker appears", async () => {
    let eventGets = 0;
    server.use(http.get("/api/v1/scheduler/events/", () => { eventGets++; return HttpResponse.json([]); }));
    captureReminderPosts();
    const title = await openForm();
    await waitFor(() => expect(eventGets).toBeGreaterThan(0));
    const before = eventGets;
    fireEvent.change(title, { target: { value: "Call Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(eventGets).toBeGreaterThan(before));
  });

  it("links the reminder to the chosen account", async () => {
    const { posts } = captureReminderPosts();
    const title = await openForm();
    fireEvent.change(title, { target: { value: "Prep QBR" } });
    await linkAcme();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].links).toEqual([{ resource_type: "account", resource_id: 1, resource_label: "Acme Corp" }]);
    expect(posts[0].recipients).toEqual([]); // default: only me
    expect(posts[0]).not.toHaveProperty("confirm_notify_others");
  });

  it("offers teammates only once an account is chosen", async () => {
    await openForm();
    expect(screen.getByTestId("recipients-hint")).toHaveTextContent("Notifies only you");
    expect(screen.queryByRole("button", { name: "Notify teammates" })).toBeNull();
  });

  /** Link Acme Corp the way the Reminders page does: the shared "link to records" field. */
  async function linkAcme() {
    const field = screen.getByTestId("reminder-links-field");
    fireEvent.click(within(field).getByRole("button", { name: /\+ Link/ }));
    fireEvent.mouseDown(await within(field).findByRole("option", { name: /Acme Corp/ }));
  }
  async function chooseAccountAndOpenTeammates() {
    await linkAcme();
    fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
    await screen.findByTestId("recipient-2");
  }

  it("lists everyone on the account but will not let you pick someone who opted out, and says why", async () => {
    await openForm();
    await chooseAccountAndOpenTeammates();

    const ana = screen.getByRole("checkbox", { name: "Ana Reyes" });
    const ben = screen.getByRole("checkbox", { name: /Ben Ortiz/ });
    expect(ana).toBeEnabled();
    expect(ben).toBeDisabled();
    expect(screen.getByTestId("recipient-3")).toHaveAttribute(
      "title", expect.stringContaining("has turned off being notified by other users"),
    );
    fireEvent.click(ben);
    expect(ben).not.toBeChecked();
  });

  it("asks 'are you sure?' before notifying anyone else, and sends nothing until they say yes", async () => {
    const { posts } = captureReminderPosts();
    const title = await openForm();
    fireEvent.change(title, { target: { value: "Prep QBR" } });
    await chooseAccountAndOpenTeammates();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana Reyes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Are you sure you want to notify these users?");
    expect(dialog).toHaveTextContent("Ana Reyes");
    expect(posts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, notify them" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ recipients: [2], confirm_notify_others: true });
    expect(posts[0].links).toEqual([{ resource_type: "account", resource_id: 1, resource_label: "Acme Corp" }]);
  });

  it("shows the server's reason when it refuses a recipient and keeps the form open", async () => {
    server.use(http.post("/api/v1/scheduler/reminders/", () =>
      HttpResponse.json({ recipients: ["Ana Reyes has turned off being notified by other users in their Settings."] }, { status: 400 })));
    const title = await openForm();
    fireEvent.change(title, { target: { value: "Prep QBR" } });
    await chooseAccountAndOpenTeammates();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana Reyes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, notify them" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("turned off being notified");
    expect(screen.getByPlaceholderText("Reminder title")).toHaveValue("Prep QBR");
  });

  it("unlinking the record that reached them clears teammates picked through it", async () => {
    await openForm();
    await chooseAccountAndOpenTeammates();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana Reyes" }));
    expect(screen.getByRole("button", { name: "Notify teammates" })).toHaveTextContent("Me + Ana Reyes");
    fireEvent.click(within(screen.getByTestId("reminder-links-field")).getByRole("button", { name: "Remove link to Acme Corp" }));
    expect(await screen.findByTestId("recipients-hint")).toBeInTheDocument();
  });

  it("lets an existing reminder be switched to Laptop and Phone notifications", async () => {
    const patches: Array<Record<string, unknown>> = [];
    server.use(http.patch("/api/v1/scheduler/reminders/:id/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ ...mockReminders[0], ...body });
    }));
    renderPage();
    view("viewReminders");
    fireEvent.click(await screen.findByText("Follow up with client"));
    const channels = await screen.findByRole("group", { name: "Notify me via" });
    expect(within(channels).getByRole("checkbox", { name: "In-app" })).toBeChecked();
    expect(within(channels).getByRole("checkbox", { name: "Laptop" })).not.toBeChecked();
    fireEvent.click(within(channels).getByRole("checkbox", { name: "Laptop" }));
    fireEvent.click(within(channels).getByRole("checkbox", { name: "Phone" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    // Only what changed is sent.
    expect(patches[0]).toEqual({ notify_push: true, notify_sms: true });
  });

  it("editing a reminder's due time sends the real instant for the local time shown", async () => {
    const patches: Array<Record<string, unknown>> = [];
    server.use(http.patch("/api/v1/scheduler/reminders/:id/", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ ...mockReminders[0], ...body });
    }));
    renderPage();
    view("viewReminders");
    fireEvent.click(await screen.findByText("Follow up with client"));
    const due = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    // The field shows the stored instant as the user's local wall clock, not as UTC.
    expect(due.value).toBe(toLocalDatetimeValue(mockReminders[0].due_at));
    fireEvent.change(due, { target: { value: DUE_LOCAL } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].due_at).toBe(new Date(DUE_LOCAL).toISOString());
  });
});

// ── Editing and converting an event ───────────────────────────────────────────

describe("CalendarPage — editing an event", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    server.use(
      http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [] })),
      http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
      http.get("/api/v1/accounts/admin-account/", () => HttpResponse.json({ id: 1, company_name: "Admin" })),
    );
  });

  /** One meeting, PK 7, uid "gcal-7" — deliberately different so a test can prove which
   *  one the PATCH url used. FullCalendar strips `id` from extendedProps, so a panel
   *  built from the raw snapshot would PATCH `/events/undefined/`. */
  function serveEvent(overrides: Record<string, unknown> = {}) {
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([
          {
            ...mockCalendarEvents[0],
            id: 7,
            google_event_id: "gcal-7",
            title: "Q3 Planning",
            description: "Original agenda",
            location: "",
            event_category: "meeting",
            attendees: [],
            is_synced: true,
            ...overrides,
          },
        ]),
      ),
    );
  }

  /** Record what the details endpoint received. */
  function captureDetailsPatch() {
    const seen: { body: Record<string, unknown> | null; id: string; calls: number } = {
      body: null, id: "", calls: 0,
    };
    server.use(
      http.patch("/api/v1/scheduler/events/:id/details/", async ({ request, params }) => {
        seen.body = (await request.json()) as Record<string, unknown>;
        seen.id = String(params.id);
        seen.calls += 1;
        return HttpResponse.json({ ...mockCalendarEvents[0], id: 7, google_event_id: "gcal-7", ...seen.body });
      }),
    );
    return seen;
  }

  async function eventEl() {
    return waitFor(() => {
      const found = document.querySelector("[data-testid='calendar-event']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
  }

  /** Right-click the event and choose Edit — the path the user reported as broken. */
  async function openEditViaMenu() {
    renderPage();
    fireEvent.contextMenu(await eventEl());
    fireEvent.click(await screen.findByText("Edit"));
    return waitFor(() => expect(screen.getByTestId("event-edit-form")).toBeInTheDocument());
  }

  const form = () => screen.getByTestId("event-edit-form");

  it("right-click → Edit opens an editable form, not a read-only panel", async () => {
    serveEvent();
    await openEditViaMenu();

    // The reported bug: Edit opened a panel with no inputs and no save.
    expect(screen.getByLabelText("Title")).toHaveValue("Q3 Planning");
    expect(screen.getByLabelText("Description")).toHaveValue("Original agenda");
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
    expect(screen.getByLabelText("Starts")).toBeInTheDocument();
    expect(screen.getByLabelText("Ends")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("saves an edited title to the DB id, not undefined", async () => {
    // The second bug: FullCalendar strips `id`, so the panel used to hold a row whose
    // `id` was undefined and every PATCH would have gone to /events/undefined/.
    const patch = captureDetailsPatch();
    serveEvent();
    await openEditViaMenu();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Q3 Planning (revised)" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(patch.body).toEqual({ title: "Q3 Planning (revised)" }));
    expect(patch.id).toBe("7");
    expect(patch.id).not.toBe("undefined");
  });

  it("sends only the fields that changed", async () => {
    const patch = captureDetailsPatch();
    serveEvent();
    await openEditViaMenu();

    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Room 4" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(patch.body).toEqual({ location: "Room 4" }));
  });

  it("changes the type from the edit form", async () => {
    const patch = captureDetailsPatch();
    serveEvent();
    await openEditViaMenu();

    fireEvent.click(within(form()).getByRole("button", { name: /Focus Time/ }));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(patch.body).toEqual({ event_category: "focus_time" }));
  });

  it("offers exactly the six categories the model accepts", async () => {
    // `action_item` and `reminder` are colorable but are not event_category values —
    // offering either here would produce a 400 on save.
    serveEvent();
    await openEditViaMenu();

    for (const c of EVENT_CATEGORY_META) {
      expect(within(form()).getByRole("button", { name: new RegExp(c.label) })).toBeInTheDocument();
    }
    expect(within(form()).queryByRole("button", { name: /Action item/i })).not.toBeInTheDocument();
    expect(form().querySelectorAll("[data-category]")).toHaveLength(6);
  });

  it("closes the form without saving on Cancel", async () => {
    const patch = captureDetailsPatch();
    serveEvent();
    await openEditViaMenu();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Discarded" } });
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByTestId("event-edit-form")).not.toBeInTheDocument());
    expect(patch.calls).toBe(0);
  });

  it("refuses an empty title and stays open", async () => {
    const patch = captureDetailsPatch();
    serveEvent();
    await openEditViaMenu();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("A title is required.");
    expect(patch.calls).toBe(0);
    expect(screen.getByTestId("event-edit-form")).toBeInTheDocument();
  });

  it("refuses an end before the start", async () => {
    const patch = captureDetailsPatch();
    serveEvent();
    await openEditViaMenu();

    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-07-30T15:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-07-30T14:00" } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("end time must be after");
    expect(patch.calls).toBe(0);
  });

  it("keeps the form open and reports when the server rejects the save", async () => {
    serveEvent();
    server.use(
      http.patch("/api/v1/scheduler/events/:id/details/", () =>
        HttpResponse.json({ detail: "nope" }, { status: 400 }),
      ),
    );
    await openEditViaMenu();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Rejected" } });
    fireEvent.click(screen.getByText("Save"));

    // Closing on a rejected save would look exactly like success.
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByTestId("event-edit-form")).toBeInTheDocument();
  });

  // HISTORY: this notice used to say saving "will update it in Google and notify them", and the
  // server really did email every guest on every save. A customer received 2,000+ invitations
  // from one meeting move. Saving now NEVER emails guests, so the notice says so — a UI that
  // promised a notification that never comes would leave guests uninformed of a time change.
  it("tells the user that saving updates Google but does NOT email the guests", async () => {
    serveEvent({ attendees: [{ email: "a@example.com", responseStatus: "accepted" }] });
    await openEditViaMenu();
    const notice = within(form()).getByText(/guest/i, { selector: "p" });
    expect(notice).toHaveTextContent(/update it in Google/i);
    expect(notice).toHaveTextContent(/not email/i);
  });

  it("never claims that saving will notify guests", async () => {
    serveEvent({ attendees: [{ email: "a@example.com", responseStatus: "accepted" }] });
    await openEditViaMenu();
    expect(within(form()).queryByText(/and notify them/i)).not.toBeInTheDocument();
    expect(within(form()).queryByText(/will notify/i)).not.toBeInTheDocument();
  });

  // The panel listed bare dots: Google stores displayName "" for most guests and `??` does not
  // fall through on an empty string, so the name span rendered nothing.
  it("lists each guest's email, and their name when there is one", async () => {
    serveEvent({
      attendees: [
        { email: "plain@example.com", displayName: "", responseStatus: "accepted" },
        { email: "named@example.com", displayName: "Nina Named", responseStatus: "declined" },
      ],
    });
    renderPage();
    fireEvent.click(await eventEl());
    expect(await screen.findByText("plain@example.com")).toBeInTheDocument();
    expect(screen.getByText("Nina Named")).toBeInTheDocument();
    expect(screen.getByText("named@example.com")).toBeInTheDocument();
  });

  it("offers the account page's guest actions once the meeting has an account", async () => {
    server.use(
      http.get("/api/v1/accounts/contacts/", () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [
          { id: 1, account: 5, name: "Known Kim", email: "kim@example.com", role: "", description: "" },
        ] }),
      ),
    );
    serveEvent({
      account: 5,
      attendees: [
        { email: "kim@example.com", displayName: "", responseStatus: "accepted" },
        { email: "new@example.com", displayName: "", responseStatus: "accepted" },
      ],
    });
    renderPage();
    fireEvent.click(await eventEl());
    expect(await screen.findByTitle("Already a contact")).toBeInTheDocument();
    expect(screen.getAllByTitle("Add to team or contacts")).toHaveLength(1);
  });

  it("does not show the guest notice on a solo event", async () => {
    serveEvent({ attendees: [] });
    await openEditViaMenu();
    expect(within(form()).queryByText(/not email/i)).not.toBeInTheDocument();
  });

  it("does not show the guest notice on an unsynced event", async () => {
    serveEvent({ is_synced: false, attendees: [{ email: "a@example.com", responseStatus: "accepted" }] });
    await openEditViaMenu();
    expect(within(form()).queryByText(/not email/i)).not.toBeInTheDocument();
  });

  describe("Convert to…", () => {
    async function openConvert() {
      renderPage();
      fireEvent.contextMenu(await eventEl());
      fireEvent.click(await screen.findByText("Convert to…"));
    }

    it("converts the event type in place", async () => {
      const patch = captureDetailsPatch();
      serveEvent();
      await openConvert();

      fireEvent.click(await screen.findByTitle("Convert to Task"));
      await waitFor(() => expect(patch.body).toEqual({ event_category: "task" }));
      expect(patch.id).toBe("7");
    });

    it("repaints the grid in the new type's color", async () => {
      captureDetailsPatch();
      serveEvent();
      await openConvert();

      fireEvent.click(await screen.findByTitle("Convert to Focus Time"));
      await waitFor(() =>
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.focus_time),
      );
    });

    it("does not PATCH when the chosen type is the one already set", async () => {
      const patch = captureDetailsPatch();
      serveEvent({ event_category: "task" });
      await openConvert();

      const taskPill = await screen.findByTitle("Convert to Task");
      expect(taskPill).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(taskPill);
      await waitFor(() => expect(screen.queryByText("Convert to…")).not.toBeInTheDocument());
      expect(patch.calls).toBe(0);
    });

    it("rolls the grid back when the type change is rejected", async () => {
      serveEvent();
      server.use(
        http.patch("/api/v1/scheduler/events/:id/details/", () =>
          HttpResponse.json({ event_category: "bad" }, { status: 400 }),
        ),
      );
      await openConvert();

      fireEvent.click(await screen.findByTitle("Convert to Task"));
      await waitFor(() =>
        expect(document.querySelector("[data-testid='calendar-event']"))
          .toHaveAttribute("data-bg-color", DEFAULT_CATEGORY_COLORS.meeting),
      );
    });

    it("offers no Action item pill among the categories", async () => {
      serveEvent();
      await openConvert();
      await screen.findByTitle("Convert to Task");
      expect(document.querySelectorAll("[data-convert-category]")).toHaveLength(6);
      expect(document.querySelector("[data-convert-category='action_item']")).toBeNull();
    });

    it("creates an action item and keeps the event on the calendar", async () => {
      const created: { calls: number; body: Record<string, unknown> | null } = { calls: 0, body: null };
      server.use(
        http.post("/api/v1/airtable/action-items/", async ({ request }) => {
          created.calls += 1;
          created.body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { ...mockActionItem, id: 42, airtable_id: "recNEW42", task: "Q3 Planning" },
            { status: 201 },
          );
        }),
      );
      captureDetailsPatch();
      serveEvent();
      await openConvert();

      fireEvent.click(await screen.findByText(/Action item/));

      await waitFor(() => expect(created.calls).toBe(1));
      expect(created.body).toMatchObject({ task: "Q3 Planning", status: "Open" });
      // The whole point of this variant: the meeting survives.
      expect(document.querySelector("[data-testid='calendar-event']")).not.toBeNull();
    });

    it("records the new action item's id on the event", async () => {
      server.use(
        http.post("/api/v1/airtable/action-items/", () =>
          HttpResponse.json(
            { ...mockActionItem, id: 42, airtable_id: "recNEW42", task: "Q3 Planning" },
            { status: 201 },
          ),
        ),
      );
      const patch = captureDetailsPatch();
      serveEvent();
      await openConvert();

      fireEvent.click(await screen.findByText(/Action item/));
      await waitFor(() => expect(patch.body).toEqual({ agentpm_airtable_id: "recNEW42" }));
    });

    it("is not offered on a scheduled action item overlay", async () => {
      // A `scheduled-*` uid is synthetic — its numeric id belongs to an action item, not a
      // CalendarEvent, so there is no row to PATCH. Same gate Comment uses.
      localStorage.setItem(
        "scheduledActionItems",
        JSON.stringify([{
          airtableId: "recSCHED", task: "Prep deck", accountName: null,
          start: "2026-07-30T09:00:00", end: "2026-07-30T09:30:00",
        }]),
      );
      server.use(http.get("/api/v1/scheduler/events/", () => HttpResponse.json([])));
      renderPage();
      fireEvent.contextMenu(await eventEl());

      await screen.findByText("Copy details");
      expect(screen.queryByText("Convert to…")).not.toBeInTheDocument();
    });
  });

  // ── Log Week → Cloud Coach ──────────────────────────────────────────────────
  //
  // The panel under test is CalendarPage's own local `LogTimePanel` (~L2844), not the
  // unreachable twin in components/calendar/LogTimePanel.tsx. Request counts are
  // asserted at the network layer via MSW rather than by mocking lib/api.ts, because
  // "one request instead of N" is precisely the behaviour that changed.
  describe("Log Week", () => {
    async function enterLogTimeMode() {
      renderPage();
      const enter = await screen.findByTestId("enter-log-time");
      fireEvent.click(enter);
      return await screen.findByText("Log Week");
    }

    it("logs the week in exactly one request", async () => {
      const bodies: unknown[] = [];
      server.use(
        http.post("/api/v1/salesforce/log-week/", async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(weekPlanReport({ entries: [mockPlannedEntry()] }));
        }),
        // Present so a regression back to the per-entry fan-out is visible as a
        // non-empty list rather than an unhandled-request error.
        http.post("/api/v1/salesforce/log-time/", () => {
          bodies.push("log-time");
          return HttpResponse.json({}, { status: 201 });
        }),
      );

      const button = await enterLogTimeMode();
      fireEvent.click(button);

      await waitFor(() => expect(bodies.length).toBe(1));
      expect(bodies).not.toContain("log-time");
    });

    it("sends the week start and the account it is scoped to", async () => {
      let body: Record<string, unknown> = {};
      server.use(
        http.post("/api/v1/salesforce/log-week/", async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(weekPlanReport());
        }),
      );

      fireEvent.click(await enterLogTimeMode());

      await waitFor(() => expect(body.account_name).toBe("Acme Corp"));
      expect(typeof body.week_start).toBe("string");
    });

    it("omits entries when no project has been dragged onto a day", async () => {
      // An empty array would read as "log nothing"; omitting it is what asks the server
      // to resolve event → account → project itself.
      let body: Record<string, unknown> = {};
      server.use(
        http.post("/api/v1/salesforce/log-week/", async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(weekPlanReport());
        }),
      );

      fireEvent.click(await enterLogTimeMode());

      await waitFor(() => expect(body.week_start).toBeDefined());
      expect(body.entries).toBeUndefined();
    });

    it("shows the warning modal with the counts the server reported", async () => {
      server.use(
        http.post("/api/v1/salesforce/log-week/", () =>
          HttpResponse.json(
            weekPlanReport({
              entries: [mockPlannedEntry()],
              unlinked_events: [
                mockSkippedEvent({ event_id: 1, title: "Mystery sync" }),
                mockSkippedEvent({ event_id: 2, title: "Coffee chat" }),
              ],
              not_attended_events: [
                mockSkippedEvent({ event_id: 3, title: "Skipped standup", reason: "did_not_attend" }),
              ],
            }),
          ),
        ),
      );

      fireEvent.click(await enterLogTimeMode());

      const row = await screen.findByTestId("warning-unlinked");
      expect(row).toHaveTextContent("2 calendar items not linked to an account");
      expect(row).toHaveTextContent("Mystery sync");
      expect(screen.getByTestId("warning-not_attended")).toHaveTextContent("1 calendar item");
    });

    it("shows no modal when the week logged cleanly", async () => {
      server.use(
        http.post("/api/v1/salesforce/log-week/", () =>
          HttpResponse.json(weekPlanReport({ entries: [mockPlannedEntry()] })),
        ),
      );

      fireEvent.click(await enterLogTimeMode());

      await screen.findByText("✓ Week Logged");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("dismisses the modal", async () => {
      server.use(
        http.post("/api/v1/salesforce/log-week/", () =>
          HttpResponse.json(weekPlanReport({ unlinked_events: [mockSkippedEvent()] })),
        ),
      );

      fireEvent.click(await enterLogTimeMode());
      fireEvent.click(await screen.findByText("Got it"));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    });

    it("keeps the modal after the panel is closed", async () => {
      // The report is held on the page, not in the panel, so exiting Log Time mode
      // straight after logging does not take the warning down with it.
      server.use(
        http.post("/api/v1/salesforce/log-week/", () =>
          HttpResponse.json(weekPlanReport({ unlinked_events: [mockSkippedEvent()] })),
        ),
      );

      fireEvent.click(await enterLogTimeMode());
      await screen.findByRole("alertdialog");
      fireEvent.click(screen.getByTestId("enter-log-time")); // now "Exit Log Time"

      await waitFor(() => expect(screen.queryByText("Log Week")).not.toBeInTheDocument());
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("is clickable before any project is assigned", async () => {
      // It used to be disabled until a project had been dragged onto a day, which made
      // "click Log Week and it logs my week" impossible on a fresh panel.
      const button = await enterLogTimeMode();
      expect(button).not.toBeDisabled();
    });

    it("stays retryable after a failed request", async () => {
      let attempts = 0;
      server.use(
        http.post("/api/v1/salesforce/log-week/", () => {
          attempts += 1;
          return attempts === 1
            ? HttpResponse.json({ detail: "Could not reach Salesforce." }, { status: 502 })
            : HttpResponse.json(weekPlanReport({ entries: [mockPlannedEntry()] }));
        }),
      );

      const button = await enterLogTimeMode();
      fireEvent.click(button);

      await waitFor(() => expect(button).not.toBeDisabled());
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

      fireEvent.click(button);
      await screen.findByText("✓ Week Logged");
      expect(attempts).toBe(2);
    });
  });
});

// ── Artifacts: linked to an event, gated on a linked account ──

describe("CalendarPage — linking artifacts to an event", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    server.use(
      http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [] })),
      http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
      http.get("/api/v1/accounts/admin-account/", () => HttpResponse.json({ id: 1, company_name: "Admin" })),
    );
  });

  /** Same fixture shape as the "editing an event" describe block above: PK 7, uid "gcal-7". */
  function serveEvent(overrides: Record<string, unknown> = {}) {
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([
          {
            ...mockCalendarEvents[0],
            id: 7,
            google_event_id: "gcal-7",
            title: "Q3 Planning",
            event_category: "meeting",
            attendees: [],
            is_synced: true,
            artifact_ids: [],
            ...overrides,
          },
        ]),
      ),
    );
  }

  /** Links "gcal-7" to account id 1 — the same account id `mockArtifact`/`mockCodeArtifact`
   *  belong to, and the id `EventDetailPanel` will pass to `accountsApi.listArtifacts`.
   *  `handleEventClick` resolves the link via the singular GET, not the batch POST. */
  function linkEventToAccount() {
    server.use(
      http.get("/api/v1/airtable/event-link/", ({ request }) => {
        const uid = new URL(request.url).searchParams.get("event_uid");
        if (uid === "gcal-7") {
          return HttpResponse.json({ linked: true, airtable_account_id: 1, account_name: "Acme Corp" });
        }
        return HttpResponse.json({ linked: false });
      }),
    );
  }

  function captureDetailsPatch() {
    const seen: { body: Record<string, unknown> | null; id: string; calls: number } = {
      body: null, id: "", calls: 0,
    };
    server.use(
      http.patch("/api/v1/scheduler/events/:id/details/", async ({ request, params }) => {
        seen.body = (await request.json()) as Record<string, unknown>;
        seen.id = String(params.id);
        seen.calls += 1;
        return HttpResponse.json({ ...mockCalendarEvents[0], id: 7, google_event_id: "gcal-7", ...seen.body });
      }),
    );
    return seen;
  }

  async function eventEl() {
    return waitFor(() => {
      const found = document.querySelector("[data-testid='calendar-event']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
  }

  /** A plain click selects the event and opens the read-mode panel — distinct from
   *  right-click → Edit, which opens the editable form and has no Artifacts section.
   *  Scoped to the panel's own heading: "Q3 Planning" also renders as the grid's event
   *  title text, so an unscoped `findByText` matches both and throws. */
  async function openReadPanel() {
    renderPage();
    fireEvent.click(await eventEl());
    return screen.findByRole("heading", { name: "Q3 Planning" });
  }

  it("shows no Artifacts section when no account is linked to the event", async () => {
    serveEvent();
    await openReadPanel();

    await screen.findByText("Drop an account here to link");
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
  });

  it("shows the Artifacts section, populated with the linked account's artifacts, once an account is linked", async () => {
    serveEvent();
    linkEventToAccount();
    await openReadPanel();

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();
    expect(await screen.findByText(mockArtifact.name)).toBeInTheDocument();
    expect(await screen.findByText(mockCodeArtifact.name)).toBeInTheDocument();
  });

  it("toggling an artifact PATCHes /details/ with the updated artifact_ids array", async () => {
    const patch = captureDetailsPatch();
    serveEvent();
    linkEventToAccount();
    await openReadPanel();

    await screen.findByText("Artifacts");
    const checkbox = (await screen.findByText(mockArtifact.name))
      .closest("label")
      ?.querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => expect(patch.body).toEqual({ artifact_ids: [mockArtifact.id] }));
    expect(patch.id).toBe("7");
  });

  it("unchecking an already-linked artifact PATCHes it out of artifact_ids", async () => {
    const patch = captureDetailsPatch();
    serveEvent({ artifact_ids: [mockArtifact.id] });
    linkEventToAccount();
    await openReadPanel();

    const checkbox = (await screen.findByText(mockArtifact.name))
      .closest("label")
      ?.querySelector("input[type=checkbox]") as HTMLInputElement;
    await waitFor(() => expect(checkbox).toBeChecked());
    fireEvent.click(checkbox);

    await waitFor(() => expect(patch.body).toEqual({ artifact_ids: [] }));
  });

  it("creating a new artifact POSTs to the account's artifacts endpoint, then PATCHes the event to link it", async () => {
    const patch = captureDetailsPatch();
    let postedTo = "";
    let postedBody: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/v1/accounts/accounts/:id/artifacts/", async ({ request, params }) => {
        postedTo = String(params.id);
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { ...mockArtifact, id: 55, account: Number(params.id), ...postedBody },
          { status: 201 },
        );
      }),
    );
    serveEvent();
    linkEventToAccount();
    await openReadPanel();

    await screen.findByText("Artifacts");
    fireEvent.click(screen.getByText("+ New artifact"));
    fireEvent.change(screen.getByPlaceholderText("Artifact name"), { target: { value: "Runbook" } });
    fireEvent.change(screen.getByPlaceholderText("https://…"), { target: { value: "https://example.com/runbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(postedTo).toBe("1"));
    expect(postedBody).toEqual(expect.objectContaining({ name: "Runbook", url: "https://example.com/runbook" }));
    await waitFor(() => expect(patch.body).toEqual({ artifact_ids: [55] }));
  });
});

describe("CalendarPage — action item modal (not inline editing)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    server.use(
      http.get("/api/v1/airtable/action-items/:id/attachments/", () => HttpResponse.json([])),
    );
  });

  function serveScheduledActionItem(overrides: Record<string, unknown> = {}) {
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([
          {
            ...mockCalendarEvents[0],
            id: 9,
            google_event_id: "scheduled-recAAA001",
            title: "Fix billing",
            ...overrides,
          },
        ]),
      ),
    );
  }

  async function eventEl() {
    return waitFor(() => {
      const found = document.querySelector("[data-testid='calendar-event']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
  }

  // "Fix billing" renders in several places at once (the calendar chip, the panel
  // header, the sidebar card) — this is specifically the read-mode body <p> inside
  // EventDetailPanel, the one whose onDoubleClick opens the shared modal.
  async function gridBodyText(text: string) {
    return waitFor(() => {
      const match = Array.from(document.querySelectorAll("p")).find(
        (el) => el.textContent === text && el.className === "text-[var(--twilio-navy)] font-medium leading-snug",
      );
      expect(match).toBeTruthy();
      return match as HTMLElement;
    });
  }

  it("sidebar: clicking an action item card opens the shared modal, not an inline field form", async () => {
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: /Action Items/i })[0]);

    const taskText = await screen.findByText("Fix billing");
    fireEvent.click(taskText);

    expect(await screen.findByTestId("action-item-modal-panel")).toBeInTheDocument();
  });

  it("sidebar: the modal is portalled to <body>, not confined to the sliding panel", async () => {
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: /Action Items/i })[0]);
    fireEvent.click(await screen.findByText("Fix billing"));
    const panel = await screen.findByTestId("action-item-modal-panel");
    const slider = document.querySelector(".translate-x-0, .translate-x-full");
    expect(slider).not.toBeNull();
    expect(slider!.contains(panel)).toBe(false);
  });

  it("grid: double-clicking the scheduled item's body opens the shared modal, not an inline field form", async () => {
    serveScheduledActionItem();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);

    fireEvent.click(await eventEl());
    const taskText = await gridBodyText("Fix billing");
    fireEvent.doubleClick(taskText);

    expect(await screen.findByTestId("action-item-modal-panel")).toBeInTheDocument();
  });

  it("grid: clicking the 'Open action item' footer button opens the shared modal", async () => {
    serveScheduledActionItem();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);

    fireEvent.click(await eventEl());
    await gridBodyText("Fix billing");
    fireEvent.click(screen.getByRole("button", { name: "Open action item" }));

    expect(await screen.findByTestId("action-item-modal-panel")).toBeInTheDocument();
  });

  it("grid: double-clicking the scheduled-time row still opens the time-only editor, independent of the modal", async () => {
    serveScheduledActionItem();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);

    fireEvent.click(await eventEl());
    const taskText = await gridBodyText("Fix billing");
    const bodyBlock = taskText.parentElement as HTMLElement;
    const timeRow = bodyBlock.previousElementSibling as HTMLElement;

    fireEvent.doubleClick(timeRow);

    expect(document.querySelectorAll('input[type="time"]').length).toBe(2);
    expect(screen.queryByTestId("action-item-modal-panel")).not.toBeInTheDocument();
  });

  it("saving via the modal updates the sidebar list with a single save, and propagates the change", async () => {
    let saveCount = 0;
    server.use(
      http.patch("/api/v1/airtable/action-items/:airtableId/fields/", () => {
        saveCount += 1;
        return HttpResponse.json(mockActionItem);
      }),
    );

    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: /Action Items/i })[0]);

    const taskText = await screen.findByText("Fix billing");
    fireEvent.click(taskText);
    await screen.findByTestId("action-item-modal-panel");

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(screen.queryByTestId("action-item-modal-panel")).not.toBeInTheDocument(),
    );

    // Exactly one save request — ActionItemModal.handleSave is the only writer;
    // the sidebar's onUpdated must not re-PATCH on top of it.
    expect(saveCount).toBe(1);

    // At least one actionItemsUpdated broadcast reaches listeners (the sidebar's own
    // explicit dispatch, on top of lib/api.ts's response-interceptor broadcast for any
    // non-GET to an action-items endpoint — both are expected, not a duplicate save).
    const updates = dispatchSpy.mock.calls.filter(
      ([e]) => e instanceof StorageEvent && (e as StorageEvent).key === "actionItemsUpdated",
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    dispatchSpy.mockRestore();
  });
});

// ── Scheduled items survive a Google sync ─────────────────────────────────────
//
// The reported bug: "clicking the Sync Google Calendar button seems to have removed the
// action items that I had already added to the calendar."
//
// Root cause: a scheduling lived only in `localStorage`, and `handleSync` deleted that entry
// after pushing to Google, trusting the pull to bring it back as a database row. When the
// round trip did not complete the scheduling existed nowhere. Every test in this block is a
// guard on some part of that no longer being possible.

describe("scheduled action items are database rows and survive a sync", () => {
  const DRAG_KEY = "calendarDragActionItemId";
  const LEGACY_ITEMS_KEY = "scheduledActionItems";
  const LEGACY_REMINDERS_KEY = "scheduledReminders";

  /** A work_tracking row as it exists straight after a drop: real id, not yet in Google. */
  function scheduledRow(overrides: Partial<(typeof mockCalendarEvents)[number]> = {}) {
    return {
      ...mockCalendarEvents[0],
      id: 501,
      title: "Provision SQL Traits",
      start_datetime: "2026-07-30T09:00:00Z",
      end_datetime: "2026-07-30T09:15:00Z",
      calendar_id: "work_tracking",
      agentpm_airtable_id: "rec9AwGLeyC2jMn2I",
      google_event_id: "",
      is_synced: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    (globalThis as Record<string, unknown>).__TEST_DROP_DATE__ = "2026-07-30T09:00:00";
  });

  it("dropping an action item POSTs a work_tracking event carrying the airtable id", async () => {
    const posted: Array<Record<string, unknown>> = [];
    server.use(
      http.post("/api/v1/scheduler/events/", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        posted.push(body);
        return HttpResponse.json({ ...scheduledRow(), ...body }, { status: 201 });
      }),
    );

    renderPage();
    await screen.findByTestId("fullcalendar");

    const w = window as unknown as Record<string, string>;
    w[DRAG_KEY] = "rec9AwGLeyC2jMn2I";
    w[`${DRAG_KEY}_task`] = "Provision SQL Traits";
    fireEvent.click(screen.getByTestId("trigger-item-drop"));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      calendar_id: "work_tracking",
      agentpm_airtable_id: "rec9AwGLeyC2jMn2I",
      title: "Provision SQL Traits",
    });
  });

  it("a drop that the server rejects tells the user nothing was saved", async () => {
    // The original bug was silent. A failed write must never look like a success.
    server.use(
      http.post("/api/v1/scheduler/events/", () => new HttpResponse(null, { status: 500 })),
    );

    renderPage();
    await screen.findByTestId("fullcalendar");

    const w = window as unknown as Record<string, string>;
    w[DRAG_KEY] = "rec9AwGLeyC2jMn2I";
    w[`${DRAG_KEY}_task`] = "Provision SQL Traits";
    fireEvent.click(screen.getByTestId("trigger-item-drop"));

    await waitFor(() =>
      expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument(),
    );
  });

  it("a scheduled action item is STILL on the grid after the page's Google sync", async () => {
    // The headline regression guard.
    let syncCalls = 0;
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([...mockCalendarEvents, scheduledRow()]),
      ),
      http.post("/api/v1/integrations/google/sync/", () => {
        syncCalls += 1;
        return HttpResponse.json({ detail: "Sync complete.", event_count: 3 });
      }),
    );

    renderPage();
    // Present before the sync.
    await waitFor(() =>
      expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument(),
    );

    // The page syncs on open; wait for that sync (and its refetch) to settle.
    await waitFor(() => expect(syncCalls).toBe(1));
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument();
  });

  it("Sync issues no DELETE and no localStorage push — measured at the network layer", async () => {
    const methods: string[] = [];
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([...mockCalendarEvents, scheduledRow()]),
      ),
      http.post("/api/v1/integrations/google/sync/", () =>
        HttpResponse.json({ detail: "Sync complete.", event_count: 3 }),
      ),
      // If handleSync still ran its old push step, this would be hit.
      http.post("/api/v1/integrations/google/push-action-items/", () => {
        methods.push("PUSH");
        return HttpResponse.json({ results: [] });
      }),
      http.delete("/api/v1/scheduler/events/:id/", () => {
        methods.push("DELETE");
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument());

    await new Promise((r) => setTimeout(r, 100)); // let the on-open sync finish

    // The push-then-prune dance is gone: the server owns mirroring to Google now.
    expect(methods).toEqual([]);
  });

  it("keeps rendering the scheduled item while a slow sync is still in flight", async () => {
    // Guards against the class of fake test the 2026-08-19 log entry records: MSW answers in a
    // microtask, so a blank-then-restore would be invisible unless the response is held open.
    let release: (() => void) | null = null;
    let syncStarted = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([...mockCalendarEvents, scheduledRow()]),
      ),
      http.post("/api/v1/integrations/google/sync/", async () => {
        syncStarted = true;
        await held;
        return HttpResponse.json({ detail: "Sync complete.", event_count: 3 });
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument());

    // The on-open sync is now in flight and held open.
    await waitFor(() => expect(syncStarted).toBe(true));

    // Mid-sync, the item must not have been removed from the grid.
    expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument();

    release!();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument();
  });

  it("a row that has not reached Google yet is still editable on the grid", async () => {
    // Every DB-backed branch used to require `is_synced`, so a freshly-dropped block was
    // un-draggable and un-editable until a sync happened to run.
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([scheduledRow({ is_synced: false, google_event_id: "" })]),
      ),
    );

    renderPage();
    const el = await screen.findByTestId("calendar-event");

    // `editable` is what FullCalendar reads to allow the drag; the stub surfaces the id, so
    // assert through the context menu, which is only offered for a real row.
    fireEvent.contextMenu(el);
    await waitFor(() => expect(screen.getByText("Edit")).toBeInTheDocument());
  });

  describe("one-time migration of localStorage-only schedulings", () => {
    it("creates a database row for a surviving legacy entry and clears the key", async () => {
      const posted: Array<Record<string, unknown>> = [];
      localStorage.setItem(LEGACY_ITEMS_KEY, JSON.stringify([
        {
          airtableId: "recLEGACY",
          task: "Composite Keys Data Graph Issue",
          accountName: null,
          start: "2026-07-30T09:00:00Z",
          end: "2026-07-30T09:15:00Z",
        },
      ]));
      server.use(
        http.post("/api/v1/scheduler/events/", async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          posted.push(body);
          return HttpResponse.json({ ...scheduledRow(), ...body }, { status: 201 });
        }),
      );

      renderPage();
      await screen.findByTestId("fullcalendar");

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        calendar_id: "work_tracking",
        agentpm_airtable_id: "recLEGACY",
      });
      await waitFor(() =>
        expect(localStorage.getItem(LEGACY_ITEMS_KEY)).toBeNull(),
      );
    });

    it("migrates a legacy entry whose action item is Done rather than discarding it", async () => {
      // Loss path 3: the mount prune fetched "Open,In Progress,Blocked,Backlogged,Complete"
      // — Done is absent — and deleted every entry not in that set. So marking an item Done
      // erased its calendar blocks. `recDONE` is deliberately absent from the action-items
      // handler's response, exactly as a Done item was.
      const posted: Array<Record<string, unknown>> = [];
      localStorage.setItem(LEGACY_ITEMS_KEY, JSON.stringify([
        { airtableId: "recDONE", task: "Finished work", start: "2026-07-30T09:00:00Z", end: "" },
      ]));
      server.use(
        http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
        http.post("/api/v1/scheduler/events/", async ({ request }) => {
          const body = await request.json() as Record<string, unknown>;
          posted.push(body);
          return HttpResponse.json({ ...scheduledRow(), ...body }, { status: 201 });
        }),
      );

      renderPage();
      await screen.findByTestId("fullcalendar");

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({ agentpm_airtable_id: "recDONE" });
    });

    it("KEEPS the legacy key when the migration write fails", async () => {
      // Clearing on partial success is the original bug. It must not reappear here.
      localStorage.setItem(LEGACY_ITEMS_KEY, JSON.stringify([
        { airtableId: "recLEGACY", task: "One", start: "2026-07-30T09:00:00Z", end: "" },
      ]));
      server.use(
        http.post("/api/v1/scheduler/events/", () => new HttpResponse(null, { status: 500 })),
      );

      renderPage();
      await screen.findByTestId("fullcalendar");

      // Give the migration time to run and fail.
      await waitFor(() => expect(screen.getByTestId("fullcalendar")).toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 50));
      expect(localStorage.getItem(LEGACY_ITEMS_KEY)).not.toBeNull();
    });

    it("clears a legacy reminder entry without creating a calendar row for it", async () => {
      // A reminder is drawn from its due time now; a browser-stored block at another time is
      // the artefact being retired, so it is not recreated.
      let posts = 0;
      localStorage.setItem(LEGACY_REMINDERS_KEY, JSON.stringify([
        { reminderId: 1, title: "Follow up with client", start: "2026-07-30T09:00:00Z", end: "" },
      ]));
      server.use(http.post("/api/v1/scheduler/events/", () => { posts++; return HttpResponse.json({}, { status: 201 }); }));

      renderPage();
      await screen.findByTestId("fullcalendar");

      await waitFor(() => expect(localStorage.getItem(LEGACY_REMINDERS_KEY)).toBeNull());
      expect(posts).toBe(0);
    });

    it("does not re-create a row when the legacy entry already has one", async () => {
      let posts = 0;
      localStorage.setItem(LEGACY_ITEMS_KEY, JSON.stringify([
        {
          airtableId: "rec9AwGLeyC2jMn2I",
          task: "Provision SQL Traits",
          start: "2026-07-30T09:00:00Z",
          end: "",
        },
      ]));
      server.use(
        http.get("/api/v1/scheduler/events/", () => HttpResponse.json([scheduledRow()])),
        http.post("/api/v1/scheduler/events/", async () => {
          posts += 1;
          return HttpResponse.json(scheduledRow(), { status: 201 });
        }),
      );

      renderPage();
      await waitFor(() => expect(screen.getByText(/Provision SQL Traits/)).toBeInTheDocument());
      await new Promise((r) => setTimeout(r, 50));

      expect(posts).toBe(0);
      await waitFor(() => expect(localStorage.getItem(LEGACY_ITEMS_KEY)).toBeNull());
    });
  });
});

// ── Week navigation: past weeks must keep showing their events ────────────────
//
// Reported as "I clicked Sync Google Calendar which updated this week, but going back
// in time the previous weeks' data is not there." The data was never lost: the DB and
// the API both return 50-66 events for each of the last 7 weeks. Two client-side faults
// made them invisible.

describe("CalendarPage — navigating to earlier weeks", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    const g = globalThis as Record<string, unknown>;
    delete g.__TEST_RANGE_START__;
    delete g.__TEST_RANGE_END__;
    server.use(
      http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [] })),
      http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
      http.get("/api/v1/accounts/admin-account/", () => HttpResponse.json({ id: 1, company_name: "Admin" })),
    );
  });

  /** The 6 historical week ranges the page prewarms, built exactly as it builds them. */
  function historicalWeekRanges() {
    const now = new Date();
    const thisWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    thisWeek.setDate(thisWeek.getDate() - thisWeek.getDay());
    return Array.from({ length: 6 }, (_, i) => {
      const start = new Date(thisWeek);
      start.setDate(start.getDate() - 7 * (i + 1));
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    });
  }

  function historicalWeekStarts(): string[] {
    return historicalWeekRanges().map((r) => r.startIso.slice(0, 10));
  }

  function aimAt(start: string, end: string) {
    const g = globalThis as Record<string, unknown>;
    g.__TEST_RANGE_START__ = start;
    g.__TEST_RANGE_END__ = end;
  }

  /** Serve a distinct event per requested week, so "which week is on screen" is assertable. */
  function servePerWeek() {
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        const start = new URL(request.url).searchParams.get("start") ?? "";
        const week = start.slice(0, 10);
        return HttpResponse.json([
          { ...mockCalendarEvents[0], id: 900, google_event_id: `gcal-${week}`, title: `Event for ${week}` },
        ]);
      }),
    );
  }

  it("shows the earlier week's events after paging back", async () => {
    servePerWeek();
    renderPage();
    await screen.findByText(/Event for 2026-07-28/);

    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));

    await screen.findByText(/Event for 2026-06-16/);
  });

  it("still renders an earlier week after an event was edited on the current one", async () => {
    // The latch bug: saveEventDetails sets localMutationRef and never clears it, so every
    // later fetch resolved and was then thrown away. One edit made all subsequent week
    // navigation render nothing, for the rest of the session.
    servePerWeek();
    server.use(
      http.patch("/api/v1/scheduler/events/:id/details/", () =>
        HttpResponse.json({ ...mockCalendarEvents[0], id: 900, title: "Renamed" }),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByText(/Event for 2026-07-28/));

    // Rename it through the detail panel — the same path the right-click "Convert to…"
    // and the edit form both use.
    const editBtn = await screen.findByText(/Edit event/);
    fireEvent.click(editBtn);
    const title = await screen.findByDisplayValue(/Event for 2026-07-28/);
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(screen.queryByDisplayValue("Renamed")).not.toBeInTheDocument());

    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));

    await screen.findByText(/Event for 2026-06-16/);
  });

  it("still renders an earlier week after toggling attendance", async () => {
    // Same latch, reached through the other unclosed site (toggleAttendance).
    servePerWeek();
    server.use(
      http.patch("/api/v1/scheduler/events/:id/attendance/", () =>
        HttpResponse.json({ ...mockCalendarEvents[0], id: 900, attended: false }),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByText(/Event for 2026-07-28/));
    fireEvent.click(await screen.findByTestId("attendance-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("attendance-toggle")).toHaveAttribute("data-attended", "false"),
    );

    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));

    await screen.findByText(/Event for 2026-06-16/);
  });

  it("shows a week fetched while an attendance save was still in flight", async () => {
    // The race behind the previous test, forced deterministically: the week is requested
    // and answered while the save still holds the in-flight-mutation latch, so its result
    // is set aside. When the save settles the set-aside week must be applied — otherwise
    // the old week stays on screen until the next navigation.
    servePerWeek();
    let releasePatch: () => void = () => {};
    const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
    server.use(
      http.patch("/api/v1/scheduler/events/:id/attendance/", async () => {
        await patchGate;
        return HttpResponse.json({ ...mockCalendarEvents[0], id: 900, attended: false });
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByText(/Event for 2026-07-28/));
    fireEvent.click(await screen.findByTestId("attendance-toggle"));

    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));
    // The save is still pending, so the new week is held back.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Event for 2026-06-16/)).not.toBeInTheDocument();

    releasePatch();
    await screen.findByText(/Event for 2026-06-16/);
  });

  it("does not write one week's events into another week's cache entry", async () => {
    // The cache-write effect keys on `visibleRange`, but `visibleRange` and `events` are
    // two separate state updates: after paging, the new range was briefly paired with the
    // OLD events and persisted under the new week's key. Revisiting then served the wrong
    // week from cache.
    servePerWeek();
    renderPage();
    await screen.findByText(/Event for 2026-07-28/);

    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));
    await screen.findByText(/Event for 2026-06-16/);

    // Asserted as a property rather than against a literal key: the key is derived from
    // the range's LOCAL day, so hard-coding one would only hold in timezones west of UTC.
    // Each cached entry must hold exactly one week's events — never a mix, and never a
    // different week's than its own key.
    const byKey = new Map<string, string[]>();
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k?.startsWith("calEvents::")) continue;
      const { data } = JSON.parse(sessionStorage.getItem(k)!) as { data: Array<{ title: string }> };
      byKey.set(k, [...new Set(data.map((e) => e.title))]);
    }
    for (const [key, titles] of byKey) {
      expect(titles.length, `${key} holds more than one week: ${titles.join(", ")}`).toBe(1);
    }
    const allTitles = [...byKey.values()].flat();
    expect(allTitles).toContain("Event for 2026-07-28");
    expect(allTitles).toContain("Event for 2026-06-16");
    // Two distinct weeks ⇒ two distinct entries.
    expect(new Set(allTitles).size).toBe(new Set(byKey.keys()).size);
  });

  it("prewarms the last 6 weeks, so paging back does not fetch again", async () => {
    // "make it so that all weeks going back 6 weeks are visible in the UI ... this should
    // simply persist across a user's session if no updates were made to those events."
    const asked: string[] = [];
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        const week = (new URL(request.url).searchParams.get("start") ?? "").slice(0, 10);
        asked.push(week);
        return HttpResponse.json([
          { ...mockCalendarEvents[0], id: 900, google_event_id: `gcal-${week}`, title: `Event for ${week}` },
        ]);
      }),
    );
    renderPage();
    await screen.findByText(/Event for 2026-07-28/);

    // The six historical week-starts, fetched one at a time. Counted by week rather than
    // by total request count: a pre-existing effect also fetches the last 3 weeks (for
    // account-link fading), so a bare total would be asserting that effect too.
    const wanted = historicalWeekStarts();
    await waitFor(() => {
      for (const w of wanted) expect(asked).toContain(w);
    });

    // Every prewarmed week is now readable from the cache without another request.
    const before = asked.length;
    for (const { startIso, endIso } of historicalWeekRanges()) {
      aimAt(startIso, endIso);
      fireEvent.click(screen.getByTestId("trigger-dates-set"));
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(asked.length).toBe(before));
    }
  });

  it("keeps a finished week cached past the 5-minute TTL that still applies to this week", async () => {
    // A week that has ended cannot change on its own, and any sync clears the whole
    // cache — so re-requesting it every 5 minutes is pure waste. The current week keeps
    // the short TTL because it is still being edited.
    let calls = 0;
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        calls++;
        const week = (new URL(request.url).searchParams.get("start") ?? "").slice(0, 10);
        return HttpResponse.json([
          { ...mockCalendarEvents[0], id: 900, google_event_id: `gcal-${week}`, title: `Event for ${week}` },
        ]);
      }),
    );
    renderPage();
    await screen.findByText(/Event for 2026-07-28/);
    await waitFor(() => expect(sessionStorage.length).toBeGreaterThanOrEqual(7));

    // Age every cache entry well past the 5-minute TTL.
    const stale = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k?.startsWith("calEvents::")) continue;
      const parsed = JSON.parse(sessionStorage.getItem(k)!) as { ts: number; data: unknown };
      sessionStorage.setItem(k, JSON.stringify({ ...parsed, ts: stale }));
    }

    const afterPrewarm = calls;
    const { startIso, endIso } = historicalWeekRanges()[0];
    aimAt(startIso, endIso);
    fireEvent.click(screen.getByTestId("trigger-dates-set"));

    // Served from cache despite being an hour stale — it is a finished week.
    await waitFor(() => expect(screen.getByTestId("fullcalendar")).toBeInTheDocument());
    expect(calls).toBe(afterPrewarm);
  });

  it("serves a previously-visited week from cache for the whole session, with no refetch", async () => {
    // "This should simply persist across a user's session if no updates were made."
    let calls = 0;
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        calls++;
        const week = (new URL(request.url).searchParams.get("start") ?? "").slice(0, 10);
        return HttpResponse.json([
          { ...mockCalendarEvents[0], id: 900, google_event_id: `gcal-${week}`, title: `Event for ${week}` },
        ]);
      }),
    );
    renderPage();
    await screen.findByText(/Event for 2026-07-28/);

    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));
    await screen.findByText(/Event for 2026-06-16/);
    const afterFirstVisit = calls;

    // Back to the original week, then forward again — both already fetched this session.
    aimAt("2026-07-28T00:00:00.000Z", "2026-08-04T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));
    await screen.findByText(/Event for 2026-07-28/);
    aimAt("2026-06-16T00:00:00.000Z", "2026-06-23T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("trigger-dates-set"));
    await screen.findByText(/Event for 2026-06-16/);

    expect(calls).toBe(afterFirstVisit);
  });
});


describe("CalendarPage — action items sidebar follows the selected account", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([
          { ...mockActionItem, id: 1, airtable_id: "recACME1", task: "Acme task", account_name: "Acme Corp", status: "Open" },
          { ...mockActionItem, id: 2, airtable_id: "recBETA1", task: "Beta task", account_name: "Beta Inc", status: "Open" },
        ]),
      ),
    );
  });

  async function openSidebar() {
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: /Action Items/i })[0]);
    await screen.findByText("Acme task");
  }

  it("shows every account's items when no account is selected", async () => {
    await openSidebar();
    expect(screen.getByText("Beta task")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-account-filter")).not.toBeInTheDocument();
  });

  it("narrows to the selected account (case-insensitively) while the Accounts panel is open", async () => {
    await openSidebar();
    const toggle = screen.getByTestId("toggle-accounts-panel");
    if (toggle.getAttribute("data-open") !== "true") fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("select-account-beta"));

    await waitFor(() => expect(screen.queryByText("Acme task")).not.toBeInTheDocument());
    expect(screen.getByText("Beta task")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-account-filter")).toHaveTextContent("beta inc");
  });

  it("stops filtering once the Accounts panel is closed", async () => {
    await openSidebar();
    const toggle = screen.getByTestId("toggle-accounts-panel");
    if (toggle.getAttribute("data-open") !== "true") fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("select-account-beta"));
    await waitFor(() => expect(screen.queryByText("Acme task")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId("toggle-accounts-panel"));
    expect(await screen.findByText("Acme task")).toBeInTheDocument();
  });
});


describe("CalendarPage — search", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    delete (window as unknown as Record<string, unknown>).__TEST_GOTO_DATE__;
  });

  function serveEvents() {
    let searchParams: URLSearchParams | null = null;
    server.use(
      http.get("/api/v1/scheduler/events/", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("search")) {
          searchParams = url.searchParams;
          return HttpResponse.json([
            { ...mockCalendarEvents[0], id: 501, google_event_id: "g-501", title: "Acme renewal", start_datetime: "2026-12-03T17:00:00Z", end_datetime: "2026-12-03T18:00:00Z" },
          ]);
        }
        return HttpResponse.json([
          { ...mockCalendarEvents[0], id: 11, google_event_id: "g-11", title: "Acme kickoff" },
          { ...mockCalendarEvents[0], id: 12, google_event_id: "g-12", title: "Dentist" },
        ]);
      }),
    );
    return () => searchParams;
  }

  function gridTitles() {
    return Array.from(document.querySelectorAll("[data-testid='calendar-event']")).map((el) => el.textContent);
  }

  it("typing narrows the grid to matching events", async () => {
    serveEvents();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await waitFor(() => expect(gridTitles().some((t) => t?.includes("Dentist"))).toBe(true));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search calendar" }), { target: { value: "acme" } });

    await waitFor(() => expect(gridTitles().some((t) => t?.includes("Dentist"))).toBe(false));
    expect(gridTitles().some((t) => t?.includes("Acme kickoff"))).toBe(true);
  });

  it("queries the server with ?search= and a window, and picking a result jumps to its date", async () => {
    const lastSearch = serveEvents();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await screen.findByTestId("fullcalendar");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search calendar" }), { target: { value: "renewal" } });
    const result = await screen.findByText("Acme renewal");
    const params = lastSearch()!;
    expect(params.get("search")).toBe("renewal");
    expect(params.get("start")).toBeTruthy();
    expect(params.get("end")).toBeTruthy();

    fireEvent.click(result);
    expect((window as unknown as Record<string, unknown>).__TEST_GOTO_DATE__).toBe("2026-12-03T17:00:00Z");
  });

  it("clearing the box restores every event", async () => {
    serveEvents();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await waitFor(() => expect(gridTitles().some((t) => t?.includes("Dentist"))).toBe(true));
    const box = screen.getByRole("searchbox", { name: "Search calendar" });
    fireEvent.change(box, { target: { value: "acme" } });
    await waitFor(() => expect(gridTitles().some((t) => t?.includes("Dentist"))).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(gridTitles().some((t) => t?.includes("Dentist"))).toBe(true));
  });
});


describe("CalendarPage — Log Time rows and project auto-import", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // Local wall-clock times on the panel's first day, so the day bucketing is timezone-proof.
  const at = (h: number, m = 0) => new Date(2026, 6, 28, h, m).toISOString();

  function serveWeek() {
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([
          { ...mockCalendarEvents[0], id: 71, google_event_id: "g-71", title: "Acme standup", account_name: "Acme Corp", calendar_id: "primary", start_datetime: at(9), end_datetime: at(9, 30) },
          { ...mockCalendarEvents[0], id: 72, google_event_id: "g-72", title: "Zero length", account_name: "Acme Corp", calendar_id: "primary", start_datetime: at(10), end_datetime: at(10) },
          { ...mockCalendarEvents[0], id: 73, google_event_id: "g-73", title: "Beta review", account_name: "Beta Inc", calendar_id: "primary", start_datetime: at(11), end_datetime: at(12) },
          { ...mockCalendarEvents[0], id: 74, google_event_id: "g-74", title: "Skipped sync", account_name: "Acme Corp", calendar_id: "primary", attended: false, start_datetime: at(13), end_datetime: at(14) },
          { ...mockCalendarEvents[0], id: 75, google_event_id: "g-75", title: "Holiday", account_name: "Acme Corp", calendar_id: "primary", all_day: true, start_datetime: at(0), end_datetime: at(23, 59) },
          { ...mockCalendarEvents[0], id: 76, google_event_id: "", title: "Build widget", calendar_id: "work_tracking", agentpm_airtable_id: "recWIDGET", account_name: "Acme Corp", start_datetime: at(15), end_datetime: at(15, 15) },
          { ...mockCalendarEvents[0], id: 77, google_event_id: "", title: "Build widget", calendar_id: "work_tracking", agentpm_airtable_id: "recWIDGET", account_name: "Acme Corp", start_datetime: at(16), end_datetime: at(16, 30) },
          { ...mockCalendarEvents[0], id: 78, google_event_id: "", title: "Beta chore", calendar_id: "work_tracking", agentpm_airtable_id: "recBETA", account_name: "Beta Inc", start_datetime: at(17), end_datetime: at(17, 15) },
        ]),
      ),
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([
          { ...mockActionItem, id: 1, airtable_id: "recWIDGET", task: "Build widget", account_name: "Acme Corp", time_spent: 99999 },
          { ...mockActionItem, id: 2, airtable_id: "recBETA", task: "Beta chore", account_name: "Beta Inc" },
        ]),
      ),
      http.get("/api/v1/salesforce/projects/", () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
      http.get("/api/v1/accounts/projects/", () =>
        HttpResponse.json({
          count: 2, next: null, previous: null,
          results: [
            { id: 5, account: 1, name: "Widget Rollout", description: "", url: "", position: 0, action_ids: [], meeting_ids: [], goal_ids: ["6"], resources: [], sf_data: {}, sf_project_id: "", kind: "project", created_at: "" },
            { id: 6, account: 1, name: "Goal: ship v1", description: "", url: "", position: 1, action_ids: ["recWIDGET"], meeting_ids: [], goal_ids: [], resources: [], sf_data: {}, sf_project_id: "", kind: "goal", created_at: "" },
          ],
        }),
      ),
    );
  }

  async function openPanel() {
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("enter-log-time"));
    await screen.findByText("Log Week");
    return screen.findByText("Acme standup");
  }

  it("lists only this account's attended, timed rows", async () => {
    serveWeek();
    await openPanel();
    // Scoped to the panel: the grid and sidebar render the same titles legitimately.
    const panel = screen.getByText(/Log Time to Salesforce — Acme Corp/).closest(".rounded-2xl") as HTMLElement;
    for (const hidden of ["Zero length", "Beta review", "Skipped sync", "Holiday", "Beta chore"]) {
      expect(within(panel).queryByText(hidden)).not.toBeInTheDocument();
    }
    expect(within(panel).getAllByText("Build widget").length).toBeGreaterThan(0);
  });

  it("an action item's time is its calendar blocks that day, not its lifetime time_spent", async () => {
    serveWeek();
    await openPanel();
    // 15m + 30m blocks, summed; time_spent=99999 must not leak in.
    expect(await screen.findByText("45m")).toBeInTheDocument();
  });

  it("auto-imports the account-page project an item (via its goal) belongs to", async () => {
    serveWeek();
    await openPanel();
    expect(await screen.findByTestId("auto-project-badge")).toBeInTheDocument();
    // Goals are not offered as projects to drag; only the parent project appears.
    expect(screen.queryByText("Goal: ship v1")).not.toBeInTheDocument();
    expect(screen.getAllByText("Widget Rollout").length).toBeGreaterThanOrEqual(2); // pill + day block
  });

  it("dismissing an auto project removes it from the day and stays dismissed", async () => {
    serveWeek();
    await openPanel();
    const badge = await screen.findByTestId("auto-project-badge");
    const block = badge.closest(".rounded-lg") as HTMLElement;
    fireEvent.click(within(block).getByTitle("Remove"));
    await waitFor(() => expect(screen.queryByTestId("auto-project-badge")).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("logtime::Acme Corp::suppressedAutoProjects") ?? "[]")).toHaveLength(1);
  });

  describe("Log button (Mark and Log are one)", () => {
    // Two projects on the same day, each with its own action item.
    function serveTwoProjects(posts: Array<Record<string, unknown>>, salesforce = true) {
      serveWeek();
      server.use(
        http.get("/api/v1/integrations/status/", () =>
          HttpResponse.json({ connected: salesforce ? [{ ...mockGmailCredential, provider: "salesforce", is_active: true }] : [mockGmailCredential], sync_states: [] }),
        ),
        http.get("/api/v1/scheduler/events/", () =>
          HttpResponse.json([
            { ...mockCalendarEvents[0], id: 76, google_event_id: "", title: "Build widget", calendar_id: "work_tracking", agentpm_airtable_id: "recWIDGET", account_name: "Acme Corp", start_datetime: at(15), end_datetime: at(15, 30) },
            { ...mockCalendarEvents[0], id: 79, google_event_id: "", title: "Ship gadget", calendar_id: "work_tracking", agentpm_airtable_id: "recGADGET", account_name: "Acme Corp", start_datetime: at(16), end_datetime: at(16, 30) },
          ]),
        ),
        http.get("/api/v1/airtable/action-items/", () =>
          HttpResponse.json([
            { ...mockActionItem, id: 1, airtable_id: "recWIDGET", task: "Build widget", account_name: "Acme Corp" },
            { ...mockActionItem, id: 3, airtable_id: "recGADGET", task: "Ship gadget", account_name: "Acme Corp" },
          ]),
        ),
        http.get("/api/v1/accounts/projects/", () =>
          HttpResponse.json({
            count: 2, next: null, previous: null,
            results: [
              { id: 5, account: 1, name: "Widget Rollout", description: "", url: "", position: 0, action_ids: ["recWIDGET"], meeting_ids: [], goal_ids: [], resources: [], sf_data: {}, sf_project_id: "a0W000000000001AAA", kind: "project", created_at: "" },
              { id: 7, account: 1, name: "Gadget Launch", description: "", url: "", position: 1, action_ids: ["recGADGET"], meeting_ids: [], goal_ids: [], resources: [], sf_data: {}, sf_project_id: "a0W000000000002AAA", kind: "project", created_at: "" },
            ],
          }),
        ),
        http.post("/api/v1/salesforce/log-time/", async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({}, { status: 201 });
        }),
      );
    }

    const block = (name: string) => screen.getAllByText(name).map((el) => el.closest(".rounded-lg.border") as HTMLElement).find((b) => b && within(b).queryAllByRole("button", { name: /^(Log|Logged)$/ }).length > 0)!;

    it("has no separate Mark button", async () => {
      serveTwoProjects([]);
      render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
      fireEvent.click(await screen.findByTestId("enter-log-time"));
      await screen.findByText("Log Week");
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Log" }).length).toBeGreaterThanOrEqual(2));
      expect(screen.queryByRole("button", { name: "Mark" })).not.toBeInTheDocument();
    });

    it("logging one project marks only that project, and the other stays loggable", async () => {
      const posts: Array<Record<string, unknown>> = [];
      serveTwoProjects(posts);
      render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
      fireEvent.click(await screen.findByTestId("enter-log-time"));
      await screen.findByText("Log Week");
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Log" }).length).toBeGreaterThanOrEqual(2));

      const widget = block("Widget Rollout");
      fireEvent.click(within(widget).getByRole("button", { name: "Log" }));

      await waitFor(() => expect(within(block("Widget Rollout")).getByRole("button", { name: "Logged" })).toBeDisabled());
      expect(posts).toHaveLength(1);
      expect(posts[0].project_sf_id).toBe("a0W000000000001AAA");
      // Greyed, not green.
      expect(within(block("Widget Rollout")).getByRole("button", { name: "Logged" }).className).toContain("bg-gray-200");

      // The other project is untouched: still "Log", enabled, and its rows are not struck through.
      const gadget = block("Gadget Launch");
      expect(within(gadget).getByRole("button", { name: "Log" })).toBeEnabled();
      expect(within(gadget).getByText("Ship gadget").className).not.toContain("line-through");
      expect(within(block("Widget Rollout")).getByText("Build widget").className).toContain("line-through");
    });

    describe("before Salesforce is connected", () => {
      async function open() {
        const posts: Array<Record<string, unknown>> = [];
        serveTwoProjects(posts, false);
        render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
        fireEvent.click(await screen.findByTestId("enter-log-time"));
        await screen.findByText("Log Week");
        await waitFor(() => expect(screen.getAllByRole("button", { name: "Log" }).length).toBeGreaterThanOrEqual(2));
        return posts;
      }

      it("Log toggles that project on and off, and writes nothing to Salesforce", async () => {
        const posts = await open();
        fireEvent.click(within(block("Widget Rollout")).getByRole("button", { name: "Log" }));
        const logged = await within(block("Widget Rollout")).findByRole("button", { name: "Logged" });
        expect(logged).toBeEnabled(); // clickable: it is a toggle
        expect(within(block("Gadget Launch")).getByRole("button", { name: "Log" })).toBeEnabled();

        fireEvent.click(logged);
        await within(block("Widget Rollout")).findByRole("button", { name: "Log" });
        expect(within(block("Widget Rollout")).getByText("Build widget").className).not.toContain("line-through");
        expect(posts).toHaveLength(0);
      });
    });

    it("once connected, a logged project cannot be logged again", async () => {
      const posts: Array<Record<string, unknown>> = [];
      serveTwoProjects(posts);
      render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
      fireEvent.click(await screen.findByTestId("enter-log-time"));
      await screen.findByText("Log Week");
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Log" }).length).toBeGreaterThanOrEqual(2));
      // Wait for the connection to be known: before then the button is the toggle.
      await new Promise((r) => setTimeout(r, 50));
      fireEvent.click(within(block("Widget Rollout")).getByRole("button", { name: "Log" }));
      await waitFor(() => expect(within(block("Widget Rollout")).getByRole("button", { name: "Logged" })).toBeDisabled());
      fireEvent.click(within(block("Widget Rollout")).getByRole("button", { name: "Logged" }));
      expect(posts).toHaveLength(1);
    });

    it("a failed log stays 'Log' so it can be retried", async () => {
      const posts: Array<Record<string, unknown>> = [];
      serveTwoProjects(posts);
      server.use(http.post("/api/v1/salesforce/log-time/", () => HttpResponse.json({ detail: "no" }, { status: 502 })));
      render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
      fireEvent.click(await screen.findByTestId("enter-log-time"));
      await screen.findByText("Log Week");
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Log" }).length).toBeGreaterThanOrEqual(2));
      fireEvent.click(within(block("Widget Rollout")).getByRole("button", { name: "Log" }));
      await waitFor(() => expect(within(block("Widget Rollout")).getByRole("button", { name: "Log" })).toBeEnabled());
      expect(within(block("Widget Rollout")).queryByRole("button", { name: "Logged" })).not.toBeInTheDocument();
      expect(await screen.findByText(/Could not log this time to Salesforce/)).toBeInTheDocument();
    });
  });

  it("a removed row stays removed across a remount", async () => {
    serveWeek();
    const row = await openPanel();
    fireEvent.click(within(row.parentElement as HTMLElement).getByTitle("Remove from log"));
    await waitFor(() => expect(screen.queryByText("Acme standup")).not.toBeInTheDocument());
    cleanup();
    serveWeek();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    fireEvent.click(await screen.findByTestId("enter-log-time"));
    await screen.findByText("Log Week");
    await screen.findAllByText("Build widget");
    expect(screen.queryByText("Acme standup")).not.toBeInTheDocument();
  });
});


describe("CalendarPage — Live Tracking overlay", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("draws a server-running timer once, hiding its own DB block", async () => {
    const started = new Date(2026, 6, 28, 9, 0).toISOString();
    server.use(
      http.get("/api/v1/airtable/timers/", () =>
        HttpResponse.json({ results: [{ id: 1, action_item: "recAAA001", task: "Fix billing", account_name: "Acme Corp", started_at: started, ended_at: null, seconds: 0, calendar_event: 900 }] }),
      ),
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([
          { ...mockCalendarEvents[0], id: 900, google_event_id: "", title: "Fix billing", calendar_id: "work_tracking", agentpm_airtable_id: "recAAA001", start_datetime: started, end_datetime: new Date(2026, 6, 28, 9, 15).toISOString() },
          // Sentinel: once it renders, the week's events have loaded (the overlay alone
          // renders earlier, which would let the assertion pass before the block exists).
          { ...mockCalendarEvents[0], id: 901, google_event_id: "g-901", title: "Loaded sentinel", calendar_id: "primary", start_datetime: new Date(2026, 6, 28, 11, 0).toISOString(), end_datetime: new Date(2026, 6, 28, 12, 0).toISOString() },
        ]),
      ),
    );
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await waitFor(() => {
      const titles = Array.from(document.querySelectorAll("[data-testid='calendar-event']")).map((el) => el.textContent ?? "");
      expect(titles.some((t) => t.includes("Loaded sentinel"))).toBe(true);
    });
    await waitFor(() => {
      const titles = Array.from(document.querySelectorAll("[data-testid='calendar-event']")).map((el) => el.textContent ?? "");
      expect(titles.filter((t) => t.includes("Fix billing"))).toHaveLength(1);
      expect(titles).toContain("⏱ Fix billing"); // one stopwatch, not "⏱ ⏱"
    });
  });

  it("re-reads the visible week when a timer start/stop is broadcast", async () => {
    let gets = 0;
    server.use(http.get("/api/v1/scheduler/events/", () => { gets += 1; return HttpResponse.json([]); }));
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await screen.findByTestId("fullcalendar");
    await waitFor(() => expect(gets).toBeGreaterThan(0));
    const before = gets;
    // A real start: its POST also clears the 10s GET cache (lib/requestCache.ts), which is
    // what lets the broadcast refetch reach the network.
    const { startLiveTimer } = await import("../../lib/liveTimers");
    await startLiveTimer("recAAA001");
    await waitFor(() => expect(gets).toBeGreaterThan(before));
  });
});


describe("CalendarPage — compare calendars", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function serveAvailability() {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("/api/v1/team/members/", () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [
          { id: 7, user: 7, username: "ana", full_name: "Ana Diaz", email: "ana@example.com", title: "SA", department: "", tags: [], manager: null, manager_name: null, slack_handle: "", avatar_url: "", joined_at: null, created_at: "", updated_at: "" },
        ] }),
      ),
      http.get("/api/v1/scheduler/availability/", ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        return HttpResponse.json({
          start: params.get("start"), end: params.get("end"),
          people: (params.get("emails") ?? "").split(",").map((email) => ({
            email, name: email === "ana@example.com" ? "Ana Diaz" : email, source: "app", error: null,
            busy: [{ start: new Date(2026, 6, 29, 10).toISOString(), end: new Date(2026, 6, 29, 11).toISOString(), all_day: false, title: "Busy", title_visible: false }],
          })),
        });
      }),
    );
    return requests;
  }

  const gridTitles = () =>
    Array.from(document.querySelectorAll("[data-testid='calendar-event']")).map((el) => el.textContent ?? "");

  async function compareAna() {
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await screen.findByTestId("fullcalendar");
    fireEvent.focus(screen.getByRole("textbox", { name: "Search for people" }));
    fireEvent.click(await screen.findByText("Ana Diaz"));
  }

  it("overlays a teammate's busy time from one batched request", async () => {
    const requests = serveAvailability();
    await compareAna();
    await waitFor(() => expect(gridTitles()).toContain("Ana Diaz: Busy"));
    expect(requests).toHaveLength(1);
    expect(requests[0].get("emails")).toBe("ana@example.com");
    expect(screen.getByTestId("compared-person")).toHaveTextContent("Ana Diaz");
  });

  it("any typed email can be compared (Google free/busy for non-users)", async () => {
    const requests = serveAvailability();
    render(<MemoryRouter><AppErrorProvider><CalendarPage /></AppErrorProvider></MemoryRouter>);
    await screen.findByTestId("fullcalendar");
    const box = screen.getByRole("textbox", { name: "Search for people" });
    fireEvent.change(box, { target: { value: "zed@twilio.com" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(requests.at(-1)?.get("emails")).toBe("zed@twilio.com"));
  });

  it("existing view filters still apply to compared calendars", async () => {
    serveAvailability();
    await compareAna();
    await waitFor(() => expect(gridTitles()).toContain("Ana Diaz: Busy"));
    // The toolbar "Action Items" view hides meetings, compared ones included.
    fireEvent.click(document.querySelector("[data-fc-button='viewActionItems']") as HTMLElement);
    await waitFor(() => expect(gridTitles()).not.toContain("Ana Diaz: Busy"));
  });

  it("search narrows compared calendars too", async () => {
    serveAvailability();
    await compareAna();
    await waitFor(() => expect(gridTitles()).toContain("Ana Diaz: Busy"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search calendar" }), { target: { value: "nothing-matches" } });
    await waitFor(() => expect(gridTitles()).not.toContain("Ana Diaz: Busy"));
  });

  it("removing the last person clears the overlay", async () => {
    serveAvailability();
    await compareAna();
    await waitFor(() => expect(gridTitles()).toContain("Ana Diaz: Busy"));
    fireEvent.click(screen.getByRole("button", { name: "Stop comparing Ana Diaz" }));
    await waitFor(() => expect(gridTitles()).not.toContain("Ana Diaz: Busy"));
    expect(screen.queryByRole("button", { name: "Find free time" })).not.toBeInTheDocument();
  });
});


describe("CalendarPage — record links in the event panel", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function serveActionItemBlock(status = "Done") {
    const lookups: string[] = [];
    server.use(
      http.get("/api/v1/scheduler/events/", () =>
        HttpResponse.json([{ ...mockCalendarEvents[0], id: 9, google_event_id: "", title: "Fix billing", calendar_id: "work_tracking", agentpm_airtable_id: "recAAA001" }]),
      ),
      http.get("/api/v1/airtable/action-items/", ({ request }) => {
        const id = new URL(request.url).searchParams.get("airtable_id");
        if (id) lookups.push(id);
        return HttpResponse.json([{ ...mockActionItem, airtable_id: "recAAA001", task: "Fix billing", account_name: "Acme Corp", status }]);
      }),
      http.get("/api/v1/accounts/accounts/", () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 42, company_name: "Acme Corp" }] }),
      ),
      http.get("/api/v1/airtable/action-items/:id/attachments/", () => HttpResponse.json([])),
    );
    return lookups;
  }

  async function openBlock() {
    renderPage();
    const el = await waitFor(() => {
      const found = document.querySelector("[data-testid='calendar-event']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(el);
  }

  it("finds a Done item's block by direct lookup and lists the action item", async () => {
    const lookups = serveActionItemBlock("Done");
    await openBlock();
    expect(await screen.findByTestId("panel-action-item-link")).toHaveTextContent("Fix billing");
    expect(lookups).toContain("recAAA001");
  });

  it("the action item row opens the action item modal (no navigation)", async () => {
    serveActionItemBlock();
    await openBlock();
    fireEvent.click(await screen.findByTestId("panel-action-item-link"));
    expect(await screen.findByTestId("action-item-modal-panel")).toBeInTheDocument();
  });

  it("the account name links to the account page", async () => {
    serveActionItemBlock();
    await openBlock();
    const link = await screen.findByTestId("panel-account-link");
    expect(link).toHaveAttribute("href", "/accounts/42");
  });
});

// ── Pinned Claude skills row ─────────────────────────────────────────────────────────

describe("CalendarPage — pinned Claude skills", () => {
  const pinned = () => server.use(pagePinsFor("calendar", [
    mockPagePin({ id: 1, page: "calendar", skill: mockAgentSkill({ id: 1, name: "weekly-update" }) }),
    mockPagePin({ id: 2, page: "calendar", skill: mockAgentSkill({ id: 2, name: "renewal-check" }) }),
  ]));

  it("shows them in a row below the calendar with white buttons", async () => {
    pinned();
    renderPage();
    const row = await screen.findByTestId("calendar-skills-row");
    await within(row).findByRole("button", { name: /^Weekly Update/ });
    expect(within(row).getAllByTestId("pinned-chip")[0]).toHaveStyle({ background: "#fff" });
    expect(within(row).getByRole("button", { name: /^Renewal Check/ })).toBeInTheDocument();
    // Below the calendar: after the expand/collapse tab that closes the calendar card.
    const tab = screen.getByTitle(/Collapse calendar|Expand calendar/);
    expect(tab.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("scrolls sideways rather than wrapping when there are many", async () => {
    pinned();
    renderPage();
    const row = await screen.findByTestId("calendar-skills-row");
    await within(row).findByRole("button", { name: /^Weekly Update/ });
    expect(within(row).getByTestId("pinned-skills-calendar")).toHaveStyle({ overflowX: "auto", whiteSpace: "nowrap" });
  });

  it("is in the same box as the calendar, so it is exactly as wide", async () => {
    renderPage();
    const row = await screen.findByTestId("calendar-skills-row");
    const card = document.querySelector("[data-content-view]") as HTMLElement;
    expect(row.parentElement).toBe(card.parentElement);
  });
});
