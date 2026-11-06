import { describe, it, expect } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockMyBudget } from "../../test/handlers/agents";
import BudgetBanner from "../BudgetBanner";

const serve = (b: ReturnType<typeof mockMyBudget>) =>
  server.use(http.get("/api/v1/agents/token-budgets/me/", () => HttpResponse.json(b)));

describe("BudgetBanner", () => {
  it("shows nothing for a user within their limits", async () => {
    serve(mockMyBudget({ state: "ok", used: 10, warn: 1000, block: 5000 }));
    render(<BudgetBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("budget-banner")).not.toBeInTheDocument();
  });

  it("shows nothing when no limit has been set for them", async () => {
    render(<BudgetBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("budget-banner")).not.toBeInTheDocument();
  });

  it("warns, without pausing anything, past the warn limit", async () => {
    serve(mockMyBudget({ state: "warn", used: 1200, warn: 1000, block: 5000 }));
    render(<BudgetBanner />);
    const bar = await screen.findByTestId("budget-banner");
    expect(bar).toHaveTextContent("1,200 tokens today");
    expect(bar).toHaveTextContent("1,000 daily warning");
    expect(bar).toHaveTextContent("Admins have been notified");
    expect(bar).not.toHaveTextContent("paused");
  });

  it("says the agent is paused, with the block limit, when blocked", async () => {
    serve(mockMyBudget({ state: "blocked", reason: "block_limit", used: 5200, warn: 1000, block: 5000 }));
    render(<BudgetBanner />);
    const bar = await screen.findByTestId("budget-banner");
    expect(bar).toHaveTextContent("paused for you until tomorrow");
    expect(bar).toHaveTextContent("5,200 of your 5,000");
  });

  it("when blocked by a restricted warn limit it quotes the warn limit", async () => {
    serve(mockMyBudget({ state: "blocked", reason: "warn_limit_restricted", used: 1200, warn: 1000, block: 5000, block_at_warn: true }));
    render(<BudgetBanner />);
    expect(await screen.findByTestId("budget-banner")).toHaveTextContent("1,200 of your 1,000");
  });

  it("re-reads after a chat turn finishes, so the warning appears on the turn that crosses the line", async () => {
    let state: ReturnType<typeof mockMyBudget> = mockMyBudget({ state: "ok", used: 900, warn: 1000, block: 5000 });
    let hits = 0;
    server.use(http.get("/api/v1/agents/token-budgets/me/", () => { hits++; return HttpResponse.json(state); }));
    render(<BudgetBanner />);
    await waitFor(() => expect(hits).toBe(1));
    expect(screen.queryByTestId("budget-banner")).not.toBeInTheDocument();
    state = mockMyBudget({ state: "warn", used: 1100, warn: 1000, block: 5000 });
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: "agentSessionUpdated" })); });
    expect(await screen.findByTestId("budget-banner")).toBeInTheDocument();
    expect(hits).toBe(2);
  });

  it("ignores unrelated storage events", async () => {
    let hits = 0;
    server.use(http.get("/api/v1/agents/token-budgets/me/", () => { hits++; return HttpResponse.json(mockMyBudget()); }));
    render(<BudgetBanner />);
    await waitFor(() => expect(hits).toBe(1));
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: "somethingElse" })); });
    expect(hits).toBe(1);
  });

  it("renders nothing, quietly, if the request fails", async () => {
    server.use(http.get("/api/v1/agents/token-budgets/me/", () => HttpResponse.json({}, { status: 500 })));
    render(<BudgetBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("budget-banner")).not.toBeInTheDocument();
  });
});
