import { describe, it, expect, beforeEach, vi } from "vitest";
import { logActionItemUpdate } from "../actionItemLog";
import { addLog } from "../appLog";
import type { AirtableActionItem } from "../../types";

// Spy on the single log writer so we test the diff logic / phrasing without touching
// the network (addLog fires a fire-and-forget POST to /realtime/activity/).
vi.mock("../appLog", () => ({ addLog: vi.fn() }));

const mockAddLog = vi.mocked(addLog);

function makeItem(overrides: Partial<AirtableActionItem> = {}): AirtableActionItem {
  return {
    id: 1,
    airtable_id: "recABC",
    task: "Fix billing issue",
    task_details: "",
    status: "Open",
    priority: "Medium",
    due_date: "",
    assignee_name: "",
    account_name: "",
    estimated_time: 0,
    time_spent: 0,
    prep_time: 0,
    slack_thread_url: "",
    ...overrides,
  } as AirtableActionItem;
}

beforeEach(() => {
  mockAddLog.mockClear();
});

describe("logActionItemUpdate", () => {
  it("logs a single status change with a before → after clause", () => {
    logActionItemUpdate(makeItem(), { status: "In Progress" });
    expect(mockAddLog).toHaveBeenCalledTimes(1);
    const entry = mockAddLog.mock.calls[0][0];
    expect(entry.category).toBe("action_item");
    expect(entry.message).toBe('"Fix billing issue" — Status: Open → In Progress');
    expect(entry.resource).toEqual({ type: "action_item", id: "recABC" });
    expect(entry.links).toEqual([{ label: "View action items", path: "/action-items" }]);
  });

  it("summarises multiple changed fields in one entry, in field order", () => {
    logActionItemUpdate(makeItem(), {
      status: "Done",
      priority: "High",
      assignee_name: "Jane",
    });
    expect(mockAddLog).toHaveBeenCalledTimes(1);
    expect(mockAddLog.mock.calls[0][0].message).toBe(
      '"Fix billing issue" — Status: Open → Done; Priority: Medium → High; Reassigned to Jane',
    );
  });

  it("does not log when no field actually changed", () => {
    logActionItemUpdate(makeItem({ status: "Open" }), { status: "Open" });
    expect(mockAddLog).not.toHaveBeenCalled();
  });

  it("ignores fields present in the patch but equal to the current value", () => {
    logActionItemUpdate(makeItem({ priority: "Medium", status: "Open" }), {
      priority: "Medium",
      status: "In Progress",
    });
    expect(mockAddLog).toHaveBeenCalledTimes(1);
    expect(mockAddLog.mock.calls[0][0].message).toBe(
      '"Fix billing issue" — Status: Open → In Progress',
    );
  });

  it("skips a local-* item (no server record to attach the log to)", () => {
    logActionItemUpdate(makeItem({ airtable_id: "local-123" }), { status: "Done" });
    expect(mockAddLog).not.toHaveBeenCalled();
  });

  it("skips an item with no airtable_id", () => {
    logActionItemUpdate(makeItem({ airtable_id: "" }), { status: "Done" });
    expect(mockAddLog).not.toHaveBeenCalled();
  });

  it("treats null / undefined / \"\" as equivalent (no spurious diff)", () => {
    // Airtable returns "" where the app writes null and vice versa.
    logActionItemUpdate(makeItem({ due_date: "" }), { due_date: null as unknown as string });
    expect(mockAddLog).not.toHaveBeenCalled();
  });

  it("treats 0 as blank for numeric time fields", () => {
    logActionItemUpdate(makeItem({ time_spent: 0 }), { time_spent: null as unknown as number });
    expect(mockAddLog).not.toHaveBeenCalled();
  });

  it("logs a real numeric time change", () => {
    logActionItemUpdate(makeItem({ time_spent: 0 }), { time_spent: 1800 });
    expect(mockAddLog.mock.calls[0][0].message).toBe(
      '"Fix billing issue" — Time spent updated',
    );
  });

  it("formats a due-date change and reports a cleared date", () => {
    logActionItemUpdate(makeItem({ due_date: "" }), { due_date: "2026-08-22" });
    expect(mockAddLog.mock.calls[0][0].message).toContain("Due date → Aug 22, 2026");

    mockAddLog.mockClear();
    logActionItemUpdate(makeItem({ due_date: "2026-08-22" }), { due_date: "" });
    expect(mockAddLog.mock.calls[0][0].message).toContain("Due date cleared");
  });

  it("reports assignee clear vs reassign", () => {
    logActionItemUpdate(makeItem({ assignee_name: "Jane" }), { assignee_name: "" });
    expect(mockAddLog.mock.calls[0][0].message).toContain("Assignee cleared");

    mockAddLog.mockClear();
    logActionItemUpdate(makeItem({ assignee_name: "" }), { assignee_name: "Bob" });
    expect(mockAddLog.mock.calls[0][0].message).toContain("Reassigned to Bob");
  });

  it("reports title/description as edited without dumping the content", () => {
    logActionItemUpdate(makeItem({ task: "Old", task_details: "<p>a</p>" }), {
      task: "New title",
      task_details: "<p>b</p>",
    });
    const msg = mockAddLog.mock.calls[0][0].message;
    expect(msg).toContain("Title updated");
    expect(msg).toContain("Description edited");
    expect(msg).not.toContain("New title");
  });

  it("reports slack link updated vs removed", () => {
    logActionItemUpdate(makeItem({ slack_thread_url: "" }), {
      slack_thread_url: "https://slack.com/x",
    });
    expect(mockAddLog.mock.calls[0][0].message).toContain("Slack link updated");

    mockAddLog.mockClear();
    logActionItemUpdate(makeItem({ slack_thread_url: "https://slack.com/x" }), {
      slack_thread_url: "",
    });
    expect(mockAddLog.mock.calls[0][0].message).toContain("Slack link removed");
  });

  it("falls back to \"Untitled\" when the task label is blank", () => {
    logActionItemUpdate(makeItem({ task: "" }), { status: "Done" });
    expect(mockAddLog.mock.calls[0][0].message).toBe('"Untitled" — Status: Open → Done');
  });

  it("ignores fields that are not in the logged set", () => {
    logActionItemUpdate(makeItem(), { id: 99 } as Partial<AirtableActionItem>);
    expect(mockAddLog).not.toHaveBeenCalled();
  });
});
