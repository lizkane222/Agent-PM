import { useState } from "react";
import { agentSkillsApi } from "../../lib/api";
import { VOICE_LAUNCH_EVENT, type VoiceLaunchDetail } from "../VoiceButton";
import SkillRunDialog from "./SkillRunDialog";
import type { AgentSkill } from "../../types/agents";

/** Where a launch comes from: a saved Agent PM skill, or plain text (Twilio skill, tool, example prompt). */
export type LaunchSource =
  | { kind: "agent-skill"; skill: AgentSkill }
  | { kind: "text"; title: string; chatText: string; voiceText?: string };

function errorText(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

export function injectToChat(text: string) {
  window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text } }));
}
export function launchVoice(detail: VoiceLaunchDetail) {
  window.dispatchEvent(new CustomEvent(VOICE_LAUNCH_EVENT, { detail }));
}

/**
 * "Use in Chat" + "Use in Voice Session", identical on every Claude Skills tab.
 *
 * An Agent PM skill that needs input (accounts, free text, templates) opens the run dialog
 * first; one that doesn't launches straight away. Text sources launch immediately.
 */
export default function SkillLaunchButtons({
  source, compact, disabled, disabledReason,
}: {
  source: LaunchSource;
  compact?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [dialog, setDialog] = useState<"chat" | "voice" | null>(null);
  const [busy, setBusy] = useState<"chat" | "voice" | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const needsInput = source.kind === "agent-skill" && (
    !!source.skill.context_defaults?.needs_accounts ||
    (source.skill.templates?.length ?? 0) > 0
  );

  async function go(mode: "chat" | "voice") {
    setMessage(null);
    if (needsInput) { setDialog(mode); return; }
    setBusy(mode);
    try {
      if (source.kind === "text") {
        if (mode === "chat") { injectToChat(source.chatText); setMessage({ text: "Sent to chat.", ok: true }); }
        else {
          const text = source.voiceText ?? source.chatText;
          const { data } = await agentSkillsApi.voiceLaunch(source.title, text);
          launchVoice({ key: data.key, script: data.script, title: source.title });
        }
      } else if (mode === "chat") {
        const { data } = await agentSkillsApi.run(source.skill.id);
        injectToChat(data.prompt);
        setMessage({ text: "Sent to chat.", ok: true });
      } else {
        const { data } = await agentSkillsApi.voiceStart(source.skill.id);
        launchVoice({ key: data.key, script: data.script, title: source.skill.name });
      }
    } catch (e) {
      setMessage({ text: errorText(e, mode === "chat" ? "Couldn't send to chat." : "Couldn't start the voice session."), ok: false });
    } finally { setBusy(null); }
  }

  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-base)", fontWeight: 600,
    borderRadius: "7px", cursor: disabled || busy ? "not-allowed" : "pointer",
    padding: compact ? "5px 12px" : "7px 18px", fontSize: compact ? "0.75rem" : "0.875rem",
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "inline-flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => go("chat")} disabled={disabled || busy !== null} title={disabled ? disabledReason : undefined}
          style={{ ...base, background: disabled ? "rgba(0,0,0,0.07)" : "var(--twilio-red, #e22)", color: disabled ? "var(--text-secondary, #aaa)" : "#fff", border: "none" }}>
          {busy === "chat" ? "Sending…" : "Use in Chat"}
        </button>
        <button type="button" onClick={() => go("voice")} disabled={disabled || busy !== null} title={disabled ? disabledReason : undefined}
          style={{ ...base, background: "transparent", color: disabled ? "var(--text-secondary, #aaa)" : "var(--twilio-red, #e22)", border: `1px solid ${disabled ? "rgba(0,0,0,0.12)" : "rgba(226,35,26,0.4)"}` }}>
          {busy === "voice" ? "Starting…" : "Use in Voice Session"}
        </button>
      </div>
      {message && <span role="status" style={{ fontSize: "0.75rem", color: message.ok ? "#16a34a" : "#dc2626" }}>{message.text}</span>}
      {dialog && source.kind === "agent-skill" && (
        <SkillRunDialog skill={source.skill} mode={dialog} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
