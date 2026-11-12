import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import OverlapPlanner, { type PlannerPerson } from "../OverlapPlanner";
import { groupByZone, rowLabel } from "../../../lib/overlapPlanner";

// Monday 2026-03-02; LA and Chicago share LA 9:00-15:00 (17:00Z-23:00Z).
const NOW = new Date("2026-03-02T18:00:00Z");
const people: PlannerPerson[] = [
  { id: "m:1", name: "Ann Lee", zone: "America/Chicago", email: "ann@twilio.com", kind: "team" as const },
  { id: "m:2", name: "Bo Chen", zone: "America/Los_Angeles", email: "bo@twilio.com", kind: "team" as const },
  { id: "c:1", name: "Di Ames", zone: "America/Chicago", email: "di@customer.com" },
];
let requested: URL[] = [];
function availability(opts: { status?: number; failFirst?: boolean } = {}) {
  let calls = 0;
  server.use(http.get("*/api/v1/scheduler/availability/", ({ request }) => {
    const url = new URL(request.url);
    requested.push(url);
    calls++;
    if (opts.status || (opts.failFirst && calls === 1)) return HttpResponse.json({ detail: "boom" }, { status: opts.status ?? 500 });
    const mk = (title: string, visible: boolean, s: string, e: string) => ({ start: s, end: e, all_day: false, title, title_visible: visible });
    return HttpResponse.json({
      start: url.searchParams.get("start"), end: url.searchParams.get("end"),
      people: [
        { email: "ann@twilio.com", name: "Ann Lee", source: "app", error: null, busy: [mk("Roadmap sync", true, "2026-03-02T18:00:00Z", "2026-03-02T19:00:00Z"), mk("Busy", false, "2026-03-02T22:00:00Z", "2026-03-02T23:30:00Z")] },
        { email: "bo@twilio.com", name: "Bo Chen", source: "app", error: null, busy: [mk("Busy", false, "2026-03-02T12:00:00Z", "2026-03-02T13:00:00Z")] },
      ],
    });
  }));
}
function mockMedia(large: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: large, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}
afterEach(() => { delete (window as unknown as { matchMedia?: unknown }).matchMedia; });
const setup = (p = people) => { requested = []; return render(<OverlapPlanner people={p} viewerZone="America/Los_Angeles" now={NOW} />); };
const win = () => screen.getByTestId("planner-window");

describe("OverlapPlanner team calendars", () => {
  it("loads once for the day without the exclude toggle and shows only events inside the window", async () => {
    availability();
    mockMedia(true);
    setup();
    await waitFor(() => expect(screen.getAllByTestId("planner-cal-col")).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId("planner-cal-event")).toHaveLength(2)); // window LA 9-15 = 17Z-23Z; Bo's 12Z block is outside
    // Ann's 22:00Z-23:30Z block is clipped to the window, shown as Busy
    const ann = screen.getAllByTestId("planner-cal-col").find((c) => c.getAttribute("data-person") === "Ann Lee")!;
    expect(within(ann).getAllByTestId("planner-cal-event").map((e) => e.getAttribute("data-title"))).toEqual(["Roadmap sync", "Busy"]);
    const bo = screen.getAllByTestId("planner-cal-col").find((c) => c.getAttribute("data-person") === "Bo Chen")!;
    expect(within(bo).getByTestId("planner-cal-empty")).toBeInTheDocument();
    expect(requested).toHaveLength(1);
    expect(requested[0].searchParams.get("emails")).toBe("ann@twilio.com,bo@twilio.com"); // contact excluded
  });

  it("re-slices when the window changes without a second request", async () => {
    availability();
    mockMedia(true);
    setup();
    await waitFor(() => expect(screen.getAllByTestId("planner-cal-event").length).toBeGreaterThan(0));
    // Move the window 3h earlier (Shift+ArrowLeft = 1h steps) so Bo's 12Z-13Z block comes into view.
    for (let i = 0; i < 5; i++) fireEvent.keyDown(win(), { key: "ArrowLeft", shiftKey: true });
    await waitFor(() => {
      const bo = screen.getAllByTestId("planner-cal-col").find((c) => c.getAttribute("data-person") === "Bo Chen")!;
      expect(within(bo).getAllByTestId("planner-cal-event")).toHaveLength(1);
    });
    expect(requested).toHaveLength(1);
  });

  it("uses the side-by-side layout on large screens and the scroller on small ones", async () => {
    availability();
    mockMedia(true);
    const { unmount } = setup();
    await waitFor(() => expect(screen.getByTestId("planner-calendars")).toHaveAttribute("data-layout", "side"));
    expect(screen.getByTestId("planner-split").className).toMatch(/grid-cols-2/);
    expect(within(screen.getByTestId("planner-scroll")).queryByTestId("planner-calendars")).toBeNull();
    unmount();
    mockMedia(false);
    setup();
    await waitFor(() => expect(screen.getByTestId("planner-calendars")).toHaveAttribute("data-layout", "scroll"));
    expect(within(screen.getByTestId("planner-scroll")).getByTestId("planner-calendars")).toBeInTheDocument();
    for (const row of screen.getAllByTestId("planner-row")) {
      const label = row.firstElementChild as HTMLElement;
      expect(label.style.position).toBe("sticky");
      expect(label.style.left).toBe("0px");
    }
  });

  it("shows an error with retry", async () => {
    availability({ failFirst: true });
    mockMedia(true);
    setup();
    const alert = await screen.findByTestId("planner-cal-error");
    expect(alert.textContent).toMatch(/boom/);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByTestId("planner-cal-event").length).toBeGreaterThan(0));
    expect(requested).toHaveLength(2);
  });

  it("renders no calendars panel without team members with an email", () => {
    availability();
    setup([{ id: "c:1", name: "Di Ames", zone: "America/Chicago", email: "di@customer.com" }]);
    expect(screen.queryByTestId("planner-calendars")).toBeNull();
    expect(requested).toHaveLength(0);
  });
});

describe("current user dedupe", () => {
  const me: PlannerPerson = { id: "m:9", name: "Liz Kane", zone: "America/Los_Angeles", email: "liz@twilio.com", kind: "team", isSelf: true };

  it("groupByZone drops the You row when the viewer is selected", () => {
    const rows = groupByZone([me, people[0]], "America/Los_Angeles");
    expect(rows.map((r) => rowLabel(r))).toEqual(["Liz Kane", "Ann Lee"]);
    expect(rows.some((r) => r.isYou)).toBe(false);
  });

  it("keeps the You row when the viewer is not selected", () => {
    expect(rowLabel(groupByZone([people[0]], "America/Los_Angeles")[0])).toBe("You");
  });

  it("shows the user once under their name in rows, summary and copy text", () => {
    availability();
    setup([me, people[0]]);
    const names = screen.getAllByTestId("row-names").map((n) => n.textContent);
    expect(names).toEqual(["Liz Kane", "Ann Lee"]);
    expect(screen.getByTestId("planner-summary").textContent).not.toMatch(/You/);
    expect(screen.getByTestId("planner-summary").textContent).toMatch(/Liz Kane/);
  });

  it("falls back to the viewer's zone when the user has no team timezone, and never lists them under No timezone", () => {
    availability();
    setup([{ ...me, zone: null }, { id: "c:2", name: "Zed", zone: null }]);
    expect(screen.getAllByTestId("row-names").map((n) => n.textContent)).toEqual(["Liz Kane"]);
    expect(screen.getByTestId("planner-no-timezone").textContent).toMatch(/Zed/);
    expect(screen.getByTestId("planner-no-timezone").textContent).not.toMatch(/Liz/);
  });

  it("asks for the user's own calendar and shows it, with full titles, in Team calendars", async () => {
    mockMedia(true);
    requested = [];
    server.use(http.get("*/api/v1/scheduler/availability/", ({ request }) => {
      const url = new URL(request.url);
      requested.push(url);
      // Like the real endpoint: the viewer's own row only comes back when include_self is sent.
      const self = url.searchParams.get("include_self") === "1";
      return HttpResponse.json({ start: "", end: "", people: self ? [{
        email: "liz@twilio.com", name: "Liz Kane", source: "app", error: null,
        busy: [{ start: "2026-03-02T18:00:00Z", end: "2026-03-02T19:00:00Z", all_day: false, title: "My 1:1", title_visible: true }],
      }] : [] });
    }));
    setup([me]);
    await waitFor(() => expect(screen.getAllByTestId("planner-cal-event")).toHaveLength(1));
    expect(screen.getAllByTestId("planner-cal-col")).toHaveLength(1);
    expect(screen.getByTestId("planner-cal-event").getAttribute("data-title")).toBe("My 1:1");
    expect(requested[0].searchParams.get("include_self")).toBe("1");
    expect(requested[0].searchParams.get("emails")).toBe("liz@twilio.com");
  });

  it("uses the team timezone when it differs from the viewer's", () => {
    availability();
    setup([{ ...me, zone: "Europe/London" }]);
    const rows = screen.getAllByTestId("planner-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-zone")).toBe("Europe/London");
  });
});
