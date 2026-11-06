import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { AccountTimeline } from "../AccountTimeline";
import { mockAirtableMeeting } from "../../../test/handlers/accounts";

/** Noon on the most recent weekday — the timeline only renders Mon–Fri. */
function recentWeekdayNoon(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

function renderWith(gong: string, zoom: string) {
  const m = { ...mockAirtableMeeting, date: recentWeekdayNoon(), gong_notes: gong, zoom_notes: zoom };
  return render(
    <MemoryRouter>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <AccountTimeline {...({ meetings: [m], calendarEvents: [], actionItems: [], onSelectMeeting: () => {}, onSelectCalEvent: () => {}, onSelectAction: () => {} } as any)} />
    </MemoryRouter>
  );
}

describe("meeting timeline notes status", () => {
  it("shows a check once notes exist", () => {
    renderWith("Recap", "");
    expect(screen.getByTestId("meeting-notes-status")).toHaveAttribute("data-has-notes", "true");
  });
  it("shows a different icon while no Gong or Zoom notes exist", () => {
    renderWith("", "\n");
    const el = screen.getByTestId("meeting-notes-status");
    expect(el).toHaveAttribute("data-has-notes", "false");
    expect(el).toHaveTextContent("◷");
  });
  it("treats a Zoom recording-link block as no notes yet", () => {
    renderWith("", "Recording\n- Shareable link: https://twilio.zoom.us/rec/share/abc");
    expect(screen.getByTestId("meeting-notes-status")).toHaveAttribute("data-has-notes", "false");
  });
});
