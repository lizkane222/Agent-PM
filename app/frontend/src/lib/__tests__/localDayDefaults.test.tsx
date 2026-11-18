import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import LogTimeModal from "../../components/calendar/LogTimeModal";
import { convertActionItemToEvent } from "../../hooks/useConvert";
import { readFileSync } from "node:fs";
import type { AirtableActionItem } from "../../types";

// 4:30 PM Pacific on Tue Nov 10 2026 == 00:30 UTC on Wed Nov 11. The UTC date is a day ahead.
const EVENING_PT = new Date("2026-11-11T00:30:00Z");

describe("evening defaults use the user's local day", () => {
  const prev = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
  afterAll(() => { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; });
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(EVENING_PT); });
  afterEach(() => { vi.useRealTimers(); });

  it("LogTimeModal defaults to today (Nov 10), not tomorrow", () => {
    render(<LogTimeModal project={{ sf_id: "a0", name: "P" } as never} onClose={() => {}} onLogged={() => {}} />);
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-11-10");
  });

  for (const [name, fn] of [["hooks/useConvert", convertActionItemToEvent]] as const) {
    it(`${name}: an item with no due date becomes 9-10 AM local today, as real instants`, async () => {
      let body: Record<string, string> = {};
      server.use(
        http.post("/api/v1/scheduler/events/", async ({ request }) => {
          body = (await request.json()) as Record<string, string>;
          return HttpResponse.json({ id: 1, ...body });
        }),
        http.all("*", () => HttpResponse.json({}), { once: false }),
      );
      await fn({ id: 1, airtable_id: "rec1", task: "T", due_date: null } as unknown as AirtableActionItem).catch(() => {});
      // 9 AM PST == 17:00Z on the 10th; the UTC-date bug gave 09:00 on the 11th.
      expect(body.start_datetime).toBe("2026-11-10T17:00:00.000Z");
      expect(body.end_datetime).toBe("2026-11-10T18:00:00.000Z");
    });
  }

  for (const [name, fn] of [["hooks/useConvert", convertActionItemToEvent]] as const) {
    it(`${name}: a due date becomes 9-10 AM local on that date, as real instants`, async () => {
      let body: Record<string, string> = {};
      server.use(
        http.post("/api/v1/scheduler/events/", async ({ request }) => {
          body = (await request.json()) as Record<string, string>;
          return HttpResponse.json({ id: 1, ...body });
        }),
        http.all("*", () => HttpResponse.json({})),
      );
      await fn({ id: 1, airtable_id: "rec1", task: "T", due_date: "2026-11-20" } as unknown as AirtableActionItem).catch(() => {});
      expect(body.start_datetime).toBe("2026-11-20T17:00:00.000Z");
      expect(body.end_datetime).toBe("2026-11-20T18:00:00.000Z");
    });
  }

  // The action-items sidebar is a single implementation now (CalendarPage imports it). It must send an
  // instant, not a zoneless string.
  for (const file of ["src/components/calendar/ActionItemsSidebar.tsx"]) {
    it(`${file} sends the reminder time as a real instant`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("fromLocalDatetimeValue(`${reminderDate}T${reminderTime}`)");
      expect(src).not.toContain("`${reminderDate}T${reminderTime}:00`");
    });
  }
});
