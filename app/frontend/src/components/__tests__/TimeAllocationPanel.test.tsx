import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAllocation } from "../../test/handlers/profile";
import type { TimeAllocationRow } from "../../types/salesforce";
import TimeAllocationPanel, {
  allocationDays, rowsToDayAccounts, localDate, NO_ACCOUNT_LABEL, ADMIN_LABEL,
} from "../TimeAllocationPanel";

const today = () => localDate(new Date());
const row = (over: Partial<TimeAllocationRow> = {}): TimeAllocationRow => ({
  date: today(), account: "Acme Corp", minutes: 60, source: "logged", ...over,
});
const serve = (rows: TimeAllocationRow[], extra = {}) =>
  server.use(http.get("*/api/v1/salesforce/time-allocation/", () => HttpResponse.json(mockAllocation(rows, extra))));

describe("allocationDays", () => {
  it("runs from the 1st of the previous calendar month through today", () => {
    const days = allocationDays(new Date(2026, 10, 4)); // 4 Nov 2026
    expect(days[0]).toBe("2026-10-01");
    expect(days[days.length - 1]).toBe("2026-11-04");
    expect(days).toHaveLength(31 + 4);
  });

  it("includes two full months of days on the last day of a long month", () => {
    const days = allocationDays(new Date(2026, 11, 31));
    expect(days[0]).toBe("2026-11-01");
    expect(days).toHaveLength(30 + 31);
  });

  it("starts in the previous year in January", () => {
    const days = allocationDays(new Date(2027, 0, 10));
    expect(days[0]).toBe("2026-12-01");
    expect(days[days.length - 1]).toBe("2027-01-10");
  });

  it("on the 1st of a month, shows last month plus today", () => {
    expect(allocationDays(new Date(2026, 10, 1))).toHaveLength(32);
  });

  it("is ordered, contiguous and has no duplicates across a DST change", () => {
    const days = allocationDays(new Date(2026, 10, 20));
    expect(new Set(days).size).toBe(days.length);
    for (let i = 1; i < days.length; i++) {
      const [y, m, d] = days[i - 1].split("-").map(Number);
      expect(days[i]).toBe(localDate(new Date(y, m - 1, d + 1)));
    }
  });
});

describe("localDate", () => {
  it("uses the local calendar day, not the UTC one", () => {
    expect(localDate(new Date(2026, 10, 4, 23, 30))).toBe("2026-11-04");
  });
});

describe("rowsToDayAccounts", () => {
  const days = ["2026-10-20", "2026-10-21"];

  it("keeps each row's account, minutes and source", () => {
    const out = rowsToDayAccounts([
      row({ date: "2026-10-20", minutes: 90 }),
      row({ date: "2026-10-21", account: "Globex", minutes: 30, source: "calendar" }),
    ], days);
    expect(out).toEqual([
      { date: "2026-10-20", account: "Acme Corp", minutes: 90, source: "logged" },
      { date: "2026-10-21", account: "Globex", minutes: 30, source: "calendar" },
    ]);
  });

  it("shows logged time with no account under a visible 'No account' label", () => {
    const out = rowsToDayAccounts([row({ date: "2026-10-20", account: "" })], days);
    expect(out[0].account).toBe(NO_ACCOUNT_LABEL);
  });

  it("ignores rows outside the window and empty rows", () => {
    expect(rowsToDayAccounts([row({ date: "2026-09-30" }), row({ date: "2026-10-20", minutes: 0 })], days)).toEqual([]);
  });
});

describe("TimeAllocationPanel", () => {
  it("shows a loading state, then the empty state with the date range", async () => {
    render(<TimeAllocationPanel />);
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    expect(await screen.findByText(/Nothing to show between/i)).toBeInTheDocument();
  });

  it("asks the server for the previous month through today", async () => {
    let search = "";
    server.use(http.get("*/api/v1/salesforce/time-allocation/", ({ request }) => {
      search = new URL(request.url).search;
      return HttpResponse.json(mockAllocation());
    }));
    render(<TimeAllocationPanel />);
    await screen.findByText(/Nothing to show between/i);
    const days = allocationDays(new Date());
    expect(search).toContain(`start=${days[0]}`);
    expect(search).toContain(`end=${days[days.length - 1]}`);
  });

  it("says so when the request fails", async () => {
    server.use(http.get("*/api/v1/salesforce/time-allocation/", () => new HttpResponse(null, { status: 500 })));
    render(<TimeAllocationPanel />);
    expect(await screen.findByText(/Could not load your logged time/i)).toBeInTheDocument();
  });

  it("opens every view scrolled to today and lets it scroll sideways", async () => {
    serve([row()]);
    const { container } = render(<TimeAllocationPanel />);
    await screen.findByText(/across 1 account/i);
    const scroller = container.querySelector("div[style*='overflow-x: auto']") as HTMLElement;
    const svg = scroller.querySelector("svg") as SVGElement;
    expect(parseInt(svg.style.width, 10)).toBeGreaterThan(800);
  });

  describe("logged time and calendar time together", () => {
    const rows = [
      row({ account: "Autodesk", minutes: 120, source: "logged" }),
      row({ account: "JPMC", minutes: 90, source: "calendar" }),
    ];

    it("totals both and explains how much of it is only on the calendar", async () => {
      serve(rows, { inferred_minutes: 30 });
      render(<TimeAllocationPanel />);
      expect(await screen.findByText(/3h 30m across 2 accounts/i)).toBeInTheDocument();
      const note = screen.getByTestId("allocation-breakdown");
      expect(note).toHaveTextContent("2h logged");
      expect(note).toHaveTextContent("1h 30m from your calendar, not logged yet");
      expect(note).toHaveTextContent("30m matched to an account by name");
    });

    it("says how much calendar time is not linked to any account, so it is not silently dropped", async () => {
      serve(rows, { unlinked_calendar_minutes: 6000 });
      render(<TimeAllocationPanel />);
      expect(await screen.findByTestId("allocation-breakdown")).toHaveTextContent("100h of calendar time isn't linked to an account");
    });

    it("shows no calendar wording when everything is logged", async () => {
      serve([row()]);
      render(<TimeAllocationPanel />);
      const note = await screen.findByTestId("allocation-breakdown");
      expect(note).toHaveTextContent("1h logged");
      expect(note.textContent).not.toMatch(/calendar/i);
      expect(screen.queryByText(/from calendar events, not logged yet/i)).toBeNull();
    });

    it("bar chart: calendar-sourced bars are lighter and dashed, logged ones solid", async () => {
      serve(rows);
      const { container } = render(<TimeAllocationPanel />);
      await screen.findByText(/across 2 accounts/i);
      const bars = Array.from(container.querySelectorAll("rect[data-source]"));
      const logged = bars.find(b => b.getAttribute("data-source") === "logged") as SVGElement;
      const cal = bars.find(b => b.getAttribute("data-source") === "calendar") as SVGElement;
      expect(logged.getAttribute("opacity")).toBe("1");
      expect(logged.getAttribute("stroke-dasharray")).toBeNull();
      expect(cal.getAttribute("opacity")).toBe("0.5");
      expect(cal.getAttribute("stroke-dasharray")).toBeTruthy();
      expect(screen.getByText(/Dashed \/ lighter = from calendar events, not logged yet/i)).toBeInTheDocument();
    });

    it("table: calendar cells are italic with an explanation", async () => {
      serve(rows);
      const { container } = render(<TimeAllocationPanel />);
      await screen.findByText(/across 2 accounts/i);
      fireEvent.click(screen.getByRole("button", { name: "Table" }));
      await screen.findByRole("table");
      const cal = container.querySelector("span[data-source=calendar]") as HTMLElement;
      const logged = container.querySelector("span[data-source=logged]") as HTMLElement;
      expect(cal.style.fontStyle).toBe("italic");
      expect(cal.getAttribute("title")).toMatch(/not logged yet/i);
      expect(logged.style.fontStyle).toBe("");
    });

    it("heatmap: calendar cells are outlined with a dashed stroke", async () => {
      serve(rows);
      const { container } = render(<TimeAllocationPanel />);
      await screen.findByText(/across 2 accounts/i);
      fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));
      await waitFor(() => expect(container.querySelector("rect[data-source=calendar]")).toBeTruthy());
      expect(container.querySelector("rect[data-source=calendar]")?.getAttribute("stroke-dasharray")).toBeTruthy();
      expect(container.querySelector("rect[data-source=logged]")?.getAttribute("stroke-dasharray")).toBeNull();
    });
  });

  describe("every one of the user's accounts shows up in all three views", () => {
    const rows = [
      row({ account: "Autodesk", minutes: 120 }),
      row({ account: "JPMC", minutes: 90 }),
      row({ account: "Siemens", minutes: 60, source: "calendar" }),
      row({ account: "", minutes: 30 }),
    ];
    const ACCOUNTS = ["Autodesk", "JPMC", "Siemens"];

    it("bar chart: a legend entry per account, and 'No account' only for the unattributed time", async () => {
      serve(rows);
      render(<TimeAllocationPanel />);
      expect(await screen.findByText(/5h across 4 accounts/i)).toBeInTheDocument();
      for (const a of [...ACCOUNTS, NO_ACCOUNT_LABEL]) expect(screen.getByText(a)).toBeInTheDocument();
    });

    it("table: one row per account with its own total", async () => {
      serve(rows);
      render(<TimeAllocationPanel />);
      await screen.findByText(/across 4 accounts/i);
      fireEvent.click(screen.getByRole("button", { name: "Table" }));
      const table = await screen.findByRole("table");
      for (const [name, total] of [["Autodesk", "2h"], ["JPMC", "1h 30m"], ["Siemens", "1h"], [NO_ACCOUNT_LABEL, "30m"]]) {
        const tr = within(table).getByText(name).closest("tr") as HTMLElement;
        expect(tr.textContent).toContain(total);
      }
    });

    it("heatmap: a labelled row per account", async () => {
      serve(rows);
      const { container } = render(<TimeAllocationPanel />);
      await screen.findByText(/across 4 accounts/i);
      fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));
      await waitFor(() => expect(container.querySelector("svg text")).toBeTruthy());
      const labels = Array.from(container.querySelectorAll("svg text")).map(t => t.textContent);
      for (const a of [...ACCOUNTS, NO_ACCOUNT_LABEL]) expect(labels).toContain(a);
    });
  });

  it("only the allocation endpoint is used (not logged-entries, events or action items directly)", async () => {
    // Any other request would hit onUnhandledRequest: "error".
    render(<TimeAllocationPanel />);
    await screen.findByText(/Nothing to show between/i);
  });
});

describe("frozen axes and the Admin row", () => {
  it("bar chart: the hours axis is outside the scrolling area, so it never scrolls away", async () => {
    serve([row({ account: "Autodesk", minutes: 120 })]);
    const { container } = render(<TimeAllocationPanel />);
    await screen.findByText(/across 1 account/i);
    const axis = screen.getByTestId("bar-y-axis");
    expect(axis.textContent).toMatch(/\dh|\dm/);
    const scroller = container.querySelector("div[style*='overflow-x: auto']") as HTMLElement;
    expect(scroller.contains(axis)).toBe(false);
    // The hour labels live only in the frozen axis; the scrolling plot has none.
    expect(scroller.textContent).not.toMatch(/^\s*\d+h/);
    expect(scroller.querySelectorAll("line").length).toBeGreaterThan(0);
  });

  it("table: the Account column (header, rows and total) is sticky at the left", async () => {
    serve([row({ account: "Autodesk", minutes: 120 })]);
    const { container } = render(<TimeAllocationPanel />);
    await screen.findByText(/across 1 account/i);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    await screen.findByRole("table");
    const frozen = Array.from(container.querySelectorAll("[data-frozen='account']")) as HTMLElement[];
    // header + Admin + Autodesk + footer
    expect(frozen.length).toBe(4);
    for (const el of frozen) {
      expect(el.style.position).toBe("sticky");
      expect(el.style.left).toBe("0px");
      expect(el.style.background).not.toBe("transparent");
    }
  });

  it("heatmap: the account list is outside the scrolling area", async () => {
    serve([row({ account: "Autodesk", minutes: 120 })]);
    const { container } = render(<TimeAllocationPanel />);
    await screen.findByText(/across 1 account/i);
    fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));
    const labels = await screen.findByTestId("heatmap-accounts");
    const scroller = container.querySelector("div[style*='overflow-x: auto']") as HTMLElement;
    expect(scroller.contains(labels)).toBe(false);
    expect(labels.textContent).toContain("Autodesk");
    expect(scroller.textContent).not.toContain("Autodesk");
  });

  it("Admin is listed first in all three views even when no time went to it", async () => {
    serve([row({ account: "Autodesk", minutes: 120 })]);
    render(<TimeAllocationPanel />);
    await screen.findByText(/across 1 account/i);
    expect(screen.getByText(ADMIN_LABEL)).toBeInTheDocument(); // legend
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = await screen.findByRole("table");
    const names = within(table).getAllByRole("row").map(r => r.querySelector("td")?.textContent?.trim());
    expect(names.indexOf(ADMIN_LABEL)).toBe(1); // right after the header row
    fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));
    expect((await screen.findByTestId("heatmap-accounts")).textContent).toContain(ADMIN_LABEL);
  });

  it("shows Admin time when there is some", async () => {
    serve([row({ account: ADMIN_LABEL, minutes: 90 }), row({ account: "Autodesk", minutes: 60 })]);
    render(<TimeAllocationPanel />);
    expect(await screen.findByText(/2h 30m across 2 accounts/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const tr = (await screen.findByText(ADMIN_LABEL, { selector: "td" })).closest("tr") as HTMLElement;
    expect(tr.textContent).toContain("1h 30m");
  });
});
