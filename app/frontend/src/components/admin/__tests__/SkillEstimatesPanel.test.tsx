import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockSkillEstimate } from "../../../test/handlers/agents";
import SkillEstimatesPanel from "../SkillEstimatesPanel";
import type { SkillEstimateRow, SkillTokenEstimate } from "../../../types/tokenBudget";

const URL = "/api/v1/skills/agent-skills/token-estimates/";
const run = (rounds: number, total: number) => ({ rounds, input: total - 400, output: 400, total });
const EST: SkillTokenEstimate = {
  low: run(2, 20_000), expected: run(3, 39_300), high: run(6, 90_000),
  params: { tool_result_tokens_per_round: 1500, output_tokens_per_round: 400 },
  facts: { base_round_input_tokens: 10_000, skill_prompt_tokens: 500, attachments: 2, templates: 0 },
  rationale: "Looks up records then summarises.", model: "claude-sonnet-4-6",
  assumptions: "~4 characters per token; prompt caching is not modelled.",
};
const done = (o: Partial<SkillEstimateRow> = {}) => mockSkillEstimate({
  name: "weekly-update", estimate: EST, stale: false, estimated_at: "2026-11-04T00:00:00Z",
  low_usd: "0.0900", expected_usd: "0.1800", high_usd: "0.4200", ...o,
});
const serve = (rows: SkillEstimateRow[]) => server.use(http.get(URL, () => HttpResponse.json({ results: rows })));

describe("SkillEstimatesPanel", () => {
  it("explains what is Claude's judgement and what is computed", async () => {
    render(<SkillEstimatesPanel />);
    expect(await screen.findByText(/Claude judges how many rounds/)).toBeInTheDocument();
    expect(screen.getByText(/doesn't model prompt caching/)).toBeInTheDocument();
  });

  it("says so when there are no skills", async () => {
    render(<SkillEstimatesPanel />);
    expect(await screen.findByText("No skills yet.")).toBeInTheDocument();
  });

  it("shows tokens, rounds, the light→heavy range and dollars for an estimated skill", async () => {
    serve([done()]);
    render(<SkillEstimatesPanel />);
    const row = await screen.findByTestId("estimate-weekly-update");
    expect(row).toHaveTextContent("39,300 tokens");
    expect(row).toHaveTextContent("3 model rounds");
    expect(row).toHaveTextContent("20,000 → 90,000");
    expect(row).toHaveTextContent("$0.1800");
    expect(row).toHaveTextContent("up to $0.4200");
    expect(row).toHaveTextContent("current");
  });

  it("marks never-estimated and outdated skills differently", async () => {
    serve([mockSkillEstimate({ id: 1, name: "fresh-skill" }), done({ id: 2, name: "old-skill", stale: true })]);
    render(<SkillEstimatesPanel />);
    expect(await screen.findByTestId("estimate-fresh-skill")).toHaveTextContent("not estimated");
    expect(screen.getByTestId("estimate-old-skill")).toHaveTextContent("outdated");
  });

  it("'How' reveals Claude's reasoning and the measured inputs behind the number", async () => {
    serve([done()]);
    render(<SkillEstimatesPanel />);
    await screen.findByTestId("estimate-weekly-update");
    expect(screen.queryByTestId("how-weekly-update")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How" }));
    const how = screen.getByTestId("how-weekly-update");
    expect(how).toHaveTextContent("Looks up records then summarises.");
    expect(how).toHaveTextContent("resends 10,000 tokens of system prompt and tool definitions");
    expect(how).toHaveTextContent("2 attachments");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByTestId("how-weekly-update")).not.toBeInTheDocument();
  });

  it("estimates one skill on demand and refreshes the table", async () => {
    let body: unknown;
    let estimated = false;
    server.use(
      http.get(URL, () => HttpResponse.json({ results: [estimated ? done({ id: 7, name: "weekly-update" }) : mockSkillEstimate({ id: 7, name: "weekly-update" })] })),
      http.post(URL, async ({ request }) => { body = await request.json(); estimated = true; return HttpResponse.json({ results: [], failed: [], remaining: 0 }); }),
    );
    render(<SkillEstimatesPanel />);
    await screen.findByText("not estimated");
    fireEvent.click(screen.getByRole("button", { name: "Estimate weekly-update" }));
    await waitFor(() => expect(body).toEqual({ skill_id: 7 }));
    expect(await screen.findByText("39,300 tokens", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-estimate weekly-update" })).toBeInTheDocument();
  });

  it("'Estimate all' keeps going in batches until nothing is left", async () => {
    serve([mockSkillEstimate({ id: 1, name: "a" }), mockSkillEstimate({ id: 2, name: "b" })]);
    let calls = 0;
    server.use(http.post(URL, () => {
      calls++;
      return HttpResponse.json({ results: [mockSkillEstimate()], failed: [], remaining: calls < 3 ? 5 : 0 });
    }));
    render(<SkillEstimatesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Estimate 2 missing or outdated/ }));
    await waitFor(() => expect(calls).toBe(3));
  });

  it("stops rather than looping forever when every estimate in a batch fails, and says which", async () => {
    serve([mockSkillEstimate({ id: 1, name: "broken" })]);
    let calls = 0;
    server.use(http.post(URL, () => { calls++; return HttpResponse.json({ results: [mockSkillEstimate()], failed: ["broken"], remaining: 4 }); }));
    render(<SkillEstimatesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Estimate 1 missing or outdated/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't estimate: broken.");
    expect(calls).toBe(1);
  });

  it("disables 'Estimate all' when everything is current", async () => {
    serve([done()]);
    render(<SkillEstimatesPanel />);
    const btn = await screen.findByRole("button", { name: "All estimates are current" });
    expect(btn).toBeDisabled();
  });

  it("shows the server's message if the estimate request itself fails", async () => {
    serve([mockSkillEstimate({ id: 1, name: "a" })]);
    server.use(http.post(URL, () => HttpResponse.json({ detail: "Only admins can view skill token estimates." }, { status: 403 })));
    render(<SkillEstimatesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Estimate a" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Only admins");
  });

  it("access and load errors", async () => {
    server.use(http.get(URL, () => HttpResponse.json({}, { status: 403 })));
    render(<SkillEstimatesPanel />);
    expect(await screen.findByText(/don't have access/)).toBeInTheDocument();
  });
});
