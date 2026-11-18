import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { loadAccountDirectory } from "../lib/accountDirectory";
import { accountPath, isNumericAccountParam, resolveAccountParam } from "../lib/accountSlug";
import type { Account } from "../types";

/**
 * Turns the `/accounts/:id` route param (a number or a name slug) into the numeric id every API
 * call uses, and rewrites a numeric URL to the slug once the account is known.
 */
export function useAccountRoute(param: string | undefined, account: { id: number; company_name: string } | null) {
  const navigate = useNavigate();
  const location = useLocation();
  const [directory, setDirectory] = useState<Account[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAccountDirectory().then((d) => { if (!cancelled) setDirectory(d); }).catch(() => { if (!cancelled) setDirectory([]); });
    return () => { cancelled = true; };
  }, []);

  const numeric = isNumericAccountParam(param);
  const resolving = !numeric && !!param && directory === null;
  const id = numeric ? param : (directory ? String(resolveAccountParam(param, directory)?.id ?? "") || undefined : undefined);

  useEffect(() => {
    if (!directory || !account || !id || String(account.id) !== id) return;
    const target = accountPath(account, directory);
    // Never send the user to a URL that wouldn't resolve back to this account.
    if (resolveAccountParam(target.split("/").pop(), directory)?.id !== account.id) return;
    if (location.pathname !== target) {
      navigate({ pathname: target, search: location.search, hash: location.hash }, { replace: true });
    }
  }, [directory, account, id, location.pathname, location.search, location.hash, navigate]);

  return { id, resolving, directory };
}
