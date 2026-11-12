import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { AccountTimeline } from "../AccountTimeline";
import { mockActionItem } from "../../../test/handlers/action_items";
import { localDateKey } from "../../../lib/timelineDay";

/** The most recent weekday (the timeline only draws Mon-Fri), at noon local time. */
function recentWeekday(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() - 1);
  return d;
}

// An action item dragged onto a meeting's notes on the calendar gets `linked_meeting` set.
// The account page's timeline then lists it under that meeting, whatever its status.
describe("AccountTimeline — action items linked to a meeting", () => {
  const day = recentWeekday();
  const meeting = { id: 5, airtable_id: "recMTG5", name: "QBR prep", date: localDateKey(day) };
  const render_ = (items: unknown[]) => render(
    <MemoryRouter>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <AccountTimeline {...({ meetings: [meeting], calendarEvents: [], actionItems: items, onSelectMeeting: () => {}, onSelectCalEvent: () => {}, onSelectAction: () => {} } as any)} />
    </MemoryRouter>,
  );

  it("lists an Open (not Done) item under the meeting it is linked to", () => {
    render_([{ ...mockActionItem, airtable_id: "recL1", task: "Send recap deck", status: "Open", due_date: null, linked_meeting: 5, linked_meeting_name: "QBR prep" }]);
    expect(screen.getByText("QBR prep")).toBeInTheDocument();
    expect(screen.getByTitle("Send recap deck")).toBeInTheDocument();
  });

  it("does not list an item linked to a different meeting", () => {
    render_([{ ...mockActionItem, airtable_id: "recL2", task: "Unrelated follow-up", status: "Open", due_date: null, linked_meeting: 99, linked_meeting_name: "Other" }]);
    expect(screen.queryByTitle("Unrelated follow-up")).not.toBeInTheDocument();
  });
});
