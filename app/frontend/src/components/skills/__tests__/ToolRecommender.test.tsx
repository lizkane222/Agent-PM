import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ToolRecommender from "../ToolRecommender";

const URL = "/api/v1/skills/agent-skills/recommend-tools/";
const reply = (tools: { name: string; reason: string }[], limitations: string[] = []) =>
  server.use(http.post(URL, () => HttpResponse.json({ tools, limitations })));

function setup(props: Partial<React.ComponentProps<typeof ToolRecommender>> = {}) {
  const onApply = vi.fn();
  render(<ToolRecommender description="Summarise my accounts weekly" selected={[]} onApply={onApply} {...props} />);
  return { onApply };
}

describe("ToolRecommender", () => {
  it("is disabled until there is a description to read", () => {
    setup({ description: "   " });
    const btn = screen.getByRole("button", { name: "Recommend tools with Claude" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Write a description first");
  });

  it("sends the description and draft instructions", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.post(URL, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ tools: [], limitations: [] }); }));
    setup({ instructions: "1. look up accounts" });
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    await waitFor(() => expect(body).toEqual({ description: "Summarise my accounts weekly", instructions: "1. look up accounts" }));
  });

  it("lists suggestions with reasons, all pre-checked, and adds only what stays checked", async () => {
    reply([{ name: "search_records", reason: "find accounts by name" }, { name: "list_artifacts", reason: "read their files" }]);
    const { onApply } = setup({ selected: ["create_reminder"] });
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByText("find accounts by name")).toBeInTheDocument();
    expect(screen.getByLabelText("Recommended: search_records")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Recommended: list_artifacts"));       // uncheck one
    fireEvent.click(screen.getByRole("button", { name: "Add 1 tool" }));
    expect(onApply).toHaveBeenCalledWith(["create_reminder", "search_records"]);   // keeps what was already chosen
  });

  it("does not re-add tools already selected, and says so", async () => {
    reply([{ name: "search_records", reason: "find accounts" }]);
    setup({ selected: ["search_records"] });
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByText("already selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Recommended: search_records")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  });

  it("shows what Claude says skills can't do", async () => {
    reply([{ name: "search_records", reason: "r" }], ["Sending texts isn't available to skills"]);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByRole("note")).toHaveTextContent("Sending texts isn't available to skills");
  });

  it("handles 'no tools needed' without offering to add anything", async () => {
    reply([]);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByText(/didn't find any tools/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
  });

  it("Add is disabled once everything is unchecked", async () => {
    reply([{ name: "search_records", reason: "r" }]);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    fireEvent.click(await screen.findByLabelText("Recommended: search_records"));
    expect(screen.getByRole("button", { name: "Add 0 tools" })).toBeDisabled();
  });

  it("Dismiss closes the suggestions without applying anything", async () => {
    reply([{ name: "search_records", reason: "r" }]);
    const { onApply } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    await screen.findByLabelText("Recommended: search_records");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByLabelText("Recommended: search_records")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows the server's message on failure and applies nothing", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ detail: "Couldn't get recommendations right now." }, { status: 502 })));
    const { onApply } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't get recommendations right now.");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("a second request replaces the first result", async () => {
    reply([{ name: "search_records", reason: "first" }]);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    await screen.findByText("first");
    reply([{ name: "list_artifacts", reason: "second" }]);
    fireEvent.click(screen.getByRole("button", { name: "Recommend tools with Claude" }));
    expect(await screen.findByText("second")).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });
});
