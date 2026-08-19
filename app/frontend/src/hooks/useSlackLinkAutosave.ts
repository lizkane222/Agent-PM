import { useCallback } from "react";
import { airtableApi } from "../lib/api";
import { logActionItemUpdate } from "../lib/actionItemLog";
import { useAppError } from "../context/AppErrorContext";
import type { AirtableActionItem } from "../types";

/**
 * Persist a pasted Slack link immediately, without waiting for Save.
 *
 * Every other field on these forms is a draft you review before saving. A Slack thread URL is
 * not — it is pasted from the clipboard, it is either right or it is not, and there is nothing
 * to review. Leaving it to the Save button meant the common flow (open the pill, paste, carry
 * on) lost the link with no sign that anything had gone wrong.
 *
 * Deliberately scoped to this one field rather than turning the whole form into an autosaving
 * one: that would change what the Save button means on six surfaces at once.
 *
 * Every caller goes through this hook so the guards and the failure message cannot drift.
 * `useAppError` has a no-op default, so it is safe on surfaces mounted without the provider —
 * the write still happens, only the banner is missing.
 */

export type SlackLinkTarget = Pick<AirtableActionItem, "airtable_id" | "slack_thread_url">;

/**
 * Returns null without touching the network when there is nothing to do: a `local-*` draft has
 * no server record yet (and `promoteBlankItem` throws its id away), and re-committing the same
 * URL — which a blur right after a paste-commit would do — is not a change.
 */
export async function saveSlackThreadUrl(
  item: SlackLinkTarget,
  url: string,
): Promise<AirtableActionItem | null> {
  if (item.airtable_id.startsWith("local-")) return null;
  const next = url.trim();
  if (next === (item.slack_thread_url ?? "").trim()) return null;
  const { data } = await airtableApi.updateActionItemFields(item.airtable_id, { slack_thread_url: next });
  // Diff against the pre-edit URL, but keep the returned row's other fields so the log
  // entry carries the real task name rather than "Untitled".
  logActionItemUpdate({ ...data, slack_thread_url: item.slack_thread_url }, { slack_thread_url: next });
  return data;
}

export function useSlackLinkAutosave(): (
  item: SlackLinkTarget,
  url: string,
  onUpdated?: (updated: AirtableActionItem) => void,
) => void {
  const { reportError } = useAppError();

  return useCallback(
    (item, url, onUpdated) => {
      void saveSlackThreadUrl(item, url)
        .then((updated) => { if (updated) onUpdated?.(updated); })
        // A silent failure here is the worst outcome: the chip renders the new link from local
        // form state, so the user has every reason to believe it saved.
        .catch(() => reportError("Could not save the Slack link — it is still unsaved.", "slack-link"));
    },
    [reportError],
  );
}
