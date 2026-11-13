import { describe, expect, it } from "vitest";
import {
  buildReminderPayload, channelsFromDefaults, channelsOf, newlyAdded, REMINDER_CHANNELS, reminderSaveError, type ReminderDraft,
} from "../reminderDraft";

const draft = (over: Partial<ReminderDraft> = {}): ReminderDraft => ({
  title: "  Call Acme ", body: " notes ", dueLocal: "2026-12-01T15:00", links: [],
  channels: { notify_in_app: true, notify_push: false, notify_sms: false, notify_slack: false }, recipients: [], ...over,
});

describe("REMINDER_CHANNELS", () => {
  it("is the same four channels, labelled the same way, wherever a reminder is made", () => {
    expect(REMINDER_CHANNELS.map((c) => c.label)).toEqual(["In-app", "Laptop", "Phone", "Slack"]);
    expect(REMINDER_CHANNELS.map((c) => c.key)).toEqual(["notify_in_app", "notify_push", "notify_sms", "notify_slack"]);
  });
});

describe("channelsFromDefaults / channelsOf", () => {
  it("pre-ticks the user's own Settings", () => {
    expect(channelsFromDefaults({
      notify_default_in_app: true, notify_default_slack: false, notify_default_push: true, notify_default_sms: true,
    })).toEqual({ notify_in_app: true, notify_push: true, notify_sms: true, notify_slack: false });
  });

  it("reads a reminder's channels back", () => {
    expect(channelsOf({ notify_in_app: false, notify_push: true, notify_sms: false, notify_slack: true }))
      .toEqual({ notify_in_app: false, notify_push: true, notify_sms: false, notify_slack: true });
  });
});

describe("buildReminderPayload", () => {
  it("trims text, sends the due time as a real instant, and sends links whole", () => {
    const links = [{ resource_type: "account" as const, resource_id: 1, resource_label: "Acme" }];
    const p = buildReminderPayload(draft({ links }));
    expect(p.title).toBe("Call Acme");
    expect(p.body).toBe("notes");
    expect(p.due_at).toBe(new Date("2026-12-01T15:00").toISOString());
    expect(p.links).toEqual(links);
  });

  it("carries the creator's channels", () => {
    const p = buildReminderPayload(draft({ channels: { notify_in_app: false, notify_push: true, notify_sms: true, notify_slack: false } }));
    expect(p).toMatchObject({ notify_in_app: false, notify_push: true, notify_sms: true, notify_slack: false });
  });

  it("always sends recipients, so removing someone works, and no approval flag when nobody is new", () => {
    const p = buildReminderPayload(draft({ recipients: [] }), [4]);
    expect(p.recipients).toEqual([]);
    expect(p).not.toHaveProperty("confirm_notify_others");
  });

  it("attaches the approval only when somebody new is being added", () => {
    expect(buildReminderPayload(draft({ recipients: [4, 7] }), [4])).toMatchObject({ recipients: [4, 7], confirm_notify_others: true });
    expect(buildReminderPayload(draft({ recipients: [4] }), [4])).not.toHaveProperty("confirm_notify_others");
    expect(buildReminderPayload(draft({ recipients: [4] }))).toMatchObject({ confirm_notify_others: true });
  });

  it("has one shape for every form", () => {
    expect(Object.keys(buildReminderPayload(draft())).sort()).toEqual(
      ["body", "due_at", "links", "notify_in_app", "notify_push", "notify_slack", "notify_sms", "recipients", "title"],
    );
  });
});

describe("newlyAdded", () => {
  it("is who is in the new list but was not in the original", () => {
    expect(newlyAdded([1, 2, 3], [2])).toEqual([1, 3]);
    expect(newlyAdded([], [2])).toEqual([]);
    expect(newlyAdded([2], [2])).toEqual([]);
  });
});

describe("reminderSaveError", () => {
  it("shows the server's first message, whatever the field", () => {
    expect(reminderSaveError({ response: { data: { recipients: ["Ana has turned off being notified."] } } })).toBe("Ana has turned off being notified.");
    expect(reminderSaveError({ response: { data: { detail: "Nope." } } })).toBe("Nope.");
  });

  it("falls back to a plain sentence", () => {
    expect(reminderSaveError(new Error("boom"))).toBe("Couldn't save the reminder. Please try again.");
    expect(reminderSaveError({ response: { data: {} } })).toBe("Couldn't save the reminder. Please try again.");
  });

  it("never echoes exception text", () => {
    expect(reminderSaveError(new Error("AC123 secret"))).not.toContain("AC123");
  });
});
