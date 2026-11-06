import { useEffect, useState } from "react";
import { integrationsApi } from "../../lib/api";
import type { SlackConversations, SlackSource } from "../../types/agents";
import SkillMultiPicker from "./SkillMultiPicker";

const KIND_LABEL: Record<SlackSource["kind"], string> = {
  channel: "Channels", private_channel: "Private channels", dm: "Direct messages", group_dm: "Group DMs",
};

/**
 * Slack channels / DMs as extra context. Works as soon as the Slack token is approved —
 * until then it renders the same control in a disabled "not connected yet" state, and any
 * already-chosen sources are kept.
 */
export default function SlackSourcesField({
  value, onChange,
}: {
  value: SlackSource[];
  onChange: (next: SlackSource[]) => void;
}) {
  const [state, setState] = useState<SlackConversations | null>(null);

  useEffect(() => {
    let cancelled = false;
    integrationsApi.listSlackConversations()
      .then((r) => { if (!cancelled) setState(r.data); })
      .catch(() => { if (!cancelled) setState({ enabled: false, dms_available: false, conversations: [], detail: "Slack isn't available right now." }); });
    return () => { cancelled = true; };
  }, []);

  const convs = state?.conversations ?? [];
  // Keep chosen sources selectable even if the live list no longer includes them.
  const all = [...convs, ...value.filter((v) => !convs.some((c) => c.id === v.id))];
  const options = all.map((c) => ({ id: c.id, label: c.label, group: KIND_LABEL[c.kind] }));

  return (
    <SkillMultiPicker
      testId="slack-sources"
      label="SLACK CHANNELS & DMS"
      hint={state?.enabled && !state.dms_available ? "(channels only — connect your own Slack to include DMs)" : "(extra context the skill can read)"}
      options={options}
      selected={value.map((v) => v.id)}
      onChange={(ids) => onChange(ids.map((id) => all.find((c) => c.id === id)).filter((c): c is SlackSource => !!c))}
      placeholder="Search channels and people…"
      emptyText="No Slack conversations match"
      disabledReason={state && !state.enabled
        ? `${state.detail ?? "Slack isn't connected yet."} Once a Slack token is approved, your channels and DMs will appear here.`
        : undefined}
      chipColor="#4a154b"
    />
  );
}
