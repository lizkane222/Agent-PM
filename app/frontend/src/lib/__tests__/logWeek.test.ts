import { describe, expect, it } from "vitest";
import {
  buildLogDescription,
  decimalHours,
  hasWarnings,
  isSalesforceId,
  roundUpToQuarterHour,
} from "../logWeek";
import { weekPlanReport, mockSkippedEvent } from "../../test/handlers/salesforce";

// These helpers are the browser halves of salesforce_sync/log_week.py's
// round_up_to_quarter_hour / _build_description. If the two ever disagree, the panel
// shows one number and Cloud Coach records another — so the cases below mirror the
// Python tests in salesforce_sync/tests/test_log_week.py exactly.
describe("roundUpToQuarterHour", () => {
  it("rounds up, never down", () => {
    expect(roundUpToQuarterHour(50)).toBe(60);
    expect(roundUpToQuarterHour(31)).toBe(45);
    expect(roundUpToQuarterHour(1)).toBe(15);
  });

  it("leaves exact quarter hours alone", () => {
    expect(roundUpToQuarterHour(15)).toBe(15);
    expect(roundUpToQuarterHour(30)).toBe(30);
    expect(roundUpToQuarterHour(60)).toBe(60);
  });

  it("clamps zero and negative to zero", () => {
    expect(roundUpToQuarterHour(0)).toBe(0);
    expect(roundUpToQuarterHour(-5)).toBe(0);
  });
});

describe("decimalHours", () => {
  it("converts to the two-decimal hours Cloud Coach stores", () => {
    expect(decimalHours(90)).toBe(1.5);
    expect(decimalHours(45)).toBe(0.75);
    expect(decimalHours(0)).toBe(0);
  });

  it("rounds rather than accumulating float noise", () => {
    expect(decimalHours(50)).toBe(0.83);
  });
});

describe("buildLogDescription", () => {
  it("lists each title then a total", () => {
    expect(buildLogDescription(["Standup", "Design review"], 90)).toBe(
      "Standup\nDesign review\nTotal: 1.50 hrs"
    );
  });

  it("still emits a total with no titles", () => {
    expect(buildLogDescription([], 60)).toBe("Total: 1.00 hrs");
  });
});

describe("isSalesforceId", () => {
  it("accepts 15 and 18 character ids", () => {
    expect(isSalesforceId("005000000000001")).toBe(true);
    expect(isSalesforceId("005000000000001AAA")).toBe(true);
  });

  it("rejects the pseudo-ids the panel invents for local and admin rows", () => {
    // `promoteBlankItem`-style pseudo ids have no Cloud Coach record to write to.
    expect(isSalesforceId("local-7")).toBe(false);
    expect(isSalesforceId("admin-pseudo-2")).toBe(false);
    expect(isSalesforceId("")).toBe(false);
  });

  it("rejects an id of the wrong length", () => {
    expect(isSalesforceId("005")).toBe(false);
    expect(isSalesforceId("005000000000001AAAAAA")).toBe(false);
  });
});

describe("hasWarnings", () => {
  it("is false for a clean report, so the modal stays hidden", () => {
    expect(hasWarnings(weekPlanReport())).toBe(false);
  });

  it("is false for a null report", () => {
    expect(hasWarnings(null)).toBe(false);
  });

  it("is true when an event has no linked account", () => {
    expect(hasWarnings(weekPlanReport({ unlinked_events: [mockSkippedEvent()] }))).toBe(true);
  });

  it("is true when an event is marked did-not-attend", () => {
    const report = weekPlanReport({
      not_attended_events: [mockSkippedEvent({ reason: "did_not_attend" })],
    });
    expect(hasWarnings(report)).toBe(true);
  });

  it("is true when an account has no Cloud Coach project", () => {
    const report = weekPlanReport({
      account_without_project: [mockSkippedEvent({ reason: "no_cloud_coach_project" })],
    });
    expect(hasWarnings(report)).toBe(true);
  });

  it("is not triggered by already-logged entries alone", () => {
    // Re-running Log Week on a fully-logged week is a no-op, not a problem worth a modal.
    expect(hasWarnings(weekPlanReport({ already_logged_count: 3 }))).toBe(false);
  });
});
