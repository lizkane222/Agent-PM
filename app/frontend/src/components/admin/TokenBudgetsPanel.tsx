import { useCallback, useEffect, useState } from "react";
import { tokenBudgetApi } from "../../lib/api";
import { fmtTokens, fmtUsd, stateLabel } from "../../lib/tokenBudget";
import type { LimitInput, RoleBudgetRow, TokenBudgetOverview, UserBudgetRow } from "../../types/tokenBudget";
import LimitField, { type LimitEdit } from "./LimitField";

const CONSISTENT_DAYS = 3;   // "consistently hit" = limits reached on this many of the last 14 days

type Draft = Partial<Record<"warn" | "block", LimitEdit>>;

function toInput(draft: Draft): LimitInput {
  const out: Record<string, number | string | null> = {};
  for (const name of ["warn", "block"] as const) {
    const d = draft[name];
    if (d) out[`${name}_${d.unit}`] = d.value;
  }
  return out as LimitInput;
}

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: { detail?: string } } })?.response?.data;
  return data?.detail ?? "Couldn't save that.";
}

export default function TokenBudgetsPanel() {
  const [data, setData] = useState<TokenBudgetOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData((await tokenBudgetApi.overview()).data);
      setError(null);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 403 ? "You don't have access to token budgets." : "Failed to load.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  const blended = Number(data.pricing.blended_usd_per_million);
  const nobodyLimited = data.roles.every((r) => r.warn.tokens === null && r.block.tokens === null)
    && data.users.every((u) => !u.has_override);

  return (
    <div className="flex flex-col gap-8">
      <HowItWorks counts={data.counts} />
      {nobodyLimited && (
        <p role="note" className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
          No limits are set yet, so nobody is limited. Set a daily warn and block amount for each role below.
        </p>
      )}
      <PricingCard pricing={data.pricing} onSaved={load} />
      <RoleDefaults roles={data.roles} blended={blended} onSaved={load} />
      <People users={data.users} blended={blended} onSaved={load} />
    </div>
  );
}

function HowItWorks({ counts }: { counts: string }) {
  return (
    <section className="text-sm text-gray-600 leading-relaxed">
      <p>
        Each person has a <strong>daily</strong> token allowance (their own local day). At the <strong>warn</strong> limit
        they see a notice and admins are notified; nothing stops. At the <strong>block</strong> limit new chat, voice and
        skill runs are refused until tomorrow. <strong>Restrict</strong> a person to make their warn limit a block too — useful
        for anyone who keeps hitting it. A turn already running is never cut off.
      </p>
      <p className="mt-1 text-xs text-gray-500">{counts}</p>
    </section>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────────────

function PricingCard({ pricing, onSaved }: { pricing: TokenBudgetOverview["pricing"]; onSaved: () => void }) {
  const [input, setInput] = useState(pricing.input_usd_per_million);
  const [output, setOutput] = useState(pricing.output_usd_per_million);
  const [share, setShare] = useState(String(Math.round(Number(pricing.output_share) * 100)));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [convTokens, setConvTokens] = useState("20000");

  useEffect(() => {
    setInput(pricing.input_usd_per_million);
    setOutput(pricing.output_usd_per_million);
    setShare(String(Math.round(Number(pricing.output_share) * 100)));
  }, [pricing]);

  const sh = Math.min(100, Math.max(0, Number(share) || 0)) / 100;
  const blended = Number(input) * (1 - sh) + Number(output) * sh;
  const dirty = Number(input) !== Number(pricing.input_usd_per_million)
    || Number(output) !== Number(pricing.output_usd_per_million)
    || sh !== Number(pricing.output_share);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await tokenBudgetApi.setPricing({ input_usd_per_million: input, output_usd_per_million: output, output_share: sh });
      await onSaved();
      setMsg("Saved. Limits you've already set keep their token amounts; their dollar values update.");
    } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); }
  }

  const field = "w-24 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-indigo-500 focus:outline-none";
  return (
    <section aria-labelledby="pricing-h" className="rounded-lg border border-gray-200 p-4">
      <h3 id="pricing-h" className="text-sm font-semibold text-[var(--twilio-navy)]">Token ↔ dollar rate</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">
        Budgets are stored in tokens and shown in dollars at the blended rate below. Set the prices to match the model and
        your contract — they are yours to set, not read from anywhere.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-gray-600">Input $ / 1M tokens
          <input className={`${field} block mt-1`} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Input price per million" />
        </label>
        <label className="text-xs text-gray-600">Output $ / 1M tokens
          <input className={`${field} block mt-1`} value={output} onChange={(e) => setOutput(e.target.value)} aria-label="Output price per million" />
        </label>
        <label className="text-xs text-gray-600">Assumed output share (%)
          <input className={`${field} block mt-1`} value={share} onChange={(e) => setShare(e.target.value)} aria-label="Output share percent" />
        </label>
        <div className="text-sm" data-testid="blended-rate">
          <div className="text-xs text-gray-500">Blended rate</div>
          <strong>${blended.toFixed(2)}</strong> <span className="text-gray-500">per 1M tokens</span>
        </div>
        <button type="button" onClick={save} disabled={!dirty || busy}
          className="rounded-md bg-[var(--twilio-blue)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {busy ? "Saving…" : "Save rate"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Blended = input × (1 − output share) + output × output share. Actual usage is priced exactly from its real input and
        output counts; the blend is only used to convert a budget between tokens and dollars.
      </p>
      <p className="mt-3 text-sm" data-testid="converter">
        <span className="text-gray-500">Quick convert: </span>
        <input className={`${field} w-28`} value={convTokens} onChange={(e) => setConvTokens(e.target.value.replace(/[^\d]/g, ""))} aria-label="Tokens to convert" />{" "}
        tokens ≈ <strong>{fmtUsd((Number(convTokens || 0) * blended) / 1_000_000)}</strong>
      </p>
      {msg && <p role="status" className="mt-2 text-xs text-gray-600">{msg}</p>}
    </section>
  );
}

// ── Role defaults ─────────────────────────────────────────────────────────────────────

function RoleDefaults({ roles, blended, onSaved }: { roles: RoleBudgetRow[]; blended: number; onSaved: () => void }) {
  return (
    <section aria-labelledby="roles-h">
      <h3 id="roles-h" className="text-sm font-semibold text-[var(--twilio-navy)] mb-1">Default allowance by role</h3>
      <p className="text-xs text-gray-500 mb-2">Applies to everyone in the role who doesn't have their own amount. Blank means no limit has been set.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="px-3 py-2">Role</th><th className="px-3 py-2">Warn at (per day)</th><th className="px-3 py-2">Block at (per day)</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>{roles.map((r) => <RoleRow key={r.role} row={r} blended={blended} onSaved={onSaved} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function RoleRow({ row, blended, onSaved }: { row: RoleBudgetRow; blended: number; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setMsg(null);
    try {
      await tokenBudgetApi.setRole(row.role, toInput(draft));
      setDraft({});
      await onSaved();
    } catch (e) { setMsg(errorText(e)); }
  }
  return (
    <tr className="border-t border-gray-100" data-testid={`role-${row.role}`}>
      <td className="px-3 py-2 whitespace-nowrap">{row.label}</td>
      <td className="px-3 py-2"><LimitField label={`${row.label} warn`} value={row.warn} blendedUsdPerMillion={blended} onEdit={(e) => setDraft((d) => ({ ...d, warn: e }))} /></td>
      <td className="px-3 py-2"><LimitField label={`${row.label} block`} value={row.block} blendedUsdPerMillion={blended} onEdit={(e) => setDraft((d) => ({ ...d, block: e }))} /></td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button type="button" onClick={save} disabled={!dirty} aria-label={`Save ${row.label}`}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium disabled:opacity-40">Save</button>
        {msg && <span role="alert" className="ml-2 text-xs text-red-600">{msg}</span>}
      </td>
    </tr>
  );
}

// ── People ────────────────────────────────────────────────────────────────────────────

const STATE_STYLE: Record<string, string> = {
  ok: "bg-green-50 text-green-700", warn: "bg-amber-100 text-amber-800", blocked: "bg-red-100 text-red-800",
};

function People({ users, blended, onSaved }: { users: UserBudgetRow[]; blended: number; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = users.filter((u) => !q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  return (
    <section aria-labelledby="people-h">
      <h3 id="people-h" className="text-sm font-semibold text-[var(--twilio-navy)] mb-1">People</h3>
      <p className="text-xs text-gray-500 mb-2">
        Usage today (each person's own day). Set an amount to override the role default, or <em>Restrict</em> to make the warn limit a block.
      </p>
      <input className="mb-2 w-64 rounded border border-gray-300 px-2 py-1 text-sm" placeholder="Filter people…" value={query}
        onChange={(e) => setQuery(e.target.value)} aria-label="Filter people" />
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Person</th><th className="px-3 py-2">Used today</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Warn at</th><th className="px-3 py-2">Block at</th>
              <th className="px-3 py-2">Last 14 days</th><th className="px-3 py-2">Restrict</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-gray-500 italic">No one matches.</td></tr>}
            {shown.map((u) => <PersonRow key={u.user_id} u={u} blended={blended} onSaved={onSaved} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PersonRow({ u, blended, onSaved }: { u: UserBudgetRow; blended: number; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = Object.keys(draft).length > 0;
  const consistent = u.days_at_limit_14 >= CONSISTENT_DAYS;

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); setDraft({}); await onSaved(); } catch (e) { setMsg(errorText(e)); }
  }
  const src = (s: string) => (s === "user" ? "custom" : s === "role" ? "role default" : "not set");

  return (
    <tr className="border-t border-gray-100 align-top" data-testid={`person-${u.username}`}>
      <td className="px-3 py-2">
        <div className="font-medium text-[var(--twilio-navy)]">{u.display_name}</div>
        <div className="text-xs text-gray-500">{u.role}</div>
      </td>
      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
        {fmtTokens(u.used_tokens)}<div className="text-xs text-gray-500">{fmtUsd(u.used_usd)}</div>
      </td>
      <td className="px-3 py-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATE_STYLE[u.state]}`}>{stateLabel(u.state)}</span>
      </td>
      <td className="px-3 py-2">
        <LimitField label={`${u.username} warn`} value={u.warn} blendedUsdPerMillion={blended} onEdit={(e) => setDraft((d) => ({ ...d, warn: e }))} />
        <div className="text-[10px] text-gray-400 mt-0.5">{src(u.warn_source)}</div>
      </td>
      <td className="px-3 py-2">
        <LimitField label={`${u.username} block`} value={u.block} blendedUsdPerMillion={blended} onEdit={(e) => setDraft((d) => ({ ...d, block: e }))} />
        <div className="text-[10px] text-gray-400 mt-0.5">{src(u.block_source)}</div>
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {u.days_at_limit_14} day{u.days_at_limit_14 === 1 ? "" : "s"} at a limit
        {u.days_blocked_14 > 0 && <div className="text-red-700">{u.days_blocked_14} blocked</div>}
        {consistent && !u.block_at_warn && (
          <div className="mt-0.5 rounded bg-amber-50 px-1 text-amber-800" data-testid={`consistent-${u.username}`}>Keeps hitting it</div>
        )}
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={u.block_at_warn} aria-label={`Restrict ${u.display_name}`}
            onChange={(e) => run(() => tokenBudgetApi.setUser(u.user_id, { block_at_warn: e.target.checked }))} />
          Block at warn
        </label>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button type="button" onClick={() => run(() => tokenBudgetApi.setUser(u.user_id, toInput(draft)))} disabled={!dirty}
          aria-label={`Save ${u.display_name}`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium disabled:opacity-40">Save</button>
        {u.has_override && (
          <button type="button" onClick={() => run(() => tokenBudgetApi.clearUser(u.user_id))} aria-label={`Reset ${u.display_name} to role default`}
            className="ml-1 rounded-md px-2 py-1 text-xs text-indigo-600 hover:underline">Reset</button>
        )}
        {msg && <div role="alert" className="text-xs text-red-600 mt-1">{msg}</div>}
      </td>
    </tr>
  );
}
