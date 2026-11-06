import { useCallback, useEffect, useState } from "react";
import { agentSkillsApi } from "../../lib/api";
import { fmtTokens, fmtUsd } from "../../lib/tokenBudget";
import type { SkillEstimateRow } from "../../types/tokenBudget";

function errorText(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't run the estimate.";
}

/**
 * Claude's estimate of what one run of each skill costs in tokens (and dollars at the
 * configured prices). Claude judges the shape of a run — how many model rounds, how big the
 * tool results — and the totals are computed from that plus the skill's measured prompt size,
 * so the same inputs always give the same numbers.
 */
export default function SkillEstimatesPanel() {
  const [rows, setRows] = useState<SkillEstimateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await agentSkillsApi.listTokenEstimates()).data.results);
      setError(null);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 403 ? "You don't have access to skill estimates." : "Failed to load.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function estimateOne(id: number) {
    setBusy(id); setNote(null);
    try {
      const { data } = await agentSkillsApi.estimateTokens(id);
      if (data.failed.length) setNote(`Couldn't estimate: ${data.failed.join(", ")}.`);
      await load();
    } catch (e) { setNote(errorText(e)); } finally { setBusy(null); }
  }

  async function estimateAll() {
    setBusy("all"); setNote(null);
    const failed: string[] = [];
    try {
      // The server estimates up to 10 per request; keep going until none are left or no progress.
      for (let i = 0; i < 20; i++) {
        const { data } = await agentSkillsApi.estimateTokens();
        failed.push(...data.failed);
        if (data.remaining === 0 || data.results.length === 0) break;
        if (data.failed.length === data.results.length) break;
      }
      if (failed.length) setNote(`Couldn't estimate: ${Array.from(new Set(failed)).join(", ")}.`);
      await load();
    } catch (e) { setNote(errorText(e)); } finally { setBusy(null); }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!rows) return <p className="text-sm text-gray-500">Loading…</p>;

  const needing = rows.filter((r) => r.stale).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600 leading-relaxed">
        What one run of each skill is expected to use. Claude judges how many rounds the task takes and how large its tool results
        are; the totals are then calculated from that and the skill's measured size (instructions, attachments, templates) plus the
        agent's fixed per-round input. It's an estimate — it doesn't model prompt caching or the length of a user's own request.
      </p>
      <div className="flex items-center gap-3">
        <button type="button" onClick={estimateAll} disabled={busy !== null || needing === 0}
          className="rounded-md bg-[var(--twilio-blue)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {busy === "all" ? "Estimating…" : needing === 0 ? "All estimates are current" : `Estimate ${needing} missing or outdated`}
        </button>
        {note && <span role="status" className="text-xs text-gray-600">{note}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No skills yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Skill</th><th className="px-3 py-2">Typical run</th><th className="px-3 py-2">Range (light → heavy)</th>
                <th className="px-3 py-2">Typical cost</th><th className="px-3 py-2">Estimate</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = r.estimate;
                return (
                  <FragmentRow key={r.id}>
                    <tr className="border-t border-gray-100 align-top" data-testid={`estimate-${r.name}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[var(--twilio-navy)]">{r.name}</div>
                        <div className="text-xs text-gray-500">{r.status.replace("_", " ")}{r.created_by_username ? ` · ${r.created_by_username}` : ""}</div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {e ? <>{fmtTokens(e.expected.total)} tokens<div className="text-xs text-gray-500">{e.expected.rounds} model round{e.expected.rounds === 1 ? "" : "s"}</div></> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-xs">
                        {e ? `${fmtTokens(e.low.total)} → ${fmtTokens(e.high.total)}` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {e ? <>{fmtUsd(r.expected_usd)}<div className="text-xs text-gray-500">up to {fmtUsd(r.high_usd)}</div></> : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {!e ? <span className="text-gray-500">not estimated</span>
                          : r.stale ? <span className="rounded bg-amber-50 px-1 text-amber-800">outdated — skill changed</span>
                          : <span className="text-green-700">current</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button type="button" onClick={() => estimateOne(r.id)} disabled={busy !== null} aria-label={`${e ? "Re-estimate" : "Estimate"} ${r.name}`}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium disabled:opacity-40">
                          {busy === r.id ? "…" : e ? "Re-estimate" : "Estimate"}
                        </button>
                        {e && (
                          <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}
                            className="ml-1 text-xs text-indigo-600 hover:underline">{open === r.id ? "Hide" : "How"}</button>
                        )}
                      </td>
                    </tr>
                    {e && open === r.id && (
                      <tr className="bg-gray-50" data-testid={`how-${r.name}`}>
                        <td colSpan={6} className="px-3 py-2 text-xs text-gray-600 leading-relaxed">
                          <p><strong>Claude's reasoning:</strong> {e.rationale || "—"}</p>
                          <p className="mt-1">
                            Each model round resends {fmtTokens(e.facts.base_round_input_tokens)} tokens of system prompt and tool definitions
                            plus {fmtTokens(e.facts.skill_prompt_tokens)} tokens from this skill
                            {e.facts.attachments ? ` (${e.facts.attachments} attachment${e.facts.attachments === 1 ? "" : "s"})` : ""}. Tool rounds add about
                            {" "}{fmtTokens(e.params.tool_result_tokens_per_round)} tokens of results and the model writes about
                            {" "}{fmtTokens(e.params.output_tokens_per_round)} per round.
                          </p>
                          <p className="mt-1 text-gray-500">{e.assumptions}</p>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A keyed wrapper so a data row and its detail row can sit under one <tbody> key. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
