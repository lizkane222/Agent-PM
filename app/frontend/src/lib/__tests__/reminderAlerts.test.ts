import { describe, expect, it } from "vitest";
import { outstandingAlerts } from "../reminderAlerts";
import { mockNotification } from "../../test/handlers/profile";

const n = (id: number, over = {}) => mockNotification({ id, ...over });

describe("outstandingAlerts", () => {
  it("is every unread in-app reminder notification, oldest first", () => {
    expect(outstandingAlerts([n(12), n(9), n(11)]).map((x) => x.id)).toEqual([9, 11, 12]);
  });

  it("never times out: an old unread reminder is still outstanding", () => {
    expect(outstandingAlerts([n(1, { created_at: "2020-01-01T00:00:00Z" })]).map((x) => x.id)).toEqual([1]);
  });

  it("drops acknowledged ones", () => {
    expect(outstandingAlerts([n(1, { read_at: "2026-11-10T21:00:00Z" }), n(2)]).map((x) => x.id)).toEqual([2]);
  });

  it("ignores other channels, other kinds, and deliveries that failed or were skipped", () => {
    expect(outstandingAlerts([
      n(1, { channel: "sms" }), n(2, { kind: "comment_reply" }), n(3, { status: "failed" }), n(4, { status: "skipped" }), n(5),
    ]).map((x) => x.id)).toEqual([5]);
  });

  it("is empty for an empty history", () => {
    expect(outstandingAlerts([])).toEqual([]);
  });
});
