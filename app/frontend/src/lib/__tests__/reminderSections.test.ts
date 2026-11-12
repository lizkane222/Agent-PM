import { describe, expect, it } from "vitest";
import { classifyReminder, groupReminders, OCCURRENCE_MS, reminderTimes } from "../reminderSections";
import { mockReminders } from "../../test/handlers/scheduler";
import type { Reminder } from "../../types/scheduler";

const NOW = new Date(2026, 10, 10, 14, 0, 0); // Tue 10 Nov 2026, 2:00 PM local
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const rem = (over: Partial<Reminder> = {}): Reminder => ({
  ...mockReminders[0], id: 1, status: "pending", due_at: at(10, 16), occurrences: [], ...over,
});
const occ = (iso: string, id = 1) => ({ id, start: iso, end: new Date(new Date(iso).getTime() + OCCURRENCE_MS).toISOString() });

describe("classifyReminder", () => {
  it("puts a reminder due later today in Today", () => {
    expect(classifyReminder(rem(), NOW).section).toBe("today");
  });

  it("puts a reminder due on a later day in Upcoming", () => {
    expect(classifyReminder(rem({ due_at: at(11, 9) }), NOW).section).toBe("upcoming");
  });

  it("puts a reminder whose time has passed in Historical", () => {
    expect(classifyReminder(rem({ due_at: at(10, 9) }), NOW).section).toBe("historical");
    expect(classifyReminder(rem({ due_at: at(8, 9), status: "sent" }), NOW).section).toBe("historical");
  });

  it("keeps a reminder in Today while its 15 minutes are running, then moves it on", () => {
    const r = rem({ due_at: at(10, 14) });
    expect(classifyReminder(r, new Date(2026, 10, 10, 14, 10)).section).toBe("today");
    expect(classifyReminder(r, new Date(2026, 10, 10, 14, 14, 59)).section).toBe("today");
    expect(classifyReminder(r, new Date(2026, 10, 10, 14, 15)).section).toBe("historical");
  });

  it("a dismissed reminder is Historical even if its time is in the future", () => {
    expect(classifyReminder(rem({ due_at: at(12, 9), status: "dismissed" }), NOW).section).toBe("historical");
  });

  it("goes by the next unfinished time when it is on the calendar several times", () => {
    const r = rem({ due_at: at(9, 9), occurrences: [occ(at(9, 9)), occ(at(10, 17), 2), occ(at(13, 9), 3)] });
    const c = classifyReminder(r, NOW);
    expect(c.section).toBe("today");
    expect(c.at.toISOString()).toBe(at(10, 17));
  });

  it("is Historical only when every time has finished", () => {
    const r = rem({ due_at: at(9, 9), occurrences: [occ(at(9, 9)), occ(at(10, 9), 2)] });
    const c = classifyReminder(r, NOW);
    expect(c.section).toBe("historical");
    expect(c.at.toISOString()).toBe(at(10, 9)); // shows the most recent time
  });

  it("uses the local day, so 11:30 PM tonight is Today and 12:30 AM is Upcoming", () => {
    expect(classifyReminder(rem({ due_at: at(10, 23, 30) }), NOW).section).toBe("today");
    expect(classifyReminder(rem({ due_at: at(11, 0, 30) }), NOW).section).toBe("upcoming");
  });

  it("tolerates a reminder with no occurrences field", () => {
    const r = rem(); delete (r as Partial<Reminder>).occurrences;
    expect(classifyReminder(r, NOW).section).toBe("today");
  });
});

describe("reminderTimes", () => {
  it("lists the due time and every block once, earliest first", () => {
    const r = rem({ due_at: at(10, 16), occurrences: [occ(at(12, 9)), occ(at(10, 16), 2), occ(at(10, 8), 3)] });
    expect(reminderTimes(r).map((d) => d.toISOString())).toEqual([at(10, 8), at(10, 16), at(12, 9)]);
  });
});

describe("groupReminders", () => {
  it("sorts Today and Upcoming soonest first and Historical most recent first", () => {
    const g = groupReminders([
      rem({ id: 1, due_at: at(10, 18) }), rem({ id: 2, due_at: at(10, 15) }),
      rem({ id: 3, due_at: at(13, 9) }), rem({ id: 4, due_at: at(11, 9) }),
      rem({ id: 5, due_at: at(8, 9) }), rem({ id: 6, due_at: at(9, 9) }),
    ], NOW);
    expect(g.today.map((c) => c.reminder.id)).toEqual([2, 1]);
    expect(g.upcoming.map((c) => c.reminder.id)).toEqual([4, 3]);
    expect(g.historical.map((c) => c.reminder.id)).toEqual([6, 5]);
  });

  it("files every reminder in exactly one section", () => {
    const all = [rem({ id: 1 }), rem({ id: 2, due_at: at(12, 9) }), rem({ id: 3, due_at: at(1, 9) }), rem({ id: 4, status: "dismissed" })];
    const g = groupReminders(all, NOW);
    expect(g.today.length + g.upcoming.length + g.historical.length).toBe(all.length);
  });

  it("moves a reminder to Historical as the clock advances", () => {
    const r = rem({ due_at: at(10, 14, 30) });
    expect(groupReminders([r], new Date(2026, 10, 10, 14, 29)).today).toHaveLength(1);
    expect(groupReminders([r], new Date(2026, 10, 10, 14, 45)).historical).toHaveLength(1);
  });
});
