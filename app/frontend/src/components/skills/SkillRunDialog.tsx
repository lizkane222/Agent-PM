import { useState } from "react";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import AccountMultiSelect from "./AccountMultiSelect";
import TemplateTabs from "./TemplateTabs";
import { agentSkillsApi } from "../../lib/api";
import { htmlToPreviewText } from "../../lib/noteHelpers";
import { injectToChat, launchVoice } from "./SkillLaunchButtons";
import type { AgentSkill, SkillRunInput } from "../../types/agents";

/**
 * Collects the run-time input for a skill — which accounts, which template, and a free-text
 * request that may be vague ("all recent action items from Acme", "meetings from October") —
 * then launches it in chat or a voice session.
 */
export default function SkillRunDialog({
  skill, mode, onClose,
}: {
  skill: AgentSkill;
  mode: "chat" | "voice";
  onClose: () => void;
}) {
  const defaults = skill.context_defaults ?? {};
  const [accountIds, setAccountIds] = useState<number[]>(defaults.account_ids ?? []);
  const [templateKey, setTemplateKey] = useState(skill.templates?.[0]?.key ?? "");
  const [freeHtml, setFreeHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const needsAccounts = !!defaults.needs_accounts;
  const canRun = !needsAccounts || accountIds.length > 0;

  async function run() {
    setBusy(true); setError(null);
    const input: SkillRunInput = {
      free_text: htmlToPreviewText(freeHtml),
      account_ids: accountIds,
      template_key: templateKey || undefined,
    };
    try {
      if (mode === "chat") {
        const { data } = await agentSkillsApi.run(skill.id, input);
        injectToChat(data.prompt);
        if (data.warnings.length) { setWarnings(data.warnings); return; }
      } else {
        const { data } = await agentSkillsApi.voiceStart(skill.id, input);
        launchVoice({ key: data.key, script: data.script, title: skill.name });
        if (data.warnings.length) { setWarnings(data.warnings); return; }
      }
      onClose();
    } catch (e) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't run this skill.");
    } finally { setBusy(false); }
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
            {mode === "chat" ? "Use in Chat" : "Use in Voice Session"} — {skill.name}
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
          {!warnings.length && (
            <button type="button" onClick={run} disabled={busy || !canRun}
              title={canRun ? undefined : "Choose at least one account"}
              style={{ padding: "7px 18px", borderRadius: "7px", border: "none", background: canRun ? "var(--twilio-red, #e22)" : "rgba(0,0,0,0.1)", color: "#fff", cursor: busy || !canRun ? "not-allowed" : "pointer", fontFamily: "var(--font-base)", fontWeight: 600 }}>
              {busy ? "Starting…" : mode === "chat" ? "Send to chat" : "Start voice session"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em" };
