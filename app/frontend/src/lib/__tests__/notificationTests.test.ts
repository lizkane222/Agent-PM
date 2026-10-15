import { describe, it, expect } from "vitest";
import { channelsToTest, type NotificationSnapshot } from "../notificationTests";

const off: NotificationSnapshot = {
  notify_default_in_app: false, notify_default_slack: false, notify_default_push: false,
  notify_default_sms: false, notification_email: false, notification_slack: false,
};

describe("channelsToTest", () => {
  it("returns only options changed to on", () => {
    expect(channelsToTest(off, { ...off, notify_default_sms: true, notification_slack: true })).toEqual(["sms", "slack_general"]);
  });
  it("ignores unchanged options and ones switched off", () => {
    const saved = { ...off, notify_default_in_app: true, notify_default_push: true };
    expect(channelsToTest(saved, { ...saved, notify_default_push: false })).toEqual([]);
  });
});
