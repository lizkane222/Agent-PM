import { useCallback } from "react";
import { discoverApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AppletPin } from "../types/discover";

/**
 * Pins of Discovery items.
 *  - `{ profile: true }`      the caller's own profile pins
 *  - `{ account: <id> }`      the pins on one account (anyone on it can see them)
 *  - nothing                  every pin the caller can see (profile + their accounts)
 * `applet: null` account = pin to my profile.
 */
export function usePinnedApplets(scope: { profile?: boolean; account?: number | null } = {}) {
  const { profile, account } = scope;
  const resource = useResource<AppletPin>(
    () => {
      const params: Record<string, string> = {};
      if (profile) params.profile = "1";
      if (account != null) params.account = String(account);
      return discoverApi.listPins(params).then((r) => r.data);
    },
    [profile, account],
  );

  const pin = useCallback(
    async (applet: number, accountId: number | null): Promise<AppletPin> => {
      const { data } = await discoverApi.createPin({ applet, account: accountId });
      resource.refetch();
      return data;
    },
    [resource.refetch],
  );

  const unpin = useCallback(
    async (id: number): Promise<void> => {
      await discoverApi.deletePin(id);
      resource.refetch();
    },
    [resource.refetch],
  );

  return { ...resource, pin, unpin };
}
