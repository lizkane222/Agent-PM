// Which notification channels to test after "Save Profile": only options the user *changed*
// in this edit and that are now *on*. Unchanged or switched-off options are never tested.

export type TestChannel = "in_app" | "push" | "sms" | "slack" | "slack_general" | "email";

export interface NotificationSnapshot {
  notify_default_in_app: boolean;
  notify_default_slack: boolean;
  notify_default_push: boolean;
  notify_default_sms: boolean;
  notification_email: boolean;
  notification_slack: boolean;
}

const CHANNEL_FOR: Record<keyof NotificationSnapshot, TestChannel> = {
  notify_default_in_app: "in_app",
  notify_default_slack: "slack",
  notify_default_push: "push",
  notify_default_sms: "sms",
  notification_email: "email",
  notification_slack: "slack_general",
};

export const CHANNEL_LABEL: Record<TestChannel, string> = {
  in_app: "In-app",
  slack: "Slack DM",
  push: "Laptop (desktop push)",
  sms: "Phone (SMS)",
  email: "Email",
  slack_general: "Slack notifications",
};

export function channelsToTest(saved: NotificationSnapshot, current: NotificationSnapshot): TestChannel[] {
  const out: TestChannel[] = [];
  for (const key of Object.keys(CHANNEL_FOR) as (keyof NotificationSnapshot)[]) {
    if (current[key] && current[key] !== saved[key]) out.push(CHANNEL_FOR[key]);
  }
  return out;
}
