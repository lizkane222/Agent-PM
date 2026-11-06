import type { BudgetState } from "../types/tokenBudget";

/**
 * If a failed chat send was the daily-token-limit refusal, the sentence to show; otherwise null.
 *
 * Deliberately recognises only that one refusal (HTTP 403 with code `token_budget_blocked`), so
 * every other failure keeps its existing handling at the four streaming-fetch call sites.
 */
export function budgetBlockedMessage(status: number, bodyText: string): string | null {
  if (status !== 403) return null;
  try {
    const j = JSON.parse(bodyText) as { code?: string; detail?: string };
    return j.code === "token_budget_blocked" && typeof j.detail === "string" ? j.detail : null;
  } catch {
    return null;
  }
}

export const fmtTokens = (n: number): string => n.toLocaleString("en-US");

/** USD for display. Small budgets need cents; large ones don't need four decimals. */
export function fmtUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export function stateLabel(state: BudgetState): string {
  return state === "blocked" ? "Blocked" : state === "warn" ? "Over warn limit" : "OK";
}
