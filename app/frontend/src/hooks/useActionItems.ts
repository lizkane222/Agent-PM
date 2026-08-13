import { useEffect, useRef, useState } from "react";
import { airtableApi } from "../lib/api";
import { addLog } from "../lib/appLog";
import { useResource } from "./useResource";
import { useActionItemZones } from "./useActionItemZones";
import { useAppError } from "../context/AppErrorContext";
import type { AirtableActionItem, UserProfile } from "../types";
import type { AccountAssignMap, KanbanAccount, Zone, ZonesMap } from "../types/action_items";

export interface UseActionItemsParams {
  accounts?: KanbanAccount[];
  profile?: UserProfile | null;
}

export function useActionItems({ accounts = [], profile = null }: UseActionItemsParams = {}) {
  const { reportError } = useAppError();

  const {
    zones, setZonesRaw, setZones,
    accountAssign, setAccountAssignRaw, setAccountAssign,
    swapBoth, mergeZones,
  } = useActionItemZones();

  const [allItems, setAllItems] = useState<AirtableActionItem[]>([]);

  const { data: serverItems, loading, error, refetch } = useResource<AirtableActionItem>(
    () => airtableApi.listActionItems().then((r) => r.data),
    [],
  );

  const blankCounter = useRef(
    (() => { try { return parseInt(localStorage.getItem("actionItemBlankCounter") ?? "0", 10); } catch { return 0; } })()
  );

  function nextBlankId(): string {
    blankCounter.current += 1;
    localStorage.setItem("actionItemBlankCounter", String(blankCounter.current));
    return `local-${blankCounter.current}`;
  }

  const blankCount = 1;

  function makeBlankItem(accountKey: string | null): AirtableActionItem {
    const acc = accountKey ? accounts.find((a) => a.key === accountKey) ?? null : null;
    const id = nextBlankId();
    return {
      id: 0,
      airtable_id: id,
      account: acc?.id ?? null,
      account_name: acc?.name ?? null,
      task: "",
      task_details: "",
      status: "Open",
      priority: "Medium",
      due_date: null,
      estimated_time: 0,
      time_spent: 0,
      prep_time: 0,
      slack_thread_url: "",
      salesforce_task_id: "",
      assignee_airtable_id: profile?.airtable_collaborator_id ?? "",
      assignee_name: profile?.display_name || profile?.email || "",
      reminder: null,
      reminder_id: null,
      reminder_due_at: null,
      reminder_status: null,
      linked_meeting: null,
      linked_meeting_name: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      marked_done_at: null,
      last_synced: "",
    };
  }

  function topUpBlanks(
    currentItems: AirtableActionItem[],
    currentZones: ZonesMap,
    accountKey: string | null,
    target = blankCount,
  ): { newItems: AirtableActionItem[]; newZones: ZonesMap } {
    const unstagedBlanks = currentItems.filter(
      (i) => i.airtable_id.startsWith("local-") && (currentZones[i.airtable_id] ?? "unstaged") === "unstaged"
    );
    const needed = target - unstagedBlanks.length;
    if (needed < 0) {
      let toRemove = -needed;
      const trimmedItems = currentItems.filter((i) => {
        if (toRemove > 0 && i.airtable_id.startsWith("local-") && (currentZones[i.airtable_id] ?? "unstaged") === "unstaged" && !i.task.trim()) {
          toRemove--;
          return false;
        }
        return true;
      });
      return { newItems: trimmedItems, newZones: currentZones };
    }
    if (needed === 0) return { newItems: currentItems, newZones: currentZones };
    const additions: AirtableActionItem[] = Array.from({ length: needed }, () => makeBlankItem(accountKey));
    const addedZones: ZonesMap = {};
    additions.forEach((i) => { addedZones[i.airtable_id] = "unstaged"; });
    return {
      newItems: [...currentItems, ...additions],
      newZones: { ...currentZones, ...addedZones },
    };
  }

  // Stable ref so the blankCount useEffect can call topUpBlanks without stale closure
  const topUpBlanksRef = useRef(topUpBlanks);
  topUpBlanksRef.current = topUpBlanks;

  // When server items arrive: normalize zones, strip stale blanks, replenish
  useEffect(() => {
    if (loading || error) return;
    const base = serverItems;

    let currentZones: ZonesMap;
    try { currentZones = JSON.parse(localStorage.getItem("actionItemZones") ?? "{}"); } catch { currentZones = {}; }

    // Normalize: real items default to "today" or "accounts"
    for (const item of base) {
      const storedZone = currentZones[item.airtable_id];
      if (!storedZone || storedZone === "unstaged") {
        currentZones[item.airtable_id] = item.account_name ? "accounts" : "today";
      }
    }
    // Strip stale local-* entries
    for (const key of Object.keys(currentZones)) {
      if (key.startsWith("local-")) delete currentZones[key];
    }

    const starKey = localStorage.getItem("actionItemStarredAccount");
    const targetBlanks = 1;
    const { newItems, newZones } = topUpBlanksRef.current(base, currentZones, starKey, targetBlanks);
    localStorage.setItem("actionItemZones", JSON.stringify(newZones));
    setZonesRaw(newZones);
    setAllItems(newItems);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, serverItems]);


  const promotingRef = useRef<Set<string>>(new Set());

  async function promoteBlankItem(
    localId: string,
    snapshot: AirtableActionItem,
  ): Promise<AirtableActionItem | null> {
    if (!snapshot.task?.trim()) return null;
    if (promotingRef.current.has(localId)) return null;
    promotingRef.current.add(localId);
    try {
      const { data } = await airtableApi.createActionItem({
        task: snapshot.task,
        task_details: snapshot.task_details,
        status: snapshot.status,
        priority: snapshot.priority,
        due_date: snapshot.due_date,
        estimated_time: snapshot.estimated_time,
        time_spent: snapshot.time_spent,
        prep_time: snapshot.prep_time,
        slack_thread_url: snapshot.slack_thread_url,
        account_name: snapshot.account_name,
        assignee_airtable_id: snapshot.assignee_airtable_id,
        assignee_name: snapshot.assignee_name,
      });
      addLog({
        category: "action_item",
        message: `Action item "${snapshot.task}" created`,
        links: [{ label: "View action items", path: "/action-items?glow=1" }],
        resource: { type: "action_item", id: data.airtable_id },
      });
      return data;
    } catch (err) {
      reportError(
        err instanceof Error ? err.message : "Failed to create action item",
        "action_items",
      );
      return null;
    } finally {
      promotingRef.current.delete(localId);
    }
  }

  return {
    // Server data
    allItems,
    setAllItems,
    loading,
    error,
    refetch,
    // Zone state (from useActionItemZones)
    zones,
    setZonesRaw,
    setZones,
    accountAssign,
    setAccountAssignRaw,
    setAccountAssign,
    swapBoth,
    mergeZones,
    // Blank card management
    blankCount,
    topUpBlanks,
    makeBlankItem,
    // Promotion
    promoteBlankItem,
  };
}

// Re-export Zone for convenience so callers don't need to import from two places
export type { Zone, ZonesMap, AccountAssignMap, KanbanAccount };
