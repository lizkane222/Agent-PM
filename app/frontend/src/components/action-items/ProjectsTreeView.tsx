import { useMemo, useState } from "react";
import type { AccountProject } from "../../types/accounts";
import type { AirtableActionItem } from "../../types";
import { accountGroupKey, NO_ACCOUNT_GROUP_KEY, useAccountGroupCollapse } from "../../hooks/useAccountGroupCollapse";
import { useStatusLabels } from "../../hooks/useStatusLabels";
import {
  buildAccountTree, countItems, groupByStatus,
  type GoalNode, type ProjectNode,
} from "../../lib/projectTree";

/**
 * Account > Project > Goal > Action item.
 *
 * Reads the project/goal assignments made on each account's detail page. Items are compact
 * rows (click opens the usual modal). A row can be dragged onto a project, a goal, or an
 * account's "No project" row to move it there (see `onAssign`).
 *
 * Every account can show either the plain nesting ("By project") or, under each project /
 * goal / "No project" bucket, its items grouped by status ("Project > Status").
 */

export type ProjectsLayout = "project" | "project-status";
export const PROJECTS_LAYOUT_KEY = "actionItemsProjectsLayout-v1";

function readLayouts(): Record<string, ProjectsLayout> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_LAYOUT_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

const STATUS_PILL: Record<string, string> = {
  "Open": "bg-gray-100 text-[var(--twilio-navy)]",
  "In Progress": "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  "Done": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "Blocked": "bg-red-50 text-red-700 ring-1 ring-red-200",
  "Backlogged": "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

export interface DropTarget {
  /** `null` = the "No project" bucket: take the item off every project and goal. */
  projectId: number | null;
  /** Django `Account.id` the target belongs to. */
  accountId: number;
}

interface Props {
  items: AirtableActionItem[];
  accounts: { key: string; name: string }[];
  projects: AccountProject[];
  /** Lowercased account name -> Django `Account.id`; projects are keyed by that id. */
  accountIdByName: Map<string, number>;
  onExpand: (item: AirtableActionItem) => void;
  onDragStart?: (e: React.DragEvent, item: AirtableActionItem) => void;
  onDragEnd?: () => void;
  /** The id of the card being dragged, if any. */
  externalDragId?: string | null;
  /** Lowercased account name of the dragged card; only that account's rows accept it. */
  dragAccountName?: string | null;
  onAssign?: (target: DropTarget) => void;
}

interface Group {
  key: string;
  name: string;
  accountId: number | null;
  items: AirtableActionItem[];
  projects: AccountProject[];
}

export default function ProjectsTreeView({
  items, accounts, projects, accountIdByName, onExpand, onDragStart, onDragEnd,
  externalDragId, dragAccountName, onAssign,
}: Props) {
  const { isCollapsed, toggle } = useAccountGroupCollapse();
  const { label: statusLabel } = useStatusLabels();
  const [layouts, setLayouts] = useState<Record<string, ProjectsLayout>>(readLayouts);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragInFlight = !!externalDragId;

  const setLayout = (groupKey: string, layout: ProjectsLayout) => {
    setLayouts((prev) => {
      const next = { ...prev, [groupKey]: layout };
      localStorage.setItem(PROJECTS_LAYOUT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const groups = useMemo<Group[]>(() => {
    const itemsByName = new Map<string, AirtableActionItem[]>();
    const noAccount: AirtableActionItem[] = [];
    for (const item of items) {
      const name = item.account_name?.trim();
      if (!name) { noAccount.push(item); continue; }
      const k = name.toLowerCase();
      if (!itemsByName.has(k)) itemsByName.set(k, []);
      itemsByName.get(k)!.push(item);
    }
    const projectsByAccount = new Map<number, AccountProject[]>();
    for (const p of projects) {
      if (!projectsByAccount.has(p.account)) projectsByAccount.set(p.account, []);
      projectsByAccount.get(p.account)!.push(p);
    }

    const out: Group[] = accounts.map((acc) => {
      const k = acc.name.trim().toLowerCase();
      const accountId = accountIdByName.get(k) ?? null;
      const groupItems = itemsByName.get(k) ?? [];
      itemsByName.delete(k);
      return {
        key: acc.key, name: acc.name, accountId, items: groupItems,
        projects: accountId != null ? projectsByAccount.get(accountId) ?? [] : [],
      };
    });
    // Names matching no known account stay visible rather than rendering nowhere.
    for (const [, rest] of [...itemsByName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const name = rest[0].account_name!.trim();
      out.push({ key: `unmatched-${name}`, name, accountId: null, items: rest, projects: [] });
    }
    out.push({ key: "__none__", name: "No Account", accountId: null, items: noAccount, projects: [] });
    return out;
  }, [items, accounts, projects, accountIdByName]);

  if (items.length === 0 && projects.length === 0) {
    return <p className="text-sm text-[var(--twilio-gray-60)] text-center py-12">No items match</p>;
  }

  /** Drop handlers for a row; inert unless the dragged card belongs to this account. */
  function dropProps(group: Group, projectId: number | null, rowKey: string) {
    const eligible = !!onAssign && group.accountId != null && dragInFlight
      && !!dragAccountName && dragAccountName === group.name.trim().toLowerCase();
    return {
      eligible,
      isOver: eligible && overKey === rowKey,
      handlers: eligible ? {
        // Tells the Accounts panel's native catch-all drop listener (which unstages any card
        // dropped outside a "specific" target) to leave this one alone. Without it that
        // listener ran first, cleared the drag, and this row's own onDrop never fired.
        "data-drop-specific": "true",
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setOverKey(rowKey); },
        onDragLeave: (e: React.DragEvent) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOverKey(null);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault(); e.stopPropagation(); setOverKey(null);
          onAssign!({ projectId, accountId: group.accountId! });
        },
      } : {},
    };
  }

  function renderItemRow(item: AirtableActionItem, depth: number) {
    const due = item.due_date
      ? new Date(item.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : null;
    return (
      <div
        key={item.airtable_id}
        draggable
        onDragStart={(e) => onDragStart?.(e, item)}
        onDragEnd={onDragEnd}
        onClick={() => onExpand(item)}
        data-testid={`project-item-${item.airtable_id}`}
        className="flex items-center gap-2 pr-4 py-1.5 text-xs cursor-grab active:cursor-grabbing hover:bg-gray-50 border-t border-gray-50"
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        <span className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_PILL[item.status] ?? STATUS_PILL["Open"]}`}>
          {statusLabel(item.status)}
        </span>
        <span className="flex-1 min-w-0 truncate font-medium text-[var(--twilio-navy)]">
          {item.task || <span className="italic opacity-50">Untitled</span>}
        </span>
        {item.assignee_name && <span className="shrink-0 text-[var(--twilio-gray-60)] truncate max-w-[120px]">{item.assignee_name}</span>}
        {due && <span className="shrink-0 text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">{due}</span>}
      </div>
    );
  }

  /** Items of one bucket: flat, or grouped under status headings. */
  function renderItemList(list: AirtableActionItem[], depth: number, scope: string, layout: ProjectsLayout) {
    if (layout === "project") return <>{list.map((i) => renderItemRow(i, depth))}</>;
    return (
      <>
        {groupByStatus(list).map(({ status, items: sItems }) => {
          const key = `pstatus:${scope}:${status}`;
          const collapsed = isCollapsed(key);
          return (
            <div key={status} data-testid={`status-group-${scope}-${status}`}>
              <div
                role="button" tabIndex={0}
                onClick={() => toggle(key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); } }}
                className="flex items-center gap-2 pr-4 py-1 text-[11px] font-semibold text-[var(--twilio-gray-60)] cursor-pointer hover:bg-gray-50 border-t border-gray-50"
                style={{ paddingLeft: 16 + depth * 20 }}
              >
                <Chevron collapsed={collapsed} />
                <span>{statusLabel(status)}</span>
                <span className="font-normal">{sItems.length}</span>
              </div>
              {!collapsed && sItems.map((i) => renderItemRow(i, depth + 1))}
            </div>
          );
        })}
      </>
    );
  }

  /**
   * The whole block (header, nested goals, items) is the drop target, so the highlight
   * outlines the entire section rather than just its title row. Nested blocks stop the
   * event, so only the innermost block under the cursor lights up and receives the drop.
   */
  function blockStyle(drop: ReturnType<typeof dropProps>): React.CSSProperties | undefined {
    return drop.isOver
      ? { outline: "2px solid #818cf8", outlineOffset: -2, background: "rgba(238, 242, 255, 0.6)" }
      : undefined;
  }

  function renderNodeHeader(
    title: string, kind: "project" | "goal" | "none", count: number, depth: number,
    collapseKey: string, drop: ReturnType<typeof dropProps>, empty: boolean,
  ) {
    const collapsed = isCollapsed(collapseKey);
    return (
      <div
        key={`header-${collapseKey}`}
        role="button" tabIndex={0}
        onClick={() => { if (!empty) toggle(collapseKey); }}
        onKeyDown={(e) => { if (!empty && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(collapseKey); } }}
        title={drop.eligible ? `Drop to move here` : undefined}
        className={`flex items-center gap-2 pr-4 py-1.5 text-xs border-t border-gray-100 transition-colors ${empty ? "cursor-default" : "cursor-pointer hover:bg-gray-50"} ${drop.isOver ? "bg-indigo-50" : kind === "none" ? "bg-gray-50/50" : ""}`}
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        {empty ? <span className="w-3 shrink-0" aria-hidden="true" /> : <Chevron collapsed={collapsed} />}
        <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${kind === "goal" ? "bg-amber-50 text-amber-700" : kind === "project" ? "bg-violet-50 text-violet-700" : "bg-gray-100 text-[var(--twilio-gray-60)]"}`}>
          {kind === "none" ? "No project" : kind}
        </span>
        {kind !== "none" && (
          <span className={`flex-1 min-w-0 truncate font-semibold text-[var(--twilio-navy)] ${!title ? "italic opacity-50" : ""}`}>{title || "Untitled"}</span>
        )}
        {kind === "none" && <span className="flex-1" />}
        {drop.eligible && <span className={`shrink-0 text-[10px] font-semibold ${drop.isOver ? "text-indigo-600" : "text-[var(--twilio-gray-60)]"}`}>{drop.isOver ? "Drop to move here" : "Drop here"}</span>}
        <span className="shrink-0 text-[11px] text-[var(--twilio-gray-60)]">{count}</span>
      </div>
    );
  }

  function renderGoal(group: Group, node: GoalNode, depth: number, layout: ProjectsLayout): React.ReactNode {
    const key = `goal:${node.goal.id}`;
    const collapsed = isCollapsed(key);
    const count = countItems(node);
    const drop = dropProps(group, node.goal.id, key);
    return (
      <div key={key} data-testid={`goal-${node.goal.id}`} {...drop.handlers} style={blockStyle(drop)}>
        {renderNodeHeader(node.goal.name, "goal", count, depth, key, drop, count === 0)}
        {!collapsed && (
          <>
            {node.goals.map((g) => renderGoal(group, g, depth + 1, layout))}
            {renderItemList(node.items, depth + 1, key, layout)}
          </>
        )}
      </div>
    );
  }

  function renderProject(group: Group, node: ProjectNode, layout: ProjectsLayout): React.ReactNode {
    const key = `project:${node.project.id}`;
    const collapsed = isCollapsed(key);
    const count = countItems(node);
    const drop = dropProps(group, node.project.id, key);
    return (
      <div key={key} data-testid={`project-${node.project.id}`} {...drop.handlers} style={blockStyle(drop)}>
        {renderNodeHeader(node.project.name, "project", count, 1, key, drop, count === 0 && node.goals.length === 0)}
        {!collapsed && (
          <>
            {node.goals.map((g) => renderGoal(group, g, 2, layout))}
            {renderItemList(node.items, 2, key, layout)}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const groupKey = group.key === "__none__" ? NO_ACCOUNT_GROUP_KEY : accountGroupKey(group.name);
        const collapsed = isCollapsed(groupKey);
        const tree = buildAccountTree(group.projects, group.items);
        const hasProjects = tree.projects.length > 0 || tree.looseGoals.length > 0;
        const layout: ProjectsLayout = layouts[groupKey] === "project-status" ? "project-status" : "project";
        const empty = group.items.length === 0 && !hasProjects;
        const open = group.items.filter((i) => i.status !== "Done").length;
        const noProjectKey = `noproject:${groupKey}`;
        const noProjectCollapsed = isCollapsed(noProjectKey);
        const noProjectDrop = dropProps(group, null, noProjectKey);
        return (
          <div key={group.key} data-testid={`projects-account-${groupKey}`} className="bg-white rounded-lg overflow-hidden shadow-blue-md">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => { if (!empty) toggle(groupKey); }}
                className={`flex-1 min-w-0 flex items-center gap-3 text-left ${empty ? "cursor-default" : ""}`}
              >
                {empty ? <span className="w-3 shrink-0" aria-hidden="true" /> : <Chevron collapsed={collapsed} />}
                <span className={`text-sm font-semibold truncate ${empty ? "opacity-60" : ""} text-[var(--twilio-navy)]`}>{group.name}</span>
              </button>
              {hasProjects && (
                <div role="group" aria-label={`${group.name} layout`} className="shrink-0 flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                  {([["project", "By project"], ["project-status", "Project > Status"]] as const).map(([id, text]) => (
                    <button
                      key={id}
                      aria-pressed={layout === id}
                      onClick={() => setLayout(groupKey, id)}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-md whitespace-nowrap ${layout === id ? "bg-white text-[var(--twilio-navy)] shadow-sm" : "text-gray-400"}`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              )}
              {open > 0 && <span className="shrink-0 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full text-[11px] font-semibold">{open} open</span>}
            </div>
            {!collapsed && !empty && (
              <div className="border-t border-gray-100">
                {tree.projects.map((p) => renderProject(group, p, layout))}
                {tree.looseGoals.map((g) => renderGoal(group, g, 1, layout))}
                {(tree.unassigned.length > 0 || (hasProjects && noProjectDrop.eligible)) && (
                  <div data-testid={`no-project-${groupKey}`} {...noProjectDrop.handlers} style={blockStyle(noProjectDrop)}>
                    {hasProjects && renderNodeHeader("", "none", tree.unassigned.length, 1, noProjectKey, noProjectDrop, tree.unassigned.length === 0)}
                    {(!hasProjects || !noProjectCollapsed) && renderItemList(tree.unassigned, hasProjects ? 2 : 1, noProjectKey, layout)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" className={`w-3 h-3 shrink-0 text-[var(--twilio-gray-60)] transition-transform ${collapsed ? "-rotate-90" : ""}`} aria-hidden="true">
      <path d="M6 8L1 3h10z" />
    </svg>
  );
}
