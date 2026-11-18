/**
 * useSensitiveMarks -- the shared "hide when screen sharing" marks for one record.
 *
 * Reads the request-coalescing store in lib/sensitiveStore.ts (one batched request per
 * resource type, never one per component). `marks` is `undefined` until the first fetch
 * lands. `mark` / `unmark` re-throw so the caller can show a message; the store applies
 * the change locally and then re-reads the record from the server.
 *
 * Display only: marks mask text in this app's UI; the data stays stored and readable via
 * the API and exports. Not a `useResource` hook (shared cross-cutting store).
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  createSensitiveMark,
  getSensitiveMarks,
  removeSensitiveMark,
  requestSensitiveMarks,
  subscribeSensitiveMarks,
} from "../lib/sensitiveStore";
import type { SensitiveMark, SensitiveResourceType } from "../types/sensitive";

export function isMarkableId(id: string | number | null | undefined): id is string | number {
  if (id === null || id === undefined) return false;
  const s = String(id);
  return s !== "" && s !== "0" && !s.startsWith("local-") && !s.startsWith("-");
}

export function useSensitiveMarks(
  resourceType: SensitiveResourceType,
  resourceId: string | number | null | undefined,
) {
  const ok = isMarkableId(resourceId);
  const id = ok ? String(resourceId) : "";

  useEffect(() => {
    if (ok) requestSensitiveMarks(resourceType, id);
  }, [ok, resourceType, id]);

  const marks = useSyncExternalStore(
    subscribeSensitiveMarks,
    () => (ok ? getSensitiveMarks(resourceType, id) : undefined),
    () => undefined,
  );

  const mark = useCallback(
    (args: { field: string; text: string; lineKey?: string }): Promise<SensitiveMark> =>
      createSensitiveMark({ resourceType, resourceId: id, ...args }),
    [resourceType, id],
  );
  const unmark = useCallback(
    (markId: number) => removeSensitiveMark(resourceType, id, markId),
    [resourceType, id],
  );

  return { marks, mark, unmark };
}

/** The id to mark an action item under: its database id, or none for an unsaved `local-*` draft. */
export function actionItemMarkId(item: { id: number | string; airtable_id?: string | null }): string | number | null {
  return item.airtable_id?.startsWith("local-") ? null : item.id;
}
