/**
 * Conversion helpers: Action Item ↔ Calendar Event.
 *
 * Each conversion:
 *   1. Snapshots the source record in full.
 *   2. Creates the target record (transferring all mappable fields).
 *   3. Adds an activity log entry with restoreData so the UI can offer "Restore".
 *   4. Deletes the source record.
 *
 * The restore path recreates the original record and deletes the converted one.
 */

import { airtableApi, schedulerApi } from "../lib/api";
import { addLog, patchLog } from "../lib/appLog";
import type { AirtableActionItem, CalendarEvent } from "../types";

// ─── Action Item → Calendar Event ────────────────────────────────────────────

export interface ConvertToEventResult {
  event: CalendarEvent;
  logId: string;
}

export async function convertActionItemToEvent(
  item: AirtableActionItem,
): Promise<ConvertToEventResult> {
  // Map fields: task → title, task_details → description, due_date → start/end (all-day)
  const startIso = item.due_date
    ? `${item.due_date}T09:00:00`
    : new Date().toISOString().slice(0, 10) + "T09:00:00";
  const endIso = item.due_date
    ? `${item.due_date}T10:00:00`
    : new Date().toISOString().slice(0, 10) + "T10:00:00";

  const { data: event } = await schedulerApi.createEvent({
    title: item.task || "Untitled",
    description: [
      item.task_details,
      item.account_name ? `Account: ${item.account_name}` : "",
      item.assignee_name ? `Assignee: ${item.assignee_name}` : "",
    ].filter(Boolean).join("\n"),
    start_datetime: new Date(startIso).toISOString(),
    end_datetime: new Date(endIso).toISOString(),
    all_day: false,
    status: "confirmed",
    is_synced: false,
    account: item.account ?? null,
  } as Partial<CalendarEvent>);

  // Log with full snapshot for restore
  const logEntry = {
    category: "action_item" as const,
    message: `Converted action item "${item.task || "Untitled"}" to calendar event`,
    links: [
      { label: "View calendar", path: "/calendar" },
      { label: "View action items", path: "/action-items" },
    ],
    resource: { type: "action_item" as const, id: item.airtable_id },
    restoreData: {
      direction: "action_item_to_event",
      original: item as unknown as Record<string, unknown>,
      createdEventId: event.id,
    },
  };
  addLog(logEntry);
  // Find the log id by matching the most-recently-added entry
  const { getLogs } = await import("../lib/appLog");
  const logId = getLogs()[0]?.id ?? "";

  // Delete the original action item
  await airtableApi.deleteActionItem(item.id).catch(() => {});

  return { event, logId };
}

// ─── Calendar Event → Action Item ────────────────────────────────────────────

export interface ConvertToActionItemResult {
  item: AirtableActionItem;
  logId: string;
}

export async function convertEventToActionItem(
  event: CalendarEvent,
): Promise<ConvertToActionItemResult> {
  const dueDate = event.start_datetime
    ? event.start_datetime.slice(0, 10)
    : null;

  const { data: item } = await airtableApi.createActionItem({
    task: event.title || "Untitled",
    task_details: event.description || "",
    status: "Open",
    priority: "Medium",
    due_date: dueDate,
    account: event.account ?? null,
    account_name: event.account_name ?? null,
  } as Partial<AirtableActionItem>);

  const logEntry = {
    category: "calendar" as const,
    message: `Converted calendar event "${event.title || "Untitled"}" to action item`,
    links: [
      { label: "View action items", path: "/action-items" },
      { label: "View calendar", path: "/calendar" },
    ],
    resource: { type: "calendar_event" as const, id: event.id },
    restoreData: {
      direction: "event_to_action_item",
      original: event as unknown as Record<string, unknown>,
      createdItemAirtableId: item.airtable_id,
      createdItemId: item.id,
    },
  };
  addLog(logEntry);
  const { getLogs } = await import("../lib/appLog");
  const logId = getLogs()[0]?.id ?? "";

  // Delete the original event
  await schedulerApi.deleteEvent(event.id).catch(() => {});

  return { item, logId };
}

// ─── Restore helpers ──────────────────────────────────────────────────────────

/** Called when user clicks "Restore" on a conversion log entry. */
export async function restoreConversion(
  restoreData: Record<string, unknown>,
): Promise<void> {
  const direction = restoreData.direction as string;

  if (direction === "action_item_to_event") {
    // Recreate the original action item, delete the calendar event
    const original = restoreData.original as Partial<AirtableActionItem>;
    const eventId = restoreData.createdEventId as number;
    await airtableApi.createActionItem(original);
    await schedulerApi.deleteEvent(eventId).catch(() => {});
    addLog({
      category: "action_item",
      message: `Restored action item "${original.task || "Untitled"}" from calendar event`,
      links: [{ label: "View action items", path: "/action-items" }],
    });
  } else if (direction === "event_to_action_item") {
    // Recreate the original calendar event, delete the action item
    const original = restoreData.original as Partial<CalendarEvent>;
    const itemId = restoreData.createdItemId as number;
    await schedulerApi.createEvent(original);
    await airtableApi.deleteActionItem(itemId).catch(() => {});
    addLog({
      category: "calendar",
      message: `Restored calendar event "${original.title || "Untitled"}" from action item`,
      links: [{ label: "View calendar", path: "/calendar" }],
    });
  }
}

// Re-export patchLog so callers can update log entries after creation
export { patchLog };
