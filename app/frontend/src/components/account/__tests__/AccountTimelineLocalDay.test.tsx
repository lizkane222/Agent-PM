import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AccountTimeline } from "../AccountTimeline";
import { localDateKey } from "../../../lib/timelineDay";

/** The most recent weekday (the timeline only draws Mon-Fri), at 4:30 PM LOCAL time. */
function recentWeekdayEvening(): Date {
  const d = new Date();
  d.setHours(16, 30, 0, 0);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() - 1);
  return d;
}

describe("shared AccountTimeline buckets by the local day", () => {
  const prev = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
  afterAll(() => { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; });

  it("draws an evening event in its own day column, not the next UTC day", () => {
    const start = recentWeekdayEvening(); // 4:30 PM Pacific == 00:30 UTC the following day
    const ev = { id: 901, title: "Evening sync", start_datetime: start.toISOString(), end_datetime: new Date(start.getTime() + 1800000).toISOString(), status: "confirmed" };
    const { container } = render(
      <MemoryRouter>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <AccountTimeline {...({ meetings: [], calendarEvents: [ev], actionItems: [], onSelectMeeting: () => {}, onSelectCalEvent: () => {}, onSelectAction: () => {} } as any)} />
      </MemoryRouter>,
    );
    const column = container.querySelector(`[data-date="${localDateKey(start)}"]`) as HTMLElement;
    expect(column).toBeTruthy();
    expect(column.textContent).toContain("Evening sync");
    // and it is not drawn in the UTC (next) day's column
    const utcDay = start.toISOString().slice(0, 10);
    if (utcDay !== localDateKey(start)) {
      const wrong = container.querySelector(`[data-date="${utcDay}"]`);
      if (wrong) expect(wrong.textContent).not.toContain("Evening sync");
    }
  });
});
