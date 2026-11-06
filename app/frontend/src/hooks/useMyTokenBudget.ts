import { useCallback, useEffect, useState } from "react";
import { tokenBudgetApi } from "../lib/api";
import type { MyBudget } from "../types/tokenBudget";

/**
 * The signed-in user's own daily token state.
 *
 * Deliberately not `useResource`: it is one object, not a `T[]` (the same exemption
 * `useCalendarColors` and `lib/localStore.ts` claim). Re-read whenever a chat turn finishes —
 * the app already broadcasts `agentSessionUpdated` then — so the warning shows up on the turn
 * that crosses the line.
 */
export function useMyTokenBudget() {
  const [budget, setBudget] = useState<MyBudget | null>(null);

  const refetch = useCallback(() => {
    tokenBudgetApi.mine()
      .then((r) => setBudget(r.data))
      .catch(() => { /* a missing banner is better than an error toast on every page */ });
  }, []);

  useEffect(() => {
    refetch();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "agentSessionUpdated") refetch();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refetch]);

  return { budget, refetch };
}
