import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { mockCalendarEvents } from "../../test/handlers/scheduler";
import { mockUserProfile } from "../../test/handlers/team";
import {
  DARK_TEXT,
  DEFAULT_CATEGORY_COLORS,
  EVENT_TYPE_META,
  IMPORTANT_PALETTE,
  borderFor,
  readableTextColor,
  withAlpha,
} from "../../lib/eventColors";
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
    const { datesSet, events, eventDidMount, select, eventClick } = props as {
      datesSet?: (info: {
        startStr: string;
        endStr: string;
        view: { type: string };
      }) => void;
      events?: Array<{
        id: string;
        title: string;
        backgroundColor?: string;
        borderColor?: string;
        extendedProps?: unknown;
      }>;
      eventDidMount?: (info: { event: unknown; el: HTMLElement }) => void;
      select?: (info: { startStr: string; endStr: string }) => void;
      eventClick?: (info: { event: unknown }) => void;
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
          // Surfaced so tests can assert per-category event colors.
          "data-bg-color": ev.backgroundColor,
          "data-border-color": ev.borderColor,
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
    }) {
      return props.onShowUnlinkedView
        ? React.createElement(
            "button",
            {
              onClick: props.onShowUnlinkedView,
              "data-unlinked-active": props.isUnlinkedView ? "true" : "false",
            },
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
        <AppErrorProvider>
          <CalendarPage />
        </AppErrorProvider>,
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
