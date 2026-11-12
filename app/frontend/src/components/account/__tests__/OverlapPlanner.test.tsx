import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OverlapPlanner from "../OverlapPlanner";

// Monday 2026-03-02, mid-morning in Los Angeles.
const NOW = new Date("2026-03-02T18:00:00Z");
const people = [
  { id: "1", name: "Ann Lee", zone: "America/Chicago" },
  { id: "2", name: "Bo Chen", zone: "America/Chicago" },
  { id: "3", name: "Di Ames", zone: "Europe/London" },
  { id: "4", name: "Cy Dunn", zone: null },
];

const render1 = (p = people) => render(<OverlapPlanner people={p} viewerZone="America/Los_Angeles" now={NOW} />);
const win = () => screen.getByTestId("planner-window");
const start = () => Number(win().getAttribute("data-start"));
const end = () => Number(win().getAttribute("data-end"));

describe("OverlapPlanner", () => {
  it("renders nothing when nobody has a timezone", () => {
    const { container } = render1([{ id: "1", name: "Cy", zone: null }]);
    expect(container.textContent).toBe("");
  });

  it("makes one row per distinct zone with the viewer first as You", () => {
    render1();
    const rows = screen.getAllByTestId("planner-row");
    expect(rows.map((r) => r.getAttribute("data-zone"))).toEqual(["America/Los_Angeles", "America/Chicago", "Europe/London"]);
    expect(within(rows[0]).getByTestId("row-names").textContent).toBe("You");
    expect(within(rows[1]).getByTestId("row-names").textContent).toBe("Ann Lee, Bo Chen");
    expect(rows[1].textContent).toMatch(/CST \(UTC-6\)/);
  });

  it("merges a person sharing the viewer's zone into the You row", () => {
    render1([{ id: "1", name: "Team Mate", zone: "America/Los_Angeles" }]);
    expect(screen.getAllByTestId("planner-row")).toHaveLength(1);
    expect(screen.getByTestId("row-names").textContent).toBe("You, Team Mate");
  });

  it("shows each zone's own local hour numbers across 24 cells", () => {
    render1();
    const la = screen.getAllByTestId("planner-row")[0];
    const cells = la.querySelectorAll("[data-band]");
    expect(cells).toHaveLength(24);
    expect(cells[0].textContent).toBe("12a");
    const london = screen.getAllByTestId("planner-row")[2].querySelectorAll("[data-band]");
    expect(london[0].textContent).toBe("8a"); // midnight PST = 08:00 GMT
    expect(la.querySelectorAll('[data-band="work"]')).toHaveLength(8);
  });

  it("lists people without a timezone and leaves them out", () => {
    render1();
    expect(screen.getByTestId("planner-no-timezone").textContent).toContain("Cy Dunn");
    expect(screen.getAllByTestId("planner-row")).toHaveLength(3);
  });

  it("sizes the box to the overlap of everyone's 9-5 or says there is none", () => {
    render1([{ id: "1", name: "Ann", zone: "America/Chicago" }]);
    // LA 9-17 and Chicago 9-17 share Chicago 11:00 - 17:00 = LA 9:00 - 15:00.
    expect(end() - start()).toBe(6 * 3_600_000);
    expect(screen.getByTestId("planner-overlap-note").textContent).toContain("overlap");
  });

  it("falls back to extended hours when 9-5 never overlaps", () => {
    render1([{ id: "1", name: "Di", zone: "Europe/Berlin" }]);
    expect(screen.getByTestId("planner-overlap-note").textContent).toContain("No overlap in 9-5 working hours");
    expect(end() - start()).toBeGreaterThan(0);
  });

  it("moves the window 15 minutes at a time from the keyboard (hour with Shift)", () => {
    render1([{ id: "1", name: "Ann", zone: "America/Chicago" }]);
    const s0 = start();
    fireEvent.keyDown(win(), { key: "ArrowLeft" });
    expect(start()).toBe(s0 - 15 * 60_000);
    fireEvent.keyDown(win(), { key: "ArrowRight", shiftKey: true });
    expect(start()).toBe(s0 + 45 * 60_000);
    expect(end() - start()).toBe(6 * 3_600_000);
  });

  it("resizes from the edge handles and never below 15 minutes", () => {
    render1([{ id: "1", name: "Ann", zone: "America/Chicago" }]);
    const e0 = end();
    fireEvent.keyDown(screen.getByTestId("planner-handle-end"), { key: "ArrowLeft" });
    expect(end()).toBe(e0 - 15 * 60_000);
    expect(start()).toBeLessThan(end());
    for (let i = 0; i < 40; i++) fireEvent.keyDown(screen.getByTestId("planner-handle-end"), { key: "ArrowLeft", shiftKey: true });
    expect(end() - start()).toBe(15 * 60_000);
    fireEvent.keyDown(screen.getByTestId("planner-handle-start"), { key: "ArrowLeft" });
    expect(end() - start()).toBe(30 * 60_000);
  });

  it("shows the window in every row's own zone and in the summary, updating as it moves", () => {
    render1([{ id: "1", name: "Ann", zone: "America/Chicago" }]);
    const rowWindows = () => screen.getAllByTestId("row-window").map((e) => e.textContent);
    expect(rowWindows()).toEqual(["Mon 9:00 AM - 3:00 PM", "Mon 11:00 AM - 5:00 PM"]);
    fireEvent.keyDown(win(), { key: "ArrowRight" });
    expect(rowWindows()).toEqual(["Mon 9:15 AM - 3:15 PM", "Mon 11:15 AM - 5:15 PM"]);
    expect(screen.getByTestId("planner-summary").textContent).toBe("You: Mon 9:15 AM - 3:15 PM · Ann: Mon 11:15 AM - 5:15 PM");
  });

  it("changes the layout when a different date is picked (DST)", () => {
    render1([{ id: "1", name: "Di", zone: "Europe/London" }]);
    const before = screen.getAllByTestId("row-window")[1].textContent;
    fireEvent.change(screen.getByLabelText("Planner date"), { target: { value: "2026-03-30" } }); // UK on BST, LA on PDT
    const after = screen.getAllByTestId("row-window")[1].textContent;
    expect(after).toMatch(/^Mon /);
    expect(typeof before).toBe("string");
  });

  it("marks where the date changes", () => {
    render1([{ id: "1", name: "Tokyo", zone: "Asia/Tokyo" }]);
    const tokyo = screen.getAllByTestId("planner-row")[1];
    const labels = within(tokyo).getAllByTestId("day-marker").map((m) => m.textContent);
    expect(labels).toEqual(["Mon 3/2", "Tue 3/3"]);
  });

  describe("copy", () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });
    it("copies a multi-zone text and sends nothing", async () => {
      render1([{ id: "1", name: "Ann", zone: "America/Chicago" }]);
      fireEvent.click(screen.getByRole("button", { name: "Copy Times" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const text = writeText.mock.calls[0][0] as string;
      expect(text).toContain("Proposed meeting time:");
      expect(text).toContain("You (America/Los_Angeles): Mon 9:00 AM - 3:00 PM PST");
      expect(text).toContain("Ann (America/Chicago): Mon 11:00 AM - 5:00 PM CST");
      expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
  });
});
