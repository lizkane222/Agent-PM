import { useState } from "react";

interface Props {
  initialName?: string;
  initialIsPublic?: boolean;
  editingOwned?: boolean;
  onSave: (name: string, isPublic: boolean, mode: "update" | "create") => Promise<void>;
  onClose: () => void;
}

export default function SaveLayoutModal({
  initialName = "",
  initialIsPublic = true,
  editingOwned = false,
  onSave,
  onClose,
}: Props) {
  const [name, setName] = useState(initialName);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [saving, setSaving] = useState<null | "update" | "create">(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(mode: "update" | "create") {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(mode);
    setError(null);
    try {
      await onSave(name.trim(), isPublic, mode);
      onClose();
    } catch {
      setError("Failed to save layout. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-bold text-[var(--twilio-navy)] mb-4">
          {editingOwned ? "Save Changes" : "Save Layout"}
        </h2>
        <form onSubmit={(e) => { e.preventDefault(); submit(editingOwned ? "update" : "create"); }} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--twilio-gray-60)] mb-1">
              Layout Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Account Overview, Weekly Prep"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--twilio-blue)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="is-public"
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="is-public" className="text-xs text-[var(--twilio-gray-60)] cursor-pointer select-none">
              Share with team (allow others to fork &amp; use)
            </label>
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-[var(--twilio-gray-60)] hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            {editingOwned && (
              <button
                type="button"
                onClick={() => submit("create")}
                disabled={saving !== null}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {saving === "create" ? "Saving…" : "Save as New"}
              </button>
            )}
            <button
              type="submit"
              disabled={saving !== null}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--twilio-blue)] text-white hover:bg-[var(--twilio-blue-dark,#0070d2)] disabled:opacity-50 transition-colors"
            >
              {saving === (editingOwned ? "update" : "create")
                ? "Saving…"
                : editingOwned ? "Save Changes" : "Save Layout"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
