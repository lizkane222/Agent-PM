// Drag-a-team-member-onto-an-action-item → reassign.
//
// One drag payload and one write path, shared by every card that accepts the drop
// (components/account/ActionItemCard.tsx and AccountDetailPage's diverged local card), so
// the PATCH shape and the activity-log line cannot drift between them.

import { airtableApi } from "./api";
import { logActionItemUpdate } from "./actionItemLog";
import type { AirtableActionItem } from "../types";

/**
 * dataTransfer type for a dragged team member. Lowercase on purpose: browsers lowercase
 * `dataTransfer.types`, and `onDragOver` can only see the types, never the payload.
 */
export const ASSIGN_MEMBER_DRAG_TYPE = "assignmemberdrop";

export interface DraggedMember {
  id: number;
  name: string;
}

export function setMemberDragData(e: React.DragEvent, member: DraggedMember): void {
  e.dataTransfer.setData(ASSIGN_MEMBER_DRAG_TYPE, JSON.stringify({ id: member.id, name: member.name }));
  e.dataTransfer.effectAllowed = "copy";
}

export function isMemberDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(ASSIGN_MEMBER_DRAG_TYPE);
}

/** The dragged member, or null when the drop carries no (valid) member payload. */
export function readMemberDragData(e: React.DragEvent): DraggedMember | null {
  const raw = e.dataTransfer.getData(ASSIGN_MEMBER_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedMember>;
    if (typeof parsed.id !== "number" || typeof parsed.name !== "string") return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

/**
 * Assign `item` to `member`. Resolves the updated item, or `null` when there was nothing to
 * do: the item is a `local-*` blank with no server row, or it is already assigned to that
 * member. Throws on a failed PATCH so the caller can surface it.
 *
 * The assignee is written as the TeamMember pk, matching every in-app assignee picker.
 */
export async function assignActionItemToMember(
  item: AirtableActionItem,
  member: DraggedMember,
): Promise<AirtableActionItem | null> {
  if (!item.airtable_id || item.airtable_id.startsWith("local-")) return null;
  if (item.assignee_airtable_id === String(member.id) && item.assignee_name === member.name) return null;
  const { data } = await airtableApi.updateActionItemFields(item.airtable_id, {
    assignee_name: member.name,
    assignee_airtable_id: String(member.id),
  });
  logActionItemUpdate(item, { assignee_name: member.name });
  return data;
}
