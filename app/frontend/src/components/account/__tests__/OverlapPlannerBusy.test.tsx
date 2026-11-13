import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import OverlapPlanner from "../OverlapPlanner";

// Monday 2026-03-02. LA 9-17 and Chicago 9-17 share LA 9:00-15:00 (17:00Z-23:00Z).
const NOW = new Date("2026-03-02T18:00:00Z");
const people = [
  { id: "m:1", name: "Ann Lee", zone: "America/Chicago", email: "ann@twilio.com" },
  { id: "m:2", name: "Bo Chen", zone: "America/Los_Angeles", email: "bo@twilio.com" },
  { id: "m:3", name: "No Mail", zone: "America/Chicago" },
  { id: "c:1", name: "Di Ames", zone: null, email: "di@customer.com" },
];
const BTN = "Exclude busy times for Twilio Team";
const win = () => screen.getByTestId("planner-window");
const start = () => Number(win().getAttribute("data-start"));
const end = () => Number(win().getAttribute("data-end"));
const H = 3_600_000;

let requested: URL[] = [];
function availability(busy: Record<string, { start: string; end: string }[]>, status = 200) {
  server.use(http.get("*/api/v1/scheduler/availability/", ({ request }) => {
    const url = new URL(request.url);
    requested.push(url);
    if (status !== 200) return HttpResponse.json({ detail: "boom" }, { status });
    const emails = (url.searchParams.get("emails") ?? "").split(",");
    return HttpResponse.json({
      start: url.searchParams.get("start"), end: url.searchParams.get("end"),
      people: emails.map((e) => ({ email: e, name: e, source: "app", error: null, busy: (busy[e] ?? []).map((b) => ({ ...b, all_day: false, title: "Busy", title_visible: false })) })),
    });
  }));
}
const setup = (p = people) => { requested = []; return render(<OverlapPlanner people={p} viewerZone="America/Los_Angeles" now={NOW} />); };
const dayStart = Date.UTC(2026, 2, 2, 8); // LA midnight

describe("OverlapPlanner busy exclusion", () => {
  it("shows the exact button label and the team-only note", () => {
    setup();
    expect(screen.getByRole("button", { name: BTN })).toBeEnabled();
    expect(screen.getByTestId("planner-busy-note").textContent).toMatch(/Only Twilio team members' calendars/);
  });

  it("queries only team members with an email, draws busy lanes and excludes them from the overlap", async () => {
    availability({ "ann@twilio.com": [{ start: "2026-03-02T17:00:00Z", end: "2026-03-02T18:00:00Z" }] });
    setup();
    expect(end() - start()).toBe(6 * H);
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Include busy times" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("busy-block")).toHaveLength(1));
    expect(requested).toHaveLength(1);
    expect(requested[0].searchParams.get("emails")).toBe("ann@twilio.com,bo@twilio.com");
    expect(screen.getByTestId("busy-block").getAttribute("title")).toMatch(/Ann Lee is busy/);
    await waitFor(() => expect(start()).toBe(dayStart + 10 * H)); // LA 10:00
    expect(end()).toBe(dayStart + 15 * H); // LA 15:00
  });

  it("offers alternatives as clickable chips", async () => {
    availability({ "bo@twilio.com": [{ start: "2026-03-02T20:00:00Z", end: "2026-03-02T21:00:00Z" }] }); // LA 12-13
    setup();
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    const chips = await screen.findAllByRole("button", { name: /^Free: / });
    expect(chips.map((c) => c.textContent)).toEqual([
      "Free: Mon 9:00 AM - 12:00 PM PST", "Free: Mon 1:00 PM - 3:00 PM PST",
    ]);
    fireEvent.click(chips[1]);
    expect(start()).toBe(dayStart + 13 * H);
    expect(end()).toBe(dayStart + 15 * H);
  });

  it("says there is no shared free time and names the nearest conflict", async () => {
    availability({ "ann@twilio.com": [{ start: "2026-03-02T17:00:00Z", end: "2026-03-02T23:30:00Z" }] });
    setup();
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    await waitFor(() => expect(screen.getByTestId("planner-overlap-note").textContent).toBe("No shared free time - everyone busy or outside 9-5"));
    expect(screen.getByTestId("planner-nearest-conflict").textContent).toMatch(/Ann Lee is busy Mon 9:00 AM - 3:00 PM/);
    expect(screen.queryByTestId("planner-free-windows")).toBeNull();
  });

  it("tints the box and lists who conflicts when it is dragged onto busy time", async () => {
    availability({ "ann@twilio.com": [{ start: "2026-03-02T17:00:00Z", end: "2026-03-02T18:00:00Z" }] });
    setup();
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    await waitFor(() => expect(start()).toBe(dayStart + 10 * H));
    expect(screen.queryByTestId("planner-conflicts")).toBeNull();
    for (let i = 0; i < 2; i++) fireEvent.keyDown(win(), { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByTestId("planner-conflicts").textContent).toMatch(/Ann Lee is busy/);
    expect(win().style.border).toContain("rgb(217, 119, 6)");
  });

  it("toggling back clears the exclusion", async () => {
    availability({ "ann@twilio.com": [{ start: "2026-03-02T17:00:00Z", end: "2026-03-02T18:00:00Z" }] });
    setup();
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    await waitFor(() => expect(screen.getAllByTestId("busy-block")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Include busy times" }));
    expect(screen.queryByTestId("busy-block")).toBeNull();
    expect(screen.getByRole("button", { name: BTN })).toBeInTheDocument();
    await waitFor(() => expect(start()).toBe(dayStart + 9 * H)); // back to LA 9:00
    expect(end() - start()).toBe(6 * H);
  });

  it("shows an inline error when the request fails", async () => {
    availability({}, 500);
    setup();
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    expect((await screen.findByTestId("planner-busy-error")).textContent).toMatch(/boom/);
    expect(end() - start()).toBe(6 * H);
  });

  it("refetches when the date changes while enabled", async () => {
    availability({});
    setup();
    fireEvent.click(screen.getByRole("button", { name: BTN }));
    await waitFor(() => expect(requested).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Planner date"), { target: { value: "2026-03-03" } });
    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested[1].searchParams.get("start")).not.toBe(requested[0].searchParams.get("start"));
  });

  it("disables the button when no team member has an email", () => {
    setup([{ id: "c:1", name: "Di", zone: "Europe/London", email: "di@customer.com" }]);
    expect(screen.getByRole("button", { name: BTN })).toBeDisabled();
  });

  it("styles the box as a lifted handle with shadow, overhang and grab cursor", () => {
    setup();
    const s = win().style;
    expect(s.boxShadow).toContain("0 4px 12px");
    expect(s.top).toBe("-8px");
    expect(s.bottom).toBe("-4px");
    expect(s.cursor).toBe("grab");
    fireEvent.pointerDown(win(), { clientX: 10, pointerId: 1 });
    expect(win().style.cursor).toBe("grabbing");
    fireEvent.pointerUp(win());
    expect(win().style.cursor).toBe("grab");
    expect(screen.getByTestId("planner-handle-start").style.cursor).toBe("ew-resize");
  });
});
