import { accountsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { Account } from "../types";

/** Every account the caller can see (one request, up to 500). */
export function useAccounts() {
  return useResource<Account>(
    () => accountsApi.listAccounts({ page_size: "500" }).then((r) => r.data.results),
  );
}
