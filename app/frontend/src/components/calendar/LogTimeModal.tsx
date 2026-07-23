import { useState } from "react";
import { salesforceApi } from "../../lib/api";
import type { SalesforceProject, SalesforceTask } from "../../types";

interface Props {
  project: SalesforceProject;
  task?: SalesforceTask;
  onClose: () => void;
  onLogged: () => void;
}

export default function LogTimeModal({ project, task, onClose, onLogged }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [description, setDescription] = useState(task ? task.subject : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const totalMinutes = parseInt(hours) * 60 + parseInt(minutes);
    if (totalMinutes < 1) {
      setError("Duration must be at least 1 minute.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await salesforceApi.logTime({
        project_sf_id: project.sf_id,
        task_sf_id: task?.sf_id,
        date,
        duration_minutes: totalMinutes,
        description,
      });
      onLogged();
      onClose();
    } catch {
      setError("Failed to log time. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-[var(--twilio-navy)]">Log Time</h2>
            <p className="text-sm text-[var(--twilio-gray-60)] mt-0.5 truncate max-w-xs">
              {task ? task.subject : project.name}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--twilio-gray-60)] hover:text-[var(--twilio-gray-80)] text-xl">✕</button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-gray-80)] mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--twilio-gray-80)] mb-1">Duration</label>
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5 flex-1">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="w-16 border border-gray-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <span className="text-sm text-[var(--twilio-navy)]">hrs</span>
              </div>
              <div className="flex items-center gap-1.5 flex-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-16 border border-gray-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <span className="text-sm text-[var(--twilio-navy)]">min</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--twilio-gray-80)] mb-1">
              Description <span className="text-[var(--twilio-gray-60)]">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What did you work on?"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm text-[var(--twilio-gray-80)] hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#0263E0" }}
            >
              {submitting ? "Logging…" : "Log Time"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
