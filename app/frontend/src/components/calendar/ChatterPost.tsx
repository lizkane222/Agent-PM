import { useState } from "react";
import { salesforceApi } from "../../lib/api";

interface Props {
  recordId: string;
  recordName: string;
}

export default function ChatterPost({ recordId, recordName }: Props) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handlePost(e?: React.FormEvent) {
    e?.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await salesforceApi.postChatter(recordId, body.trim());
      setSuccess(true);
      setBody("");
      setTimeout(() => {
        setSuccess(false);
        setOpen(false);
      }, 2000);
    } catch {
      setError("Failed to post. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-[var(--twilio-gray-80)] hover:bg-gray-50 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Post Chatter
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handlePost(e)}
      className="mt-3 bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2"
    >
      <p className="text-sm font-medium text-blue-700">
        Post to Chatter — {recordName}
      </p>
      {success ? (
        <p className="text-sm text-green-600 font-medium">Posted successfully!</p>
      ) : (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // A bare Enter inside a <textarea> never submits the enclosing
              // form, so the submit path has to be triggered by hand.
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handlePost(); }
            }}
            rows={3}
            placeholder="Write an update…"
            className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm resize-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
            autoFocus
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setBody(""); setError(""); }}
              className="px-3 py-1 rounded-lg border border-gray-200 text-sm text-[var(--twilio-navy)] hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="px-3 py-1 rounded-lg text-sm font-medium text-white disabled:opacity-40"
              style={{ background: "#0070d2" }}
            >
              {submitting ? "Posting…" : "Post"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
