import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import {
  DEFAULT_SLOT_MINUTES,
  LEGACY_SCHEDULED_ITEMS_KEY,
  LEGACY_SCHEDULED_REMINDERS_KEY,
  REMINDERS_CALENDAR_ID,
  WORK_TRACKING_CALENDAR_ID,
  endFor,
  hasActionItemAt,
  hasReminderAt,
  migrateLegacyScheduledItems,
  readLegacyItems,
  scheduleActionItem,
  scheduleReminder,
  startMinute,
} from "../calendarScheduling";
import { blankCalendarEvent } from "../../test/handlers/scheduler";
import type { CalendarEvent } from "../../types/scheduler";

/** Record every event-create request body so we can assert on the wire, not on a mock. */
function captureCreates(): Array<Partial<CalendarEvent>> {
  const bodies: Array<Partial<CalendarEvent>> = [];
  server.use(
    http.post("/api/v1/scheduler/events/", async ({ request }) => {
      const body = await request.json() as Partial<CalendarEvent>;
      bodies.push(body);
      return HttpResponse.json(
        { ...blankCalendarEvent(1000 + bodies.length), ...body, google_event_id: "", is_synced: false },
        { status: 201 },
      );
    }),
  );
  return bodies;
}

function workTrackingEvent(airtableId: string, start: string): CalendarEvent {
  return {
    ...blankCalendarEvent(1),
    calendar_id: WORK_TRACKING_CALENDAR_ID,
    agentpm_airtable_id: airtableId,
    start_datetime: start,
  };
}

describe("startMinute / endFor", () => {
  it("truncates an ISO string to the minute", () => {
    expect(startMinute("2026-09-15T11:30:45.123Z")).toBe("2026-09-15T11:30");
  });

  it("tolerates a missing value", () => {
    expect(startMinute(undefined as unknown as string)).toBe("");
  });

  it("keeps an explicit end", () => {
    expect(endFor("2026-09-15T11:00:00Z", "2026-09-15T12:00:00Z")).toBe("2026-09-15T12:00:00Z");
  });

  it("defaults to a 15-minute block", () => {
    const end = endFor("2026-09-15T11:00:00.000Z");
    expect(new Date(end).getTime() - new Date("2026-09-15T11:00:00.000Z").getTime())
      .toBe(DEFAULT_SLOT_MINUTES * 60_000);
  });

  it("returns the start unchanged when it cannot be parsed", () => {
    expect(endFor("not a date")).toBe("not a date");
  });
});

describe("duplicate detection", () => {
  const events = [workTrackingEvent("recAAA", "2026-09-15T11:00:00Z")];

  it("finds an action item already scheduled at the same minute", () => {
    expect(hasActionItemAt(events, "recAAA", "2026-09-15T11:00:00Z")).toBe(true);
  });

  it("ignores a different minute — the same item may be scheduled again", () => {
    expect(hasActionItemAt(events, "recAAA", "2026-09-15T14:00:00Z")).toBe(false);
  });

  it("ignores a different action item at the same minute", () => {
    expect(hasActionItemAt(events, "recBBB", "2026-09-15T11:00:00Z")).toBe(false);
  });

  it("does not treat a plain meeting at that minute as a duplicate", () => {
    const meeting = { ...workTrackingEvent("recAAA", "2026-09-15T11:00:00Z"), calendar_id: "primary" };
    expect(hasActionItemAt([meeting], "recAAA", "2026-09-15T11:00:00Z")).toBe(false);
  });

  it("matches a reminder by its reminder id", () => {
    const rem: CalendarEvent = {
      ...blankCalendarEvent(2),
      calendar_id: REMINDERS_CALENDAR_ID,
      reminder: 7,
      start_datetime: "2026-09-15T11:00:00Z",
    };
    expect(hasReminderAt([rem], 7, "2026-09-15T11:00:00Z")).toBe(true);
    expect(hasReminderAt([rem], 8, "2026-09-15T11:00:00Z")).toBe(false);
  });
});

describe("scheduleActionItem", () => {
  it("POSTs a work_tracking event carrying the airtable id", async () => {
    const bodies = captureCreates();
    await scheduleActionItem({
      airtableId: "rec9AwGLeyC2jMn2I",
      task: "Provision SQL Traits",
      start: "2026-09-15T11:00:00-07:00",
      end: "2026-09-15T11:15:00-07:00",
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      title: "Provision SQL Traits",
      calendar_id: WORK_TRACKING_CALENDAR_ID,
      agentpm_airtable_id: "rec9AwGLeyC2jMn2I",
      start_datetime: "2026-09-15T11:00:00-07:00",
      end_datetime: "2026-09-15T11:15:00-07:00",
    });
  });

  it("returns a row that is not yet synced, so the sync will push it", async () => {
    const created = await scheduleActionItem({
      airtableId: "recAAA", task: "T", start: "2026-09-15T11:00:00Z", end: "2026-09-15T11:15:00Z",
    });
    expect(created.google_event_id).toBe("");
    expect(created.is_synced).toBe(false);
  });

  it("refuses a local-* blank, which would orphan on promotion", async () => {
    const bodies = captureCreates();
    await expect(scheduleActionItem({
      airtableId: "local-123", task: "Blank", start: "2026-09-15T11:00:00Z", end: "",
    })).rejects.toThrow(/unsaved/i);
    expect(bodies).toHaveLength(0);
  });

  it("propagates a server failure instead of swallowing it", async () => {
    server.use(http.post("/api/v1/scheduler/events/", () =>
      new HttpResponse(null, { status: 500 })));

    await expect(scheduleActionItem({
      airtableId: "recAAA", task: "T", start: "2026-09-15T11:00:00Z", end: "",
    })).rejects.toBeTruthy();
  });
});

describe("scheduleReminder", () => {
  it("POSTs a reminders event linked to the reminder", async () => {
    const bodies = captureCreates();
    await scheduleReminder({ reminderId: 42, title: "Call back", start: "2026-09-15T11:00:00Z" });

    expect(bodies[0]).toMatchObject({
      title: "Call back",
      calendar_id: REMINDERS_CALENDAR_ID,
      reminder: 42,
    });
  });

  it("defaults the end to a 15-minute block", async () => {
    const bodies = captureCreates();
    await scheduleReminder({ reminderId: 42, title: "Call back", start: "2026-09-15T11:00:00.000Z" });

    const { start_datetime: start, end_datetime: end } = bodies[0];
    expect(new Date(end!).getTime() - new Date(start!).getTime())
      .toBe(DEFAULT_SLOT_MINUTES * 60_000);
  });
});

describe("migrateLegacyScheduledItems", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function seedItems(items: unknown[]) {
    localStorage.setItem(LEGACY_SCHEDULED_ITEMS_KEY, JSON.stringify(items));
  }

  it("does nothing when there is no legacy data", async () => {
    const bodies = captureCreates();
    const result = await migrateLegacyScheduledItems([]);

    expect(result).toEqual({ created: 0, alreadyPresent: 0, failed: 0 });
    expect(bodies).toHaveLength(0);
  });

  it("creates a row for each legacy entry and clears the key", async () => {
    seedItems([
      { airtableId: "recAAA", task: "One", start: "2026-09-15T11:00:00Z", end: "2026-09-15T11:15:00Z" },
      { airtableId: "recBBB", task: "Two", start: "2026-09-15T12:00:00Z", end: "2026-09-15T12:15:00Z" },
    ]);
    const bodies = captureCreates();
    const result = await migrateLegacyScheduledItems([]);

    expect(result.created).toBe(2);
    expect(bodies.map((b) => b.agentpm_airtable_id)).toEqual(["recAAA", "recBBB"]);
    expect(localStorage.getItem(LEGACY_SCHEDULED_ITEMS_KEY)).toBeNull();
  });

  it("skips an entry that already has a database row", async () => {
    seedItems([{ airtableId: "recAAA", task: "One", start: "2026-09-15T11:00:00Z", end: "" }]);
    const bodies = captureCreates();
    const result = await migrateLegacyScheduledItems([
      workTrackingEvent("recAAA", "2026-09-15T11:00:00Z"),
    ]);

    expect(result).toMatchObject({ created: 0, alreadyPresent: 1, failed: 0 });
    expect(bodies).toHaveLength(0);
  });

  it("does not create two rows for two legacy entries in the same slot", async () => {
    seedItems([
      { airtableId: "recAAA", task: "One", start: "2026-09-15T11:00:00Z", end: "" },
      { airtableId: "recAAA", task: "One again", start: "2026-09-15T11:00:00Z", end: "" },
    ]);
    const bodies = captureCreates();
    await migrateLegacyScheduledItems([]);

    expect(bodies).toHaveLength(1);
  });

  it("KEEPS the key when any create fails, so the next mount retries", async () => {
    // This is the whole point of the migration: clearing on partial success is exactly the
    // bug being undone. A duplicate row is recoverable; a dropped scheduling is not.
    seedItems([{ airtableId: "recAAA", task: "One", start: "2026-09-15T11:00:00Z", end: "" }]);
    server.use(http.post("/api/v1/scheduler/events/", () =>
      new HttpResponse(null, { status: 500 })));

    const result = await migrateLegacyScheduledItems([]);

    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect(localStorage.getItem(LEGACY_SCHEDULED_ITEMS_KEY)).not.toBeNull();
    expect(readLegacyItems()).toHaveLength(1);
  });

  it("clears the key when one entry fails and is later retried successfully", async () => {
    seedItems([{ airtableId: "recAAA", task: "One", start: "2026-09-15T11:00:00Z", end: "" }]);
    server.use(http.post("/api/v1/scheduler/events/", () =>
      new HttpResponse(null, { status: 500 })));
    await migrateLegacyScheduledItems([]);
    expect(localStorage.getItem(LEGACY_SCHEDULED_ITEMS_KEY)).not.toBeNull();

    server.resetHandlers();
    const result = await migrateLegacyScheduledItems([]);

    expect(result.created).toBe(1);
    expect(localStorage.getItem(LEGACY_SCHEDULED_ITEMS_KEY)).toBeNull();
  });

  it("migrates legacy reminders too", async () => {
    localStorage.setItem(LEGACY_SCHEDULED_REMINDERS_KEY, JSON.stringify([
      { reminderId: 7, title: "Ping", start: "2026-09-15T11:00:00Z", end: "2026-09-15T11:15:00Z" },
    ]));
    const bodies = captureCreates();
    const result = await migrateLegacyScheduledItems([]);

    expect(result.created).toBe(1);
    expect(bodies[0]).toMatchObject({ calendar_id: REMINDERS_CALENDAR_ID, reminder: 7 });
    expect(localStorage.getItem(LEGACY_SCHEDULED_REMINDERS_KEY)).toBeNull();
  });

  it("counts an unsaveable local-* entry as handled rather than pinning the key", async () => {
    seedItems([{ airtableId: "local-1", task: "Blank", start: "2026-09-15T11:00:00Z", end: "" }]);
    const result = await migrateLegacyScheduledItems([]);

    expect(result).toMatchObject({ created: 0, alreadyPresent: 1, failed: 0 });
    expect(localStorage.getItem(LEGACY_SCHEDULED_ITEMS_KEY)).toBeNull();
  });

  it("survives a corrupt localStorage value", async () => {
    localStorage.setItem(LEGACY_SCHEDULED_ITEMS_KEY, "{not json");
    await expect(migrateLegacyScheduledItems([])).resolves.toMatchObject({ created: 0 });
  });

  it("ignores a non-array stored value", async () => {
    localStorage.setItem(LEGACY_SCHEDULED_ITEMS_KEY, JSON.stringify({ nope: true }));
    expect(readLegacyItems()).toEqual([]);
  });
});
