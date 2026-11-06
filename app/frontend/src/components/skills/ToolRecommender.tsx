import { useState } from "react";
import { agentSkillsApi } from "../../lib/api";
import type { RecommendedTool } from "../../types/tokenBudget";

/**
 * "Recommend tools with Claude": reads the description (and any draft instructions) and
 * suggests the capabilities the skill needs. Nothing is applied until the author confirms,
 * and the server only ever returns tools a skill is allowed to use.
 */
export default function ToolRecommender({
  description, instructions, selected, onApply,
}: {
  description: string;
  instructions?: string;
  selected: string[];
  onApply: (names: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tools: RecommendedTool[]; limitations: string[] } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const ready = description.trim().length > 0;
  const fresh = result?.tools.filter((t) => !selected.includes(t.name)) ?? [];

  async function recommend() {
    setBusy(true); setError(null); setResult(null);
    try {
      const { data } = await agentSkillsApi.recommendTools(description.trim(), instructions);
      setResult(data);
      setChecked(new Set(data.tools.filter((t) => !selected.includes(t.name)).map((t) => t.name)));
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Couldn't get recommendations. Pick tools manually or try again.");
    } finally { setBusy(false); }
  }

  const toggle = (name: string) =>
    setChecked((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <div data-testid="tool-recommender" style={{ padding: "12px 14px", borderRadius: "8px", background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" onClick={recommend} disabled={!ready || busy}
          title={ready ? undefined : "Write a description first"}
          style={{
            padding: "7px 14px", borderRadius: "7px", fontSize: "0.8125rem", fontWeight: 600, fontFamily: "var(--font-base)",
            border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.08)", color: "#4f46e5",
            cursor: !ready || busy ? "not-allowed" : "pointer", opacity: !ready ? 0.6 : 1,
          }}>
          {busy ? "Claude is reading your description…" : "Recommend tools with Claude"}
        </button>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #777)" }}>
          Claude reads the description and suggests the capabilities this skill needs. You choose what to add.
        </span>
      </div>

      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#dc2626" }}>{error}</p>}

      {result && (
        <div style={{ marginTop: "10px" }}>
          {result.tools.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #666)" }}>
              Claude didn't find any tools this skill needs. It may only need to answer from its instructions.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
              {result.tools.map((t) => {
                const already = selected.includes(t.name);
                return (
                  <li key={t.name} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "0.8125rem" }}>
                    <input type="checkbox" aria-label={`Recommended: ${t.name}`} disabled={already}
                      checked={already || checked.has(t.name)} onChange={() => toggle(t.name)} style={{ marginTop: "3px" }} />
                    <span>
                      <code style={{ fontWeight: 600 }}>{t.name}</code>
                      {already && <span style={{ color: "#16a34a", marginLeft: "6px" }}>already selected</span>}
                      {t.reason && <span style={{ display: "block", color: "var(--text-secondary, #777)", fontSize: "0.75rem" }}>{t.reason}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {result.limitations.length > 0 && (
            <div role="note" style={{ marginTop: "10px", padding: "8px 10px", borderRadius: "6px", background: "rgba(234,179,8,0.12)", fontSize: "0.75rem", color: "#92400e" }}>
              Not available to skills: {result.limitations.join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            {fresh.length > 0 && (
              <button type="button" disabled={checked.size === 0}
                onClick={() => { onApply(Array.from(new Set([...selected, ...checked]))); setResult(null); }}
                style={{ padding: "5px 14px", borderRadius: "6px", fontSize: "0.8125rem", fontWeight: 600, border: "none", background: "#4f46e5", color: "#fff", cursor: checked.size === 0 ? "not-allowed" : "pointer", fontFamily: "var(--font-base)" }}>
                Add {checked.size} tool{checked.size === 1 ? "" : "s"}
              </button>
            )}
            <button type="button" onClick={() => setResult(null)}
              style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "0.8125rem", border: "1px solid rgba(0,0,0,0.15)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-base)" }}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
