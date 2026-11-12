import { useState } from "react";
import { useStatusLabels } from "../../hooks/useStatusLabels";
import { CANONICAL_STATUSES, STATUS_LABEL_OPTIONS } from "../../lib/statusLabels";

/** Settings: choose which name is displayed for each action-item status (display only). */
export default function StatusNamesSection() {
  const { label, setLabel } = useStatusLabels();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm" data-testid="status-names-section">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Status names</h2>
        <p className="text-sm text-[var(--twilio-navy)] mt-0.5">
          Choose the name shown for each action-item status. Only the label you see changes; the status itself is unchanged.
        </p>
      </div>
      <div className="px-6 py-4 space-y-3">
        {CANONICAL_STATUSES.map((status) => {
          const options = STATUS_LABEL_OPTIONS[status];
          return (
            <div key={status} className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600 w-28 shrink-0">{status}</span>
              <div role="radiogroup" aria-label={`Name for ${status}`} className="inline-flex rounded-md border border-gray-300 overflow-hidden">
                {options.map((name) => {
                  const active = label(status) === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setError(null);
                        setLabel(status, name).catch(() => setError("Could not save that name. Please try again."));
                      }}
                      className={`px-3 py-1 text-sm ${active ? "bg-[var(--twilio-navy)] text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-gray-500 w-32 text-right" aria-label={`Preview for ${status}`}>
                Shown as: <strong>{label(status)}</strong>
              </span>
            </div>
          );
        })}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>
    </section>
  );
}
