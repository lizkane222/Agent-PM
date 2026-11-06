import { useMyTokenBudget } from "../hooks/useMyTokenBudget";
import { fmtTokens } from "../lib/tokenBudget";

/**
 * A thin bar in the app shell when the user is over their daily warn limit or blocked.
 * Renders nothing in the normal case — including when no limit has been set for them.
 */
export default function BudgetBanner() {
  const { budget } = useMyTokenBudget();
  if (!budget || budget.state === "ok") return null;

  const blocked = budget.state === "blocked";
  const limit = blocked && budget.reason === "block_limit" ? budget.block : budget.warn;
  return (
    <div
      role="status"
      data-testid="budget-banner"
      className={`px-4 py-1.5 text-xs font-medium ${
        blocked ? "bg-red-50 text-red-800 border-b border-red-200" : "bg-amber-50 text-amber-900 border-b border-amber-200"
      }`}
    >
      {blocked
        ? `The agent is paused for you until tomorrow: you've used ${fmtTokens(budget.used)} of your ${fmtTokens(limit ?? 0)} daily tokens. Ask an admin if you need more today.`
        : `You've used ${fmtTokens(budget.used)} tokens today, past your ${fmtTokens(budget.warn ?? 0)} daily warning level. Admins have been notified.`}
    </div>
  );
}
