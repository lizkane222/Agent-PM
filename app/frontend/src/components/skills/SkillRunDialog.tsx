import { useState } from "react";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import AccountMultiSelect from "./AccountMultiSelect";
import TemplateTabs from "./TemplateTabs";
import { agentSkillsApi } from "../../lib/api";
import { htmlToPreviewText } from "../../lib/noteHelpers";
import { TIMEFRAME_PRESETS, DEFAULT_TIMEFRAME, CUSTOM_TIMEFRAME, customRange } from "../../lib/timeframes";
import { injectToChat, launchVoice, type LaunchContext, type LaunchMode } from "./SkillLaunchButtons";
import type { AgentSkill, SkillRunInput } from "../../types/agents";

/**
 * Whether a skill's lookups take a date range: it uses a `${date_range}`-style placeholder in its
 * instructions or templates. Only then does the dialog ask for one.
 */
export function usesDateRange(skill: Pick<AgentSkill, "instructions" | "templates">): boolean {
  const text = [skill.instructions ?? "", ...(skill.templates ?? []).map((t) => t.body_html ?? "")].join("\n");
  return /\$\{\s*(date[-_ ]?range|range|dates|period|time[-_ ]range)\s*\}/i.test(text);
}

/**
 * Collects the run-time input for a skill — which accounts, which template, and a free-text
 * request that may be vague ("all recent action items from Acme", "meetings from October") —
 * then launches it in chat or a voice session.
 */
export default function SkillRunDialog({
  skill, mode, onClose, context,
}: {
  skill: AgentSkill;
  mode: LaunchMode;
  onClose: () => void;
  context?: LaunchContext;
}) {
  const defaults = skill.context_defaults ?? {};
  const [accountIds, setAccountIds] = useState<number[]>(context?.accountIds?.length ? context.accountIds : (defaults.account_ids ?? []));
  const [templateKey, setTemplateKey] = useState(skill.templates?.[0]?.key ?? "");
  const [freeHtml, setFreeHtml] = useState("");
  // A preset button (default: last 30 days), or "custom" with two dates.
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_TIMEFRAME);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const dateRange = timeframe === CUSTOM_TIMEFRAME ? customRange(customFrom, customTo) : timeframe;
  const askDateRange = usesDateRange(skill);
  const [busy, setBusy] = useState<LaunchMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const needsAccounts = !!defaults.needs_accounts;
  const customIncomplete = askDateRange && timeframe === CUSTOM_TIMEFRAME && !dateRange;
  const canRun = (!needsAccounts || accountIds.length > 0) && !customIncomplete;
  const blockedReason = customIncomplete ? "Choose both dates" : "Choose at least one account";

  /** Every launch the dialog offers uses the same input; `which` is the button that was pressed. */
  async function launch(which: LaunchMode) {
    setBusy(which); setError(null);
    const input: SkillRunInput = {
      free_text: htmlToPreviewText(freeHtml),
      account_ids: accountIds,
      template_key: templateKey || undefined,
      ...(askDateRange && dateRange ? { date_range: dateRange } : {}),
      ...(context?.page ? { page: context.page } : {}),
    };
    try {
      if (which !== "voice") {
        const { data } = await agentSkillsApi.run(skill.id, input);
        injectToChat(data.prompt, data.run_id, which === "run");
        if (data.warnings.length) { setWarnings(data.warnings); return; }
      } else {
        const { data } = await agentSkillsApi.voiceStart(skill.id, input);
        launchVoice({ key: data.key, script: data.script, title: skill.name });
        if (data.warnings.length) { setWarnings(data.warnings); return; }
      }
      onClose();
    } catch (e) {
      console.error("Skill launch failed", e);
      setError(describeLaunchError(e));
    } finally { setBusy(null); }
  }

  return (
    <div role="dialog" aria-label={`Run ${skill.name}`} onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(680px, 94vw)", maxHeight: "90vh", overflowY: "auto", background: "var(--surface, #fff)",
        borderRadius: "12px", padding: "22px 26px", display: "flex", flexDirection: "column", gap: "16px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "1.0625rem" }}>
            Run — {skill.name}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", fontSize: "1.25rem", cursor: "pointer" }}>×</button>
        </div>

        <div>
          <label style={label}>WHAT SHOULD IT DO? <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — vague is fine)</span></label>
          <RichTextMentionEditor
            value={freeHtml}
            onChange={setFreeHtml}
            enableKeywords
            minHeightClassName="min-h-[70px]"
            placeholder="e.g. all recent action items from Acme · all meetings from October · @# to pick a record"
          />
        </div>

        <AccountMultiSelect
          selected={accountIds}
          onChange={setAccountIds}
          label={needsAccounts ? "ACCOUNTS (required)" : "ACCOUNTS (optional)"}
        />

        {askDateRange && (
          <div>
            <label id="skill-timeframe-label" style={label}>TIMEFRAME <span style={{ fontWeight: 400, opacity: 0.6 }}>(last 30 days unless you choose another)</span></label>
            <div role="group" aria-labelledby="skill-timeframe-label" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {[...TIMEFRAME_PRESETS, { value: CUSTOM_TIMEFRAME, label: "Custom…" }].map((t) => {
                const on = timeframe === t.value;
                return (
                  <button key={t.value} type="button" aria-pressed={on} onClick={() => setTimeframe(t.value)}
                    style={{
                      padding: "5px 12px", borderRadius: "999px", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-base)",
                      border: on ? "1.5px solid var(--twilio-red, #e22)" : "1px solid rgba(0,0,0,0.15)",
                      background: on ? "rgba(226,35,26,0.08)" : "transparent",
                      color: on ? "var(--twilio-red, #e22)" : "var(--text-primary, #333)",
                    }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
            {timeframe === CUSTOM_TIMEFRAME && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                <label style={{ fontSize: "0.8125rem" }}>From{" "}
                  <input type="date" aria-label="From date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: "7px", border: "1px solid rgba(0,0,0,0.18)", fontFamily: "var(--font-base)" }} />
                </label>
                <label style={{ fontSize: "0.8125rem" }}>To{" "}
                  <input type="date" aria-label="To date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: "7px", border: "1px solid rgba(0,0,0,0.18)", fontFamily: "var(--font-base)" }} />
                </label>
              </div>
            )}
          </div>
        )}

        {(skill.templates?.length ?? 0) > 0 && (
          <div>
            <label style={label}>WHICH TEMPLATE?</label>
            <TemplateTabs templates={skill.templates} readOnly selectedKey={templateKey} onSelect={setTemplateKey} />
          </div>
        )}

        {(skill.attachments?.length ?? 0) > 0 && (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
            📎 {skill.attachments.length} attached document{skill.attachments.length === 1 ? "" : "s"} will be used as context.
          </p>
        )}

        {error && <div role="alert" style={{ padding: "10px 14px", borderRadius: "7px", fontSize: "0.8125rem", background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>{error}</div>}
        {warnings.length > 0 && (
          <div role="status" style={{ padding: "10px 14px", borderRadius: "7px", fontSize: "0.8125rem", background: "rgba(234,179,8,0.12)", color: "#92400e" }}>
            Launched, with notes:
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={{ padding: "7px 16px", borderRadius: "7px", border: "1px solid rgba(0,0,0,0.15)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-base)", fontWeight: 600 }}>
            {warnings.length ? "Close" : "Cancel"}
          </button>
          {!warnings.length && ([
            { which: "run" as const, text: "Run skill", busyText: "Running…", hint: "Put it in chat and send it now" },
            { which: "chat" as const, text: "Send to chat", busyText: "Sending…", hint: "Put it in the chat box so you can edit it first" },
            { which: "voice" as const, text: "Start voice session", busyText: "Starting…", hint: "Talk it through in a voice session" },
          ].map(({ which, text, busyText, hint }) => {
            const primary = which === mode;
            const off = busy !== null || !canRun;
            return (
              <button key={which} type="button" onClick={() => void launch(which)} disabled={off}
                title={canRun ? hint : blockedReason}
                style={{
                  padding: "7px 18px", borderRadius: "7px", fontFamily: "var(--font-base)", fontWeight: 600,
                  cursor: off ? "not-allowed" : "pointer",
                  border: primary ? "none" : "1px solid rgba(226,35,26,0.4)",
                  background: primary ? (canRun ? "var(--twilio-red, #e22)" : "rgba(0,0,0,0.1)") : "transparent",
                  color: primary ? "#fff" : (canRun ? "var(--twilio-red, #e22)" : "var(--text-secondary, #aaa)"),
                }}>
                {busy === which ? busyText : text}
              </button>
            );
          }))}
        </div>
      </div>
    </div>
  );
}

/** Say what actually went wrong; a bare "couldn't run" gives the person nothing to act on. */
export function describeLaunchError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: unknown }; code?: string; message?: string };
  const data = err.response?.data as { detail?: unknown; error?: unknown; message?: unknown } | string | undefined;
  const fromBody = typeof data === "object" && data
    ? [data.detail, data.message, data.error].find((v): v is string => typeof v === "string" && v.trim() !== "")
    : undefined;
  if (fromBody) return fromBody;
  const status = err.response?.status;
  if (status === 429) return "Too many requests right now. Wait a few seconds and try again.";
  if (status === 401) return "Your session has expired. Reload the page and sign in again.";
  if (status && status >= 500) return `The server hit an error (${status}). Try again in a moment.`;
  if (status) return `The server rejected the request (${status}).`;
  if (err.code === "ECONNABORTED") return "The request took too long. Try again.";
  if (err.message === "Network Error") return "Couldn't reach the server. Check your connection and try again.";
  return `Couldn't run this skill${err.message ? ` (${err.message})` : ""}.`;
}

const label: React.CSSProperties = { display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em" };
