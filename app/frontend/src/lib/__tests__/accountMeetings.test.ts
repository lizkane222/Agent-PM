import { describe, it, expect } from "vitest";
import { timelineMeetingCount } from "../accountMeetings";

describe("timelineMeetingCount", () => {
  it("counts dated meetings plus calendar-only events, as the Timeline draws them", () => {
    const r = timelineMeetingCount(
      [{ airtable_id: "recA", date: "2026-01-01" }, { airtable_id: "recB", date: "2026-01-02" }],
      [{ agentpm_airtable_id: "" }, { agentpm_airtable_id: "" }],
    );
    expect(r).toEqual({ total: 4, withRecord: 2, calendarOnly: 2 });
  });
  it("does not double count a calendar event that is the calendar side of a listed meeting", () => {
    const r = timelineMeetingCount([{ airtable_id: "recA", date: "2026-01-01" }], [{ agentpm_airtable_id: "recA" }]);
    expect(r.total).toBe(1);
  });
  it("ignores undated meetings, which the Timeline cannot place", () => {
    expect(timelineMeetingCount([{ airtable_id: "recA", date: null }], []).total).toBe(0);
  });
  it("counts an event linked to a meeting that is not in the list", () => {
    expect(timelineMeetingCount([], [{ agentpm_airtable_id: "recGone" }]).total).toBe(1);
  });
});
