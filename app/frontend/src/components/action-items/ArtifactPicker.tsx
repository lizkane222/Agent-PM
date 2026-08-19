import { useCallback, useEffect, useRef, useState } from "react";
import { accountsApi, airtableApi } from "../../lib/api";
import type { AccountArtifact, ActionItemAttachment } from "../../types";
import { ArtifactIconImg, CATALOG_BY_KEY, getAutoIconKey } from "../account/ArtifactIcon";

/**
 * "+ Artifact" — attach an artifact that already belongs to the action item's account,
 * rather than re-uploading a copy of it.
 *
 * Shared by every attachment surface (the modals, the side panels, and the Action Items
 * page) so the affordance and its behaviour cannot drift between them. It owns the fetch,
 * the attach call and the error message; callers only add the returned attachment to
 * their own list.
 *
 * Artifacts load lazily on first open. Eagerly fetching would mean two requests per
 * rendered action item just in case the menu is used.
 */

interface Props {
  /** Numeric PK of the action item to attach to. */
  actionItemId: number;
  /** The item's account name, used to resolve the account when `accountId` isn't known. */
  accountName?: string | null;
  /** App-side Account PK, when the surface already has it — skips the name lookup. */
  accountId?: number | null;
  onAttached: (attachment: ActionItemAttachment) => void;
  onError?: (message: string) => void;
  className?: string;
}

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
  return data?.detail ?? data?.error ?? fallback;
}

/**
 * Resolve the app-side Account PK from an account name.
 *
 * Action items carry an `account_name` and an AirtableAccount PK, but artifacts hang off
 * `accounts.Account`, whose PK is a different number. The Action Items page has no app
 * Account id in scope at all, so the name is the only usable join key there.
 */
async function resolveAccountId(accountName: string): Promise<number | null> {
  const { data } = await accountsApi.listAccounts({ search: accountName, page_size: "10" });
  const wanted = accountName.trim().toLowerCase();
  const match = data.results.find((a) => a.company_name?.trim().toLowerCase() === wanted);
  return match?.id ?? null;
}

export default function ArtifactPicker({
  actionItemId,
  accountName,
  accountId,
  onAttached,
  onError,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<AccountArtifact[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [attachingId, setAttachingId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Re-resolve if the item moves to a different account.
  useEffect(() => { setArtifacts(null); }, [accountId, accountName]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const id = accountId ?? (accountName ? await resolveAccountId(accountName) : null);
      if (!id) { setArtifacts([]); return; }
      const { data } = await accountsApi.listArtifacts(id);
      setArtifacts(data);
    } catch (err: unknown) {
      setArtifacts([]);
      onError?.(errorMessage(err, "Could not load this account's artifacts."));
    } finally {
      setLoading(false);
    }
  }, [accountId, accountName, onError]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && artifacts === null && !loading) void load();
  }

  async function pick(a: AccountArtifact) {
    const url = a.url ?? a.file_url ?? "";
    setAttachingId(a.id);
    try {
      const { data } = await airtableApi.addAttachmentLink(actionItemId, a.name || url, url);
      onAttached(data);
      setOpen(false);
    } catch (err: unknown) {
      onError?.(errorMessage(err, "Could not attach that artifact."));
    } finally {
      setAttachingId(null);
    }
  }

  return (
    <div className={`relative ${className ?? ""}`} ref={menuRef}>
      <button
        type="button"
        onClick={toggle}
        title="Attach an artifact from this account"
        className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
      >+ Artifact</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white shadow-lg rounded-lg border border-gray-200 w-56 py-1 max-h-52 overflow-y-auto">
          {loading && <p className="text-xs text-gray-400 italic px-3 py-2">Loading…</p>}
          {!loading && artifacts?.length === 0 && (
            <p className="text-xs text-gray-400 italic px-3 py-2">
              {accountName ? "No artifacts on this account" : "This item has no account"}
            </p>
          )}
          {!loading && (artifacts ?? []).map((a) => {
            const iconEntry = CATALOG_BY_KEY[a.icon_key || getAutoIconKey(a.url ?? "")] ?? CATALOG_BY_KEY["link"];
            return (
              <button
                key={a.id}
                type="button"
                disabled={attachingId != null}
                onClick={() => void pick(a)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left truncate disabled:opacity-40"
              >
                <span className="shrink-0">
                  <ArtifactIconImg entry={iconEntry} size={14} />
                </span>
                <span className="truncate text-[var(--twilio-navy)]">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
