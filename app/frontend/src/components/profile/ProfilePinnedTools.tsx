import { usePinnedApplets } from "../../hooks/usePinnedApplets";
import PinnedTools from "../discover/PinnedTools";

/** "Pinned from Discovery": the tools, sites, docs and repos I pinned to my own profile. */
export default function ProfilePinnedTools() {
  const { data, loading, error, unpin } = usePinnedApplets({ profile: true });
  if (loading && data.length === 0) {
    return <p className="text-xs" style={{ color: "var(--text-secondary, #9ca3af)" }}>Loading…</p>;
  }
  if (error) {
    return <p className="text-xs" style={{ color: "var(--text-secondary, #9ca3af)" }}>Could not load your pinned items.</p>;
  }
  return (
    <div
      style={{ background: "var(--surface-card, #fff)", border: "1px solid var(--border-subtle, rgba(0,0,0,0.08))", borderRadius: 10, padding: 12 }}
    >
      <PinnedTools
        pins={data}
        onUnpin={(id) => unpin(id).catch(() => undefined)}
        emptyText="Nothing pinned yet. Use the pin button on a card in Discovery."
      />
    </div>
  );
}
