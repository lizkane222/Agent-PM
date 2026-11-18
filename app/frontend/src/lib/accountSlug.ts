/**
 * Account URLs show the account's name instead of its number:
 * `/accounts/autodesk` rather than `/accounts/1234`. The API still uses the numeric id.
 *
 * slug = company name with every non A-Z/a-z character removed, lowercased
 * ("Festival Foods & Schnucks" -> "festivalfoodsschnucks"; "Café" -> "caf").
 */
export interface SluggableAccount {
  id: number;
  company_name: string;
}

export function accountSlug(name: string | null | undefined): string {
  return (name ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
}

/** Accounts whose slug is `slug`. */
function withSlug<T extends SluggableAccount>(slug: string, accounts: readonly T[]): T[] {
  return accounts.filter((a) => accountSlug(a.company_name) === slug);
}

/** True when the slug is non-empty, the account is in the list, and no other account shares the slug. */
export function hasUniqueSlug(account: SluggableAccount, accounts: readonly SluggableAccount[] = []): boolean {
  const slug = accountSlug(account.company_name);
  if (!slug) return false;
  // An account missing from the list can't be resolved back from its slug, so it keeps its number.
  if (!accounts.some((a) => a.id === account.id)) return false;
  return withSlug(slug, accounts).every((a) => a.id === account.id);
}

/**
 * `/accounts/<slug>` when the slug is usable; otherwise `/accounts/<id>`, so a link is never
 * empty or ambiguous (digits-only/symbol-only names, or two accounts that slug the same).
 * With no list to check against, the numeric URL is used.
 */
export function accountPath(account: SluggableAccount, accounts?: readonly SluggableAccount[]): string {
  if (accounts && accounts.length > 0 && hasUniqueSlug(account, accounts)) {
    return `/accounts/${accountSlug(account.company_name)}`;
  }
  return `/accounts/${account.id}`;
}

/** Path for an account known only by name+id, used where the list isn't at hand. */
export function accountPathById(id: number | string): string {
  return `/accounts/${id}`;
}

/** Resolve the `:id` route param: all digits -> by id, otherwise by slug. Ambiguous or unknown -> null. */
export function resolveAccountParam<T extends SluggableAccount>(param: string | undefined, accounts: readonly T[]): T | null {
  if (!param) return null;
  if (/^\d+$/.test(param)) return accounts.find((a) => a.id === Number(param)) ?? null;
  const slug = param.toLowerCase();
  const matches = withSlug(slug, accounts);
  return matches.length === 1 ? matches[0] : null;
}

export const isNumericAccountParam = (param: string | undefined): boolean => !!param && /^\d+$/.test(param);
