import { useCallback, useEffect, useRef, useState } from "react";
import { airtableApi } from "../lib/api";
import { ACTION_ITEMS_UPDATED_KEY } from "../lib/actionItemEvents";
import { useResource } from "./useResource";
import type { AirtableActionItem } from "../types";

/**
 * Trailing debounce in front of a broadcast-driven reload. Same value ActionItemsPage uses
 * (SILENT_RELOAD_DEBOUNCE_MS): a single save can broadcast twice (account + status PATCH) and
 * two overlapping reloads can land out of order.
 */
export const ACTION_ITEM_LIST_RELOAD_DEBOUNCE_MS = 250;

export interface UseActionItemListOptions {
  /** `false` makes no request and returns an empty list (e.g. waiting on an id). Default true. */
  enabled?: boolean;
  /** Re-read when another surface announces `actionItemsUpdated`. Default true. */
  broadcast?: boolean;
  /** Override the broadcast debounce (tests). */
  debounceMs?: number;
}

export interface UseActionItemListResult {
  items: AirtableActionItem[];
  /** True only until the first result for the current params lands. Later reloads are silent. */
  loading: boolean;
  /** True while ANY request is in flight, including silent reloads. */
  refreshing: boolean;
  error: Error | null;
  /** Stable reference. */
  refetch: () => void;
  /** PATCH /fields/. Resolves the updated row, or null for a `local-*` id (never sent). */
  updateFields: (airtableId: string, patch: Partial<AirtableActionItem>) => Promise<AirtableActionItem | null>;
  /** PATCH /status/. Resolves the updated row, or null for a `local-*` id (never sent). */
  updateStatus: (airtableId: string, status: string) => Promise<AirtableActionItem | null>;
  /** DELETE by the row's numeric id. No-op for `local-*` ids and ids the list does not hold. */
  remove: (airtableId: string) => Promise<void>;
  create: (payload: Partial<AirtableActionItem>) => Promise<AirtableActionItem>;
}

/** The airtable list endpoint is an unpaginated array today; tolerate an envelope too. */
function unwrapList(data: unknown): AirtableActionItem[] {
  if (Array.isArray(data)) return data as AirtableActionItem[];
  const results = (data as { results?: unknown } | null | undefined)?.results;
  return Array.isArray(results) ? (results as AirtableActionItem[]) : [];
}

const isLocal = (airtableId: string) => airtableId.startsWith("local-");

/**
 * Action items from `/airtable/action-items/`, filtered server-side by `params`
 * (`status`, `account`, `account_name`, `airtable_id`, `page_size`, ...).
 *
 * Reloads are silent: `loading` is true for the first load of a given `params` only, so a page
 * never blanks itself into a spinner because of its own write (the 2026-08-19 session-log bug).
 * Mutations wait for the server, then `refetch()`; failures re-throw. No optimistic updates here —
 * a page that wants one keeps it in its own state.
 */
export function useActionItemList(
  params: Record<string, string> = {},
  opts: UseActionItemListOptions = {},
): UseActionItemListResult {
  const { enabled = true, broadcast = true, debounceMs = ACTION_ITEM_LIST_RELOAD_DEBOUNCE_MS } = opts;
  const key = JSON.stringify(params);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const { data, loading: rawLoading, error, refetch: baseRefetch } = useResource<AirtableActionItem>(
    () => (enabled
      ? airtableApi.listActionItems(paramsRef.current).then((r) => unwrapList(r.data))
      : Promise.resolve([])),
    [key, enabled],
  );

  // "Loading" = nothing has settled yet for these params.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  // useResource only flips to loading inside its own effect, so the render right after a params
  // change still carries the old "not loading" — only trust a not-loading that follows a loading
  // we saw for this key.
  const sawLoadingFor = useRef<string | null>(null);
  useEffect(() => {
    if (rawLoading) sawLoadingFor.current = key;
    else if (sawLoadingFor.current === key) setSettledKey(key);
  }, [rawLoading, key]);
  const loading = settledKey !== key;

  const lastRefetchAt = useRef(0);
  const refetch = useCallback(() => {
    lastRefetchAt.current = Date.now();
    baseRefetch();
  }, [baseRefetch]);

  useEffect(() => {
    if (!broadcast) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let receivedAt = 0;
    function onStorage(e: StorageEvent) {
      if (e.key !== ACTION_ITEMS_UPDATED_KEY) return;
      receivedAt = Date.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Our own mutation already refetched after this broadcast — don't read twice.
        if (lastRefetchAt.current >= receivedAt) return;
        refetch();
      }, debounceMs);
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (timer) clearTimeout(timer);
    };
  }, [broadcast, debounceMs, refetch]);

  // Read through a ref so the mutations keep one identity but see the current list.
  const dataRef = useRef(data);
  dataRef.current = data;

  const updateFields = useCallback(async (airtableId: string, patch: Partial<AirtableActionItem>) => {
    if (isLocal(airtableId)) return null;
    const { data: updated } = await airtableApi.updateActionItemFields(airtableId, patch);
    refetch();
    return updated;
  }, [refetch]);

  const updateStatus = useCallback(async (airtableId: string, status: string) => {
    if (isLocal(airtableId)) return null;
    const { data: updated } = await airtableApi.updateActionItemStatus(airtableId, status);
    refetch();
    return updated;
  }, [refetch]);

  const remove = useCallback(async (airtableId: string) => {
    if (isLocal(airtableId)) return;
    const row = dataRef.current.find((i) => i.airtable_id === airtableId);
    if (!row) return;
    await airtableApi.deleteActionItem(row.id);
    refetch();
  }, [refetch]);

  const create = useCallback(async (payload: Partial<AirtableActionItem>) => {
    const { data: created } = await airtableApi.createActionItem(payload);
    refetch();
    return created;
  }, [refetch]);

  return { items: data, loading, refreshing: rawLoading, error, refetch, updateFields, updateStatus, remove, create };
}
