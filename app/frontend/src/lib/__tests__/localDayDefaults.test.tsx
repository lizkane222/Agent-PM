import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import LogTimeModal from "../../components/calendar/LogTimeModal";
import RemindersTabContent from "../../components/calendar/RemindersTabContent";
import { convertActionItemToEvent } from "../../hooks/useConvert";
import { convertActionItemToEvent as convertLib } from "../useConvert";
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

  it("RemindersTabContent shows 5:00 PM local and sends that instant, not 5:00 PM UTC", async () => {
    let sent: Record<string, string> = {};
    server.use(http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
      sent = (await request.json()) as Record<string, string>;
      return HttpResponse.json({ id: 9, status: "pending", body: "", notify_in_app: true, ...sent });
    }));
    render(<RemindersTabContent onDropToast={() => {}} />);
    fireEvent.click(await screen.findByText("+ New Reminder"));
    const input = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(input.value).toBe("2026-11-10T17:00");
    fireEvent.change(screen.getByPlaceholderText(/title|what/i), { target: { value: "Call" } });
    fireEvent.click(screen.getByRole("button", { name: /^(save|add|create)/i }));
    await waitFor(() => expect(sent.due_at).toBe("2026-11-11T01:00:00.000Z"));
  });

  for (const [name, fn] of [["hooks/useConvert", convertActionItemToEvent], ["lib/useConvert", convertLib]] as const) {
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

  for (const [name, fn] of [["hooks/useConvert", convertActionItemToEvent], ["lib/useConvert", convertLib]] as const) {
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

  // CalendarPage's sidebar can't be rendered in isolation (not exported), so pin the source,
  // the way sidebarOrderingParity.test.ts does. Both copies must send an instant, not a zoneless string.
  for (const file of ["src/pages/CalendarPage.tsx", "src/components/calendar/ActionItemsSidebar.tsx"]) {
    it(`${file} sends the reminder time as a real instant`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("fromLocalDatetimeValue(`${reminderDate}T${reminderTime}`)");
      expect(src).not.toContain("`${reminderDate}T${reminderTime}:00`");
    });
  }
});
