/**
 * Pure grouping for the Action Items page's Projects view.
 *
 * Account > Project > (Goals, then the project's own action items), with each goal listing
 * its action items. Projects and goals both live in `AccountProject`; a goal is the row
 * with `kind === "goal"`, referenced from its parent's `goal_ids` by `String(id)`, and an
 * action item is referenced from `action_ids` by its Airtable id.
 *
 * An item may be listed on a project AND on a goal in the data. It is shown once: the goal
 * wins (the more specific home), and when two goals/projects both claim it the first in
 * `position` order wins.
 */
import type { AccountProject } from "../types/accounts";
import type { AirtableActionItem } from "../types";

export interface GoalNode {
  goal: AccountProject;
  items: AirtableActionItem[];
  /** A goal may itself list goals; rendered one level deeper. */
  goals: GoalNode[];
}

export interface ProjectNode {
  project: AccountProject;
  goals: GoalNode[];
  /** Items on the project itself that are not on one of its goals. */
  items: AirtableActionItem[];
}

export interface AccountTree {
  projects: ProjectNode[];
  /** Goals no project lists — kept so they are never hidden. */
  looseGoals: GoalNode[];
  /** The account's items that no project or goal claims. */
  unassigned: AirtableActionItem[];
}

const byPosition = (a: AccountProject, b: AccountProject) =>
  a.position - b.position || a.name.localeCompare(b.name) || a.id - b.id;

export function countItems(node: { items: AirtableActionItem[]; goals?: GoalNode[] }): number {
  return node.items.length + (node.goals ?? []).reduce((n, g) => n + countItems(g), 0);
}

/**
 * @param accountProjects every project AND goal of ONE account
 * @param accountItems    that account's action items (real ones; no `local-*` drafts)
 */
export function buildAccountTree(
  accountProjects: AccountProject[],
  accountItems: AirtableActionItem[],
): AccountTree {
  const itemById = new Map(accountItems.map((i) => [i.airtable_id, i]));
  const rows = [...accountProjects].sort(byPosition);
  const goalsById = new Map(rows.filter((r) => r.kind === "goal").map((g) => [String(g.id), g]));
  const projects = rows.filter((r) => r.kind !== "goal");

  // 1. Which goals does something point at? The rest are "loose".
  const referencedGoalIds = new Set<string>();
  for (const r of rows) for (const gid of r.goal_ids ?? []) if (goalsById.has(String(gid))) referencedGoalIds.add(String(gid));

  // 2. Item ownership. Walk goals first (the more specific home), then projects.
  const claimed = new Set<string>();
  const take = (ids: string[] | undefined): AirtableActionItem[] => {
    const out: AirtableActionItem[] = [];
    for (const id of ids ?? []) {
      const item = itemById.get(id);
      if (item && !claimed.has(id)) { claimed.add(id); out.push(item); }
    }
    return out;
  };

  const goalItems = new Map<string, AirtableActionItem[]>();
  for (const g of rows.filter((r) => r.kind === "goal")) goalItems.set(String(g.id), take(g.action_ids));

  // 3. Assemble. `seen` stops a goal appearing under two parents and guards cycles.
  const seenGoals = new Set<string>();
  const buildGoal = (goal: AccountProject): GoalNode | null => {
    const gid = String(goal.id);
    if (seenGoals.has(gid)) return null;
    seenGoals.add(gid);
    const children = (goal.goal_ids ?? [])
      .map((cid) => goalsById.get(String(cid)))
      .filter((g): g is AccountProject => !!g)
      .map(buildGoal)
      .filter((g): g is GoalNode => !!g);
    return { goal, items: goalItems.get(gid) ?? [], goals: children };
  };

  const projectNodes: ProjectNode[] = projects.map((project) => ({
    project,
    goals: (project.goal_ids ?? [])
      .map((gid) => goalsById.get(String(gid)))
      .filter((g): g is AccountProject => !!g)
      .map(buildGoal)
      .filter((g): g is GoalNode => !!g),
    items: take(project.action_ids),
  }));

  // Unreferenced goals first, then anything still unseen (a cycle of goals that only
  // point at each other), so no goal can ever disappear from the view.
  const looseGoals: GoalNode[] = [];
  for (const g of rows.filter((r) => r.kind === "goal" && !referencedGoalIds.has(String(r.id)))) {
    const node = buildGoal(g);
    if (node) looseGoals.push(node);
  }
  for (const g of rows.filter((r) => r.kind === "goal" && !seenGoals.has(String(r.id)))) {
    const node = buildGoal(g);
    if (node) looseGoals.push(node);
  }

  return {
    projects: projectNodes,
    looseGoals,
    unassigned: accountItems.filter((i) => !claimed.has(i.airtable_id)),
  };
}

/** Status order for the Project > Status layout. */
export const STATUS_ORDER = ["Open", "In Progress", "Blocked", "Backlogged", "Done"] as const;

export function groupByStatus(items: AirtableActionItem[]): { status: string; items: AirtableActionItem[] }[] {
  const known = new Set<string>(STATUS_ORDER);
  const groups = STATUS_ORDER.map((status) => ({ status: status as string, items: items.filter((i) => i.status === status) }));
  const other = items.filter((i) => !known.has(i.status));
  if (other.length) groups.push({ status: "Other", items: other });
  return groups.filter((g) => g.items.length > 0);
}

/**
 * New `action_ids` for every project/goal of an account when `itemId` is moved to
 * `targetId` (`null` = the "no project" bucket). Returns only the rows that change.
 * A drop is a MOVE: the item is taken off every other project/goal, as in the account page.
 */
export function moveActionItem(
  accountProjects: AccountProject[],
  itemId: string,
  targetId: number | null,
): { id: number; action_ids: string[] }[] {
  const updates: { id: number; action_ids: string[] }[] = [];
  for (const p of accountProjects) {
    const has = (p.action_ids ?? []).includes(itemId);
    if (p.id === targetId) {
      if (!has) updates.push({ id: p.id, action_ids: [...(p.action_ids ?? []), itemId] });
    } else if (has) {
      updates.push({ id: p.id, action_ids: p.action_ids.filter((x) => x !== itemId) });
    }
  }
  return updates;
}
