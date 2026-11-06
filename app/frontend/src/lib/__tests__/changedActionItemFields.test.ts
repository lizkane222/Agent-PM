import { describe, it, expect } from "vitest";
import { changedActionItemFields } from "../actionItemLog";
import type { AirtableActionItem } from "../../types";

const before = {
  task: "Fix billing", status: "Open", time_spent: 900, estimated_time: 0,
  slack_thread_url: null, account: 3, account_name: "Acme",
} as unknown as AirtableActionItem;

describe("changedActionItemFields", () => {
  it("omits untouched fields — notably time_spent", () => {
    expect(changedActionItemFields(before, { ...before, task: "Fix billing v2" })).toEqual({ task: "Fix billing v2" });
  });

  it("returns an empty patch for an unedited form", () => {
    expect(changedActionItemFields(before, { ...before })).toEqual({});
  });

  it("treats null / '' / 0 as the same blank value", () => {
    expect(changedActionItemFields(before, { slack_thread_url: "", estimated_time: null as unknown as number })).toEqual({});
  });

  it("sends a deliberate time_spent edit", () => {
    expect(changedActionItemFields(before, { ...before, time_spent: 1800 })).toEqual({ time_spent: 1800 });
  });

  it("sends account and account_name together when either changes", () => {
    expect(changedActionItemFields(before, { ...before, account_name: "Beta", account: 3 }))
      .toEqual({ account: 3, account_name: "Beta" });
  });
});
