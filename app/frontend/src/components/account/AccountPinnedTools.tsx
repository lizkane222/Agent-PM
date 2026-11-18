import { usePinnedApplets } from "../../hooks/usePinnedApplets";
import PinnedTools from "../discover/PinnedTools";

/** Tools, sites, docs and repos pinned from Discovery to this account (visible to everyone on it). */
export default function AccountPinnedTools({ accountId }: { accountId: number }) {
  const { data, loading, error, unpin } = usePinnedApplets({ account: accountId });
  return (
    <div style={{ padding: "0.75rem 1rem" }} data-testid="account-pinned-tools">
      {loading && data.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary, #9ca3af)" }}>Loading…</p>
      ) : error ? (
        <p className="text-xs" style={{ color: "var(--text-secondary, #9ca3af)" }}>Could not load pinned tools.</p>
      ) : (
        <PinnedTools
          pins={data}
          onUnpin={(id) => unpin(id).catch(() => undefined)}
          emptyText="Nothing pinned. Use the pin button in Discovery."
        />
      )}
    </div>
  );
}
