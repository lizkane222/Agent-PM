import { describe, expect, it } from "vitest";
import { snoozeOptions } from "../reminderSnooze";

const opt = (now: Date, hasAccount = true) => Object.fromEntries(snoozeOptions(now, { hasAccount }).map((o) => [o.key, o]));

describe("snoozeOptions", () => {
  const NOW = new Date(2026, 10, 10, 14, 7, 42);

  it("offers 15 minutes later, before end of day, tomorrow morning and before the next account meeting", () => {
    expect(snoozeOptions(NOW, { hasAccount: true }).map((o) => o.label)).toEqual([
      "15 minutes later", "Before end of day", "Tomorrow morning", "Before next account meeting",
    ]);
  });

  it("15 minutes later is 15 minutes from now, on the minute", () => {
    expect(opt(NOW)["in_15"].until).toEqual(new Date(2026, 10, 10, 14, 22, 0));
  });

  it("end of day is 5:00 PM today", () => {
    expect(opt(NOW)["end_of_day"].until).toEqual(new Date(2026, 10, 10, 17, 0, 0));
    expect(opt(NOW)["end_of_day"].disabled).toBe(false);
  });

  it("end of day is unavailable once it is 5:00 PM, with a reason", () => {
    const late = opt(new Date(2026, 10, 10, 17, 30)).end_of_day;
    expect(late.disabled).toBe(true);
    expect(late.reason).toMatch(/past 5:00 PM/);
  });

  it("tomorrow morning is 9:00 AM the next day, including across a month end", () => {
    expect(opt(NOW)["tomorrow_9am"].until).toEqual(new Date(2026, 10, 11, 9, 0, 0));
    expect(opt(new Date(2026, 10, 30, 20, 0))["tomorrow_9am"].until).toEqual(new Date(2026, 11, 1, 9, 0, 0));
  });

  it("before the next account meeting is resolved by the server and needs an account", () => {
    const withAcct = opt(NOW)["next_account_meeting"];
    expect(withAcct.preset).toBe("next_account_meeting");
    expect(withAcct.until).toBeUndefined();
    expect(withAcct.disabled).toBe(false);
    const without = opt(NOW, false)["next_account_meeting"];
    expect(without.disabled).toBe(true);
    expect(without.reason).toMatch(/account/);
  });
});
