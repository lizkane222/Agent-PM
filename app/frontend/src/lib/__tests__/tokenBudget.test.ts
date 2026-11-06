import { describe, it, expect } from "vitest";
import { budgetBlockedMessage, fmtTokens, fmtUsd, stateLabel } from "../tokenBudget";

describe("budgetBlockedMessage", () => {
  const body = JSON.stringify({ code: "token_budget_blocked", detail: "You've reached your daily token limit." });

  it("returns the sentence for the budget refusal only", () => {
    expect(budgetBlockedMessage(403, body)).toBe("You've reached your daily token limit.");
  });

  it("leaves every other failure alone so existing handling is unchanged", () => {
    expect(budgetBlockedMessage(500, body)).toBeNull();
    expect(budgetBlockedMessage(403, JSON.stringify({ detail: "Not allowed." }))).toBeNull();
    expect(budgetBlockedMessage(403, "<html>nginx</html>")).toBeNull();
    expect(budgetBlockedMessage(403, JSON.stringify({ code: "token_budget_blocked", detail: 5 }))).toBeNull();
    expect(budgetBlockedMessage(403, "")).toBeNull();
  });
});

describe("formatting", () => {
  it("groups token counts", () => expect(fmtTokens(1234567)).toBe("1,234,567"));

  it("shows small dollar amounts with enough precision to be meaningful", () => {
    expect(fmtUsd("0.1080")).toBe("$0.1080");
    expect(fmtUsd("5.4")).toBe("$5.40");
    expect(fmtUsd("1234.5")).toBe("$1235");
  });

  it("shows a dash for nothing", () => {
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(undefined)).toBe("—");
    expect(fmtUsd("")).toBe("—");
    expect(fmtUsd("abc")).toBe("—");
  });

  it("labels states", () => {
    expect(stateLabel("ok")).toBe("OK");
    expect(stateLabel("warn")).toBe("Over warn limit");
    expect(stateLabel("blocked")).toBe("Blocked");
  });
});
