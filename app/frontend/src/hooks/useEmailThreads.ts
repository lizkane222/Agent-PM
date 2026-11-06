import { useSyncExternalStore } from "react";
import { emailThreadStore, accountThreadKey } from "../lib/emailThreadStore";
import type { LoadedThreads } from "../lib/emailThreadStore";

/** Gmail threads last loaded for an account (undefined until loaded). Not server data: a UI cache. */
export function useEmailThreads(accountId: number | string): LoadedThreads | undefined {
  return useSyncExternalStore(
    emailThreadStore.subscribe,
    () => emailThreadStore.get()[accountThreadKey(accountId)],
    () => undefined,
  );
}
