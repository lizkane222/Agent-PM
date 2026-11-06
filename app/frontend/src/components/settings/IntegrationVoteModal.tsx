import { useState } from "react";
import { createPortal } from "react-dom";
import { integrationsApi } from "../../lib/api";

export type IntegrationVote = "yes" | "not_now";

/**
 * Shown instead of a dead connect link for an integration that isn't configured on this
 * server. Records the user's YES / "Not now" so the backlog reflects demand.
 */
export default function IntegrationVoteModal({
  provider,
  name,
  currentVote,
  onClose,
  onVoted,
}: {
  provider: string;
  name: string;
  currentVote: IntegrationVote | null;
  onClose: () => void;
  onVoted: (vote: IntegrationVote) => void;
}) {
  const [saving, setSaving] = useState<IntegrationVote | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function vote(v: IntegrationVote) {
    setSaving(v);
    setError(null);
    try {
      await integrationsApi.voteIntegration(provider, v);
      onVoted(v);
      onClose();
    } catch {
      setError("Couldn't record your vote — please try again.");
    } finally {
      setSaving(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-vote-title"
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-xl bg-white shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="integration-vote-title" className="text-sm font-semibold text-[var(--twilio-navy)]">{name}</h3>
        <p className="mt-2 text-sm text-[var(--twilio-navy)]">
          This integration hasn&apos;t yet been configured but is on the list of desired future integrations.
          If you would like this integration to be added in the future vote YES, otherwise vote &quot;Not now&quot;.
        </p>
        {currentVote && (
          <p className="mt-2 text-xs text-[var(--twilio-gray-60)]">
            You voted {currentVote === "yes" ? "YES" : "Not now"} — you can change it.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => void vote("not_now")}
            disabled={saving !== null}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving === "not_now" ? "Saving…" : "Not now"}
          </button>
          <button
            onClick={() => void vote("yes")}
            disabled={saving !== null}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving === "yes" ? "Saving…" : "YES"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
