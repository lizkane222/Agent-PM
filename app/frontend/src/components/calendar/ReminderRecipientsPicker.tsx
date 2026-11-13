import { useEffect, useMemo, useState } from "react";
import { schedulerApi } from "../../lib/api";
import type { ReminderLink, ReminderRecipientChoices } from "../../types/scheduler";

interface Props {
  /** What the reminder is linked to; teammates come from the accounts those records lead to. */
  links: Pick<ReminderLink, "resource_type" | "resource_id">[];
  /** Selected recipient user ids (never includes the creator, who is always notified). */
  selected: number[];
  /** `names` are the chosen people's display names, in the same order, for the confirmation. */
  onChange: (ids: number[], names: string[]) => void;
  accent: string;
}

/**
 * Choose which teammates to notify in addition to yourself.
 *
 * The default is "Just me". The people offered are your manager (always, even if they are on none of
 * your accounts), those on the team of any account the
 * reminder's links lead to — an account link, or the account an action item or meeting is
 * filed under — so linking "Draft QBR deck" is enough to reach the Acme team. For a reminder about
 * your private Admin workspace, which has no team, it offers your colleagues instead. Anyone who has
 * turned off being notified by other users — or has never signed in to AgentPM, so has no way to be
 * notified in the app (most of a team, typically) — is shown but cannot be selected, with a tooltip
 * saying why (the server refuses them too — this only makes the reason visible). Picking
 * people here does not notify anyone: the form asks "are you sure?" before it saves.
 */
export default function ReminderRecipientsPicker({ links, selected, onChange, accent }: Props) {
  const [choices, setChoices] = useState<ReminderRecipientChoices>({ results: [], sources: [], accounts: [] });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  // Re-ask only when the set of linked records changes, not on every render.
  const key = useMemo(() => links.map((l) => `${l.resource_type}:${l.resource_id}`).join(","), [links]);

  useEffect(() => {
    setOpen(false);
    setFailed(false);
    let cancelled = false;
    setLoading(true);
    // Asked even with nothing linked: the user's manager is available to every reminder.
    schedulerApi.listReminderRecipients(links)
      .then(({ data }) => {
        if (cancelled) return;
        setChoices(data);
        // Someone picked through a link that has since been removed is no longer reachable.
        const reachable = new Set(data.results.flatMap((o) => (o.user_id === null ? [] : [o.user_id])));
        const kept = selected.filter((id) => reachable.has(id));
        if (kept.length !== selected.length) {
          onChange(kept, data.results.filter((o) => o.user_id !== null && kept.includes(o.user_id)).map((o) => o.name));
        }
      })
      .catch(() => { if (!cancelled) { setChoices({ results: [], sources: [], accounts: [] }); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const options = choices.results;

  if (!loading && !failed && options.length === 0) {
    const only = choices.sources.filter((x) => x !== "Your manager" && x !== "Your colleagues");
    return (
      <p className="text-[10px] text-[var(--twilio-gray-60)]" data-testid="recipients-hint">
        {links.length === 0
          ? "Notifies only you. Link an account — or an action item or meeting on one — to also notify teammates."
          : only.length > 0
            // The linked account is one you are on; there is just no one else on it.
            ? `Notifies only you. You are the only person on ${only.join(", ")}.`
            : "Notifies only you. None of the linked records belongs to an account you are on, so there is no team to pick from."}
      </p>
    );
  }

  const chosen = options.filter((o) => o.user_id !== null && selected.includes(o.user_id));
  const summary = chosen.length === 0 ? "Just me" : `Me + ${chosen.map((o) => o.name).join(", ")}`;
  const sources = choices.sources ?? choices.accounts;
  const several = sources.length > 1;

  function toggle(o: (typeof options)[number]) {
    if (!o.available || o.user_id === null) return;
    const id = o.user_id;
    const ids = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(ids, options.filter((x) => x.user_id !== null && ids.includes(x.user_id)).map((x) => x.name));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--twilio-gray-60)] shrink-0">Notify:</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Notify teammates"
          className="flex-1 min-w-0 text-left text-[11px] rounded border px-1.5 py-1 bg-white truncate"
          style={{ borderColor: accent }}
        >
          {summary}
        </button>
      </div>
      {open && (
        <div className="rounded border bg-white py-1 max-h-40 overflow-y-auto" style={{ borderColor: accent }} role="group" aria-label="Teammates to notify">
          {sources.length > 0 && (
            <p className="px-2 pb-1 text-[10px] text-[var(--twilio-gray-60)]" data-testid="recipients-from">
              From {sources.join(", ")}
            </p>
          )}
          <p className="px-2 pb-1 text-[10px] text-[var(--twilio-gray-60)]" data-testid="recipients-note">
            They are notified the way they chose in their own Settings.
          </p>
          {loading && <p className="px-2 py-1 text-[11px] text-[var(--twilio-gray-60)]">Loading…</p>}
          {!loading && failed && <p className="px-2 py-1 text-[11px] text-red-600">Couldn't load teammates.</p>}
          {!loading && !failed && options.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-[var(--twilio-gray-60)]">Nobody to pick from.</p>
          )}
          {options.map((o) => {
            // A team member who has never signed in has no user id; key and test-id by member then.
            const id = o.user_id ?? `m${o.member_id}`;
            return (
              // The tooltip sits on the wrapper: a disabled input swallows hover in some browsers.
              <div key={id} title={o.available ? undefined : o.reason} data-testid={`recipient-${id}`}>
                <label
                  className={`flex items-center gap-2 px-2 py-1 text-[11px] ${o.available ? "cursor-pointer hover:bg-gray-50" : "cursor-not-allowed opacity-50"}`}
                >
                  <input
                    type="checkbox"
                    checked={o.user_id !== null && selected.includes(o.user_id)}
                    disabled={!o.available}
                    onChange={() => toggle(o)}
                  />
                  <span className="truncate">{o.name}</span>
                  {several && o.accounts.length > 0 && (
                    <span className="text-[10px] text-[var(--twilio-gray-60)] truncate">({o.accounts.join(", ")})</span>
                  )}
                  {!o.available && (
                    <span className="ml-auto text-[10px] italic shrink-0">{o.user_id === null ? "not on AgentPM yet" : "not accepting"}</span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
