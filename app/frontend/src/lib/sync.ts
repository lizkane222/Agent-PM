/**
 * Twilio Sync client singleton with React hooks.
 *
 * Usage:
 *   const events = useSyncList<AgentActivityEvent>("agent-feed");
 */

import { SyncClient } from "twilio-sync";
import { useEffect, useRef, useState } from "react";
import { realtimeApi } from "./api";

// ── Singleton ─────────────────────────────────────────────────────────────────

let syncClient: SyncClient | null = null;
let tokenFetchPromise: Promise<SyncClient> | null = null;

async function getSyncClient(): Promise<SyncClient> {
  if (syncClient && syncClient.connectionState !== "disconnected") {
    return syncClient;
  }

  if (tokenFetchPromise) return tokenFetchPromise;

  tokenFetchPromise = (async () => {
    const { data } = await realtimeApi.getSyncToken();

    if (syncClient) {
      await syncClient.updateToken(data.token);
      return syncClient;
    }

    syncClient = new SyncClient(data.token);

    syncClient.on("tokenAboutToExpire", async () => {
      const { data: refreshed } = await realtimeApi.getSyncToken();
      await syncClient!.updateToken(refreshed.token);
    });

    return syncClient;
  })().finally(() => {
    tokenFetchPromise = null;
  });

  return tokenFetchPromise;
}

export function destroySyncClient(): void {
  if (syncClient) {
    syncClient.shutdown();
    syncClient = null;
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to a Twilio Sync List and return its items as React state.
 * Automatically appends new items as they arrive.
 */
export function useSyncList<T extends { id?: unknown }>(
  listUniqueName: string,
  maxItems = 50
): { items: T[]; isLoading: boolean; error: Error | null } {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const listRef = useRef<Awaited<ReturnType<SyncClient["list"]>> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const client = await getSyncClient();
        const syncList = await client.list(listUniqueName);
        if (cancelled) return;

        listRef.current = syncList;

        // Load existing items.
        const page = await syncList.getItems({ pageSize: maxItems, order: "desc" });
        if (!cancelled) {
          setItems(page.items.map((i) => i.data as T).reverse());
          setIsLoading(false);
        }

        // Subscribe to new items.
        syncList.on("itemAdded", (event) => {
          if (cancelled) return;
          setItems((prev) => {
            const updated = [...prev, event.item.data as T];
            return updated.slice(-maxItems);
          });
        });

        syncList.on("itemUpdated", (event) => {
          if (cancelled) return;
          setItems((prev) =>
            prev.map((item) =>
              (item as Record<string, unknown>)["index"] === event.item.index
                ? (event.item.data as T)
                : item
            )
          );
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (listRef.current) {
        listRef.current.removeAllListeners();
      }
    };
  }, [listUniqueName, maxItems]);

  return { items, isLoading, error };
}

/**
 * Subscribe to a Twilio Sync Document and return its data as React state.
 */
export function useSyncDocument<T extends Record<string, unknown>>(
  documentUniqueName: string
): { data: T | null; isLoading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const docRef = useRef<Awaited<ReturnType<SyncClient["document"]>> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const client = await getSyncClient();
        const doc = await client.document(documentUniqueName);
        if (cancelled) return;

        docRef.current = doc;
        setData(doc.data as T);
        setIsLoading(false);

        doc.on("updated", (event) => {
          if (!cancelled) setData(event.data as T);
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (docRef.current) {
        docRef.current.removeAllListeners();
      }
    };
  }, [documentUniqueName]);

  return { data, isLoading, error };
}
