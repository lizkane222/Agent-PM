import { accountsApi } from "./api";
import type { Account } from "../types";

/**
 * Every account the caller can see (their Admin workspace first). Shared by the sidebar and the
 * account page so slug URLs are checked for uniqueness against the same list. The two GETs go
 * through the request cache, so repeat callers coalesce.
 */
export async function loadAccountDirectory(fresh = false): Promise<Account[]> {
  const [listResult, adminResult] = await Promise.allSettled([
    accountsApi.listAccounts({ page_size: "500" }, { fresh }),
    accountsApi.getAdminAccount({ fresh }),
  ]);
  const regular: Account[] = listResult.status === "fulfilled"
    ? listResult.value.data.results.filter((a) => !a.is_admin_account)
    : [];
  const admin: Account | null = adminResult.status === "fulfilled" ? adminResult.value.data : null;
  return admin ? [admin, ...regular] : regular;
}
