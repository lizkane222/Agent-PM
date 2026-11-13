import { describe, it, expect } from "vitest";
import { buildAccountTree, groupByStatus, moveActionItem, countItems } from "../projectTree";
import type { AccountProject } from "../../types/accounts";
import type { AirtableActionItem } from "../../types";

const item = (id: string, status = "Open"): AirtableActionItem =>
  ({ airtable_id: id, task: id, status } as unknown as AirtableActionItem);

const row = (id: number, kind: "project" | "goal", over: Partial<AccountProject> = {}): AccountProject =>
  ({ id, account: 1, name: `${kind}${id}`, position: id, action_ids: [], goal_ids: [], kind, ...over } as unknown as AccountProject);

describe("buildAccountTree", () => {
  it("nests goals under their project and items under the goal or project", () => {
    const tree = buildAccountTree(
      [
        row(1, "project", { goal_ids: ["2"], action_ids: ["a"] }),
        row(2, "goal", { action_ids: ["b"] }),
      ],
      [item("a"), item("b"), item("c")],
    );
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].items.map((i) => i.airtable_id)).toEqual(["a"]);
    expect(tree.projects[0].goals[0].items.map((i) => i.airtable_id)).toEqual(["b"]);
    expect(tree.unassigned.map((i) => i.airtable_id)).toEqual(["c"]);
  });

  it("lists an item on both a project and its goal once, under the goal", () => {
    const tree = buildAccountTree(
      [row(1, "project", { goal_ids: ["2"], action_ids: ["a"] }), row(2, "goal", { action_ids: ["a"] })],
      [item("a")],
    );
    expect(tree.projects[0].items).toEqual([]);
    expect(tree.projects[0].goals[0].items.map((i) => i.airtable_id)).toEqual(["a"]);
    expect(tree.unassigned).toEqual([]);
  });

  it("shows an item claimed by two projects only under the first", () => {
    const tree = buildAccountTree(
      [row(1, "project", { action_ids: ["a"] }), row(2, "project", { action_ids: ["a"] })],
      [item("a")],
    );
    expect(tree.projects[0].items).toHaveLength(1);
    expect(tree.projects[1].items).toHaveLength(0);
  });

  it("ignores ids with no matching (visible) action item", () => {
    const tree = buildAccountTree([row(1, "project", { action_ids: ["gone"] })], []);
    expect(tree.projects[0].items).toEqual([]);
  });

  it("keeps a goal no project lists, and never loops on a goal cycle", () => {
    const tree = buildAccountTree(
      [row(1, "goal", { goal_ids: ["2"] }), row(2, "goal", { goal_ids: ["1"] })],
      [],
    );
    expect(tree.projects).toEqual([]);
    expect(tree.looseGoals.length).toBeGreaterThan(0);
  });

  it("orders projects by position", () => {
    const tree = buildAccountTree([row(1, "project", { position: 5 }), row(2, "project", { position: 1 })], []);
    expect(tree.projects.map((p) => p.project.id)).toEqual([2, 1]);
  });

  it("counts nested items", () => {
    const tree = buildAccountTree(
      [row(1, "project", { goal_ids: ["2"], action_ids: ["a"] }), row(2, "goal", { action_ids: ["b"] })],
      [item("a"), item("b")],
    );
    expect(countItems(tree.projects[0])).toBe(2);
  });
});

describe("groupByStatus", () => {
  it("orders statuses and drops empty groups", () => {
    const g = groupByStatus([item("a", "Done"), item("b", "Open"), item("c", "Blocked")]);
    expect(g.map((x) => x.status)).toEqual(["Open", "Blocked", "Done"]);
  });
  it("keeps unknown statuses visible", () => {
    expect(groupByStatus([item("a", "Weird")]).map((x) => x.status)).toEqual(["Other"]);
  });
});

describe("moveActionItem", () => {
  const rows = [
    row(1, "project", { action_ids: ["a"] }),
    row(2, "goal", { action_ids: ["a", "b"] }),
    row(3, "project", { action_ids: [] }),
  ];
  it("moves: adds to the target and removes from every other owner", () => {
    expect(moveActionItem(rows, "a", 3)).toEqual([
      { id: 1, action_ids: [] },
      { id: 2, action_ids: ["b"] },
      { id: 3, action_ids: ["a"] },
    ]);
  });
  it("null target takes the item off everything", () => {
    expect(moveActionItem(rows, "a", null)).toEqual([
      { id: 1, action_ids: [] },
      { id: 2, action_ids: ["b"] },
    ]);
  });
  it("is a no-op when it is already only there", () => {
    expect(moveActionItem([row(1, "project", { action_ids: ["a"] })], "a", 1)).toEqual([]);
  });
});
