import { describe, it, expect } from "vitest";
import {
  DONE_WINDOW_DAYS,
  SIDEBAR_GROUPS,
  groupActionItems,
  groupForItem,
  isRecentlyDone,
  matchesFlags,
  type SidebarGroupKey,
} from "../actionItemSidebarOrder";
import type { AirtableActionItem } from "../../types";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function item(overrides: Partial<AirtableActionItem> & { airtable_id: string }): AirtableActionItem {
  return {
    id: 1,
    account: null,
    account_name: null,
    task: overrides.airtable_id,
    task_details: "",
    status: "Open",
    priority: "Medium",
    due_date: null,
    estimated_time: 0,
    time_spent: 0,
    prep_time: 0,
    slack_thread_url: "",
    salesforce_task_id: "",
    assignee_airtable_id: "",
    assignee_name: "",
    reminder: null,
    reminder_id: null,
    reminder_due_at: null,
    reminder_status: null,
    linked_meeting: null,
    linked_meeting_name: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    marked_done_at: null,
    last_synced: "",
    ...overrides,
  };
}

/** Grouping context with every set empty unless overridden. */
function ctx(overrides: Partial<{
  trackingIds: Set<string>;
  stagedIds: Set<string>;
  pinnedIds: Set<string>;
  selectedFlags: Set<SidebarGroupKey>;
}> = {}) {
  return {
    trackingIds: new Set<string>(),
    stagedIds: new Set<string>(),
    pinnedIds: new Set<string>(),
    selectedFlags: new Set<SidebarGroupKey>(),
    now: NOW,
    ...overrides,
  };
}

describe("SIDEBAR_GROUPS", () => {
  it("is the order the user asked for", () => {
    expect(SIDEBAR_GROUPS.map((g) => g.key)).toEqual([
      "tracking", "staged", "pinned", "in_progress", "open", "done",
    ]);
  });
});

describe("groupForItem", () => {
  it("routes by zone, then pin, then status", () => {
    const tracked = item({ airtable_id: "rec-t", status: "Open" });
    const staged = item({ airtable_id: "rec-s", status: "Open" });
    const pinned = item({ airtable_id: "rec-p", status: "Open" });
    const c = ctx({
      trackingIds: new Set(["rec-t"]),
      stagedIds: new Set(["rec-s"]),
      pinnedIds: new Set(["rec-p"]),
    });
    expect(groupForItem(tracked, c)).toBe("tracking");
    expect(groupForItem(staged, c)).toBe("staged");
    expect(groupForItem(pinned, c)).toBe("pinned");
    expect(groupForItem(item({ airtable_id: "rec-i", status: "In Progress" }), c)).toBe("in_progress");
    expect(groupForItem(item({ airtable_id: "rec-o", status: "Open" }), c)).toBe("open");
  });

  it("puts a card that is both tracked and pinned in Tracking only", () => {
    // Otherwise the same card renders twice, which is how a "duplicate card" bug reads.
    const both = item({ airtable_id: "rec-1" });
    const c = ctx({ trackingIds: new Set(["rec-1"]), pinnedIds: new Set(["rec-1"]) });
    expect(groupForItem(both, c)).toBe("tracking");
  });

  it("prefers Staged over Pinned", () => {
    const both = item({ airtable_id: "rec-1" });
    const c = ctx({ stagedIds: new Set(["rec-1"]), pinnedIds: new Set(["rec-1"]) });
    expect(groupForItem(both, c)).toBe("staged");
  });

  it("excludes Blocked and Backlogged, which the sidebar has never shown", () => {
    expect(groupForItem(item({ airtable_id: "b", status: "Blocked" }), ctx())).toBeNull();
    expect(groupForItem(item({ airtable_id: "k", status: "Backlogged" }), ctx())).toBeNull();
  });

  it("still groups a Blocked card if the user staged it", () => {
    // Positional state is the user's explicit choice and outranks the status filter.
    const c = ctx({ stagedIds: new Set(["b"]) });
    expect(groupForItem(item({ airtable_id: "b", status: "Blocked" }), c)).toBe("staged");
  });
});

describe("isRecentlyDone", () => {
  it("accepts a marked_done_at inside the window and rejects one outside", () => {
    const inside = item({
      airtable_id: "a", status: "Done",
      marked_done_at: new Date(NOW - 3 * DAY).toISOString(),
    });
    const outside = item({
      airtable_id: "b", status: "Done",
      marked_done_at: new Date(NOW - (DONE_WINDOW_DAYS + 1) * DAY).toISOString(),
    });
    expect(isRecentlyDone(inside, NOW)).toBe(true);
    expect(isRecentlyDone(outside, NOW)).toBe(false);
  });

  it("falls back to updated_at when marked_done_at is null", () => {
    // The viewset only stamps marked_done_at on a status transition, so rows that arrived
    // Done from an Airtable sync have it null. Dropping them would hide real records.
    const recent = item({
      airtable_id: "a", status: "Done", marked_done_at: null,
      updated_at: new Date(NOW - 2 * DAY).toISOString(),
    });
    const stale = item({
      airtable_id: "b", status: "Done", marked_done_at: null,
      updated_at: new Date(NOW - 90 * DAY).toISOString(),
    });
    expect(isRecentlyDone(recent, NOW)).toBe(true);
    expect(isRecentlyDone(stale, NOW)).toBe(false);
  });

  it("keeps an item with no usable timestamp rather than hiding it", () => {
    const undated = item({ airtable_id: "a", status: "Done", marked_done_at: null, updated_at: "" });
    expect(isRecentlyDone(undated, NOW)).toBe(true);
  });

  it("drops a Done item outside the window from grouping entirely", () => {
    const stale = item({
      airtable_id: "a", status: "Done",
      marked_done_at: new Date(NOW - 60 * DAY).toISOString(),
    });
    expect(groupForItem(stale, ctx())).toBeNull();
  });
});

describe("matchesFlags", () => {
  const c = (flags: SidebarGroupKey[]) => ctx({
    trackingIds: new Set(["rec-t"]),
    stagedIds: new Set(["rec-s"]),
    pinnedIds: new Set(["rec-p"]),
    selectedFlags: new Set(flags),
  });

  it("matches everything when nothing is ticked", () => {
    expect(matchesFlags(item({ airtable_id: "x" }), c([]))).toBe(true);
  });

  it("unions across ticked flags", () => {
    const flags = c(["staged", "done"]);
    expect(matchesFlags(item({ airtable_id: "rec-s" }), flags)).toBe(true);
    expect(matchesFlags(item({ airtable_id: "z", status: "Done" }), flags)).toBe(true);
    expect(matchesFlags(item({ airtable_id: "z", status: "Open" }), flags)).toBe(false);
  });

  it("treats flags as predicates, not section membership", () => {
    // rec-t is a status-Open card that lives in the Tracking section. Ticking "Open" must
    // still reach it, or a flag would only ever find cards in its own section.
    const openCard = item({ airtable_id: "rec-t", status: "Open" });
    expect(matchesFlags(openCard, c(["open"]))).toBe(true);
  });
});

describe("groupActionItems", () => {
  it("emits groups in order and sorts each newest-first by created_at", () => {
    const items = [
      item({ airtable_id: "o-old", status: "Open", created_at: "2026-08-01T00:00:00Z" }),
      item({ airtable_id: "i-new", status: "In Progress", created_at: "2026-08-18T00:00:00Z" }),
      item({ airtable_id: "o-new", status: "Open", created_at: "2026-08-17T00:00:00Z" }),
      item({ airtable_id: "i-old", status: "In Progress", created_at: "2026-08-02T00:00:00Z" }),
      item({ airtable_id: "trk", status: "Open" }),
    ];
    const groups = groupActionItems(items, ctx({ trackingIds: new Set(["trk"]) }));
    expect(groups.map((g) => g.key)).toEqual(["tracking", "in_progress", "open"]);
    expect(groups[1].items.map((i) => i.airtable_id)).toEqual(["i-new", "i-old"]);
    expect(groups[2].items.map((i) => i.airtable_id)).toEqual(["o-new", "o-old"]);
  });

  it("drops empty groups so no header renders over nothing", () => {
    const groups = groupActionItems([item({ airtable_id: "a", status: "Open" })], ctx());
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("open");
  });

  it("renders a card exactly once across all groups", () => {
    const items = [item({ airtable_id: "rec-1", status: "In Progress" })];
    const groups = groupActionItems(items, ctx({
      trackingIds: new Set(["rec-1"]),
      stagedIds: new Set(["rec-1"]),
      pinnedIds: new Set(["rec-1"]),
    }));
    expect(groups.flatMap((g) => g.items)).toHaveLength(1);
  });

  it("narrows to the ticked flags", () => {
    const items = [
      item({ airtable_id: "trk", status: "Open" }),
      item({ airtable_id: "plain", status: "Open" }),
    ];
    const groups = groupActionItems(items, ctx({
      trackingIds: new Set(["trk"]),
      selectedFlags: new Set<SidebarGroupKey>(["tracking"]),
    }));
    expect(groups.map((g) => g.key)).toEqual(["tracking"]);
    expect(groups[0].items.map((i) => i.airtable_id)).toEqual(["trk"]);
  });

  it("keeps a stable order for identical created_at values", () => {
    const items = [
      item({ airtable_id: "first", status: "Open", created_at: "2026-08-10T00:00:00Z" }),
      item({ airtable_id: "second", status: "Open", created_at: "2026-08-10T00:00:00Z" }),
    ];
    const groups = groupActionItems(items, ctx());
    expect(groups[0].items.map((i) => i.airtable_id)).toEqual(["first", "second"]);
  });

  it("returns nothing when the flags exclude every card", () => {
    const groups = groupActionItems(
      [item({ airtable_id: "a", status: "Open" })],
      ctx({ selectedFlags: new Set<SidebarGroupKey>(["done"]) }),
    );
    expect(groups).toEqual([]);
  });
});
