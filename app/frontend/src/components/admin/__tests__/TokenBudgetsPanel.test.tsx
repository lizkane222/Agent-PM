import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockBudgetOverview, mockBudgetUser } from "../../../test/handlers/agents";
import TokenBudgetsPanel from "../TokenBudgetsPanel";

const BASE = "/api/v1/agents/token-budgets/";
const serve = (o: ReturnType<typeof mockBudgetOverview>) => server.use(http.get(BASE, () => HttpResponse.json(o)));

function withRoles(patch: Record<string, { warn?: number | null; block?: number | null }>) {
  const o = mockBudgetOverview();
  o.roles = o.roles.map((r) => {
    const p = patch[r.role];
    if (!p) return r;
    const lv = (t: number | null | undefined) => ({ tokens: t ?? null, usd: t == null ? null : (t * 5.4 / 1e6).toFixed(4) });
    return { ...r, warn: lv(p.warn), block: lv(p.block) };
  });
  return o;
}

describe("TokenBudgetsPanel — overview", () => {
  it("lists every role and explains daily warn/block/restrict", async () => {
    render(<TokenBudgetsPanel />);
    expect(await screen.findByText("Solutions Architect")).toBeInTheDocument();
    for (const label of ["Product Manager", "Customer Success Manager", "Engineer", "Other / no recognised title"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/daily/i, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/A turn already running is never cut off/)).toBeInTheDocument();
  });

  it("tells the admin plainly that nobody is limited until they set numbers", async () => {
    render(<TokenBudgetsPanel />);
    expect(await screen.findByRole("note")).toHaveTextContent("nobody is limited");
  });

  it("drops that notice once any role has a limit", async () => {
    serve(withRoles({ SA: { warn: 20000, block: 100000 } }));
    render(<TokenBudgetsPanel />);
    await screen.findByText("Solutions Architect");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows an access message on 403 and a generic one on other failures", async () => {
    server.use(http.get(BASE, () => HttpResponse.json({}, { status: 403 })));
    const { unmount } = render(<TokenBudgetsPanel />);
    expect(await screen.findByText(/don't have access/)).toBeInTheDocument();
    unmount();
    server.use(http.get(BASE, () => HttpResponse.json({}, { status: 500 })));
    render(<TokenBudgetsPanel />);
    expect(await screen.findByText("Failed to load.")).toBeInTheDocument();
  });
});

describe("TokenBudgetsPanel — the token ↔ dollar rate", () => {
  it("shows the blended rate and how it is defined", async () => {
    render(<TokenBudgetsPanel />);
    expect(await screen.findByTestId("blended-rate")).toHaveTextContent("$5.40");
    expect(screen.getByText(/Blended = input × \(1 − output share\)/)).toBeInTheDocument();
  });

  it("recomputes the blend live as prices are typed, and only enables Save when changed", async () => {
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("blended-rate");
    const save = screen.getByRole("button", { name: "Save rate" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Input price per million"), { target: { value: "10" } });
    expect(screen.getByTestId("blended-rate")).toHaveTextContent("$11.00");   // 10*0.8 + 15*0.2
    expect(save).toBeEnabled();
  });

  it("the quick converter turns tokens into dollars at the blended rate", async () => {
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("converter");
    fireEvent.change(screen.getByLabelText("Tokens to convert"), { target: { value: "1000000" } });
    expect(screen.getByTestId("converter")).toHaveTextContent("$5.40");
  });

  it("saves the rate with the output share as a fraction", async () => {
    let body: Record<string, unknown> = {};
    server.use(http.put(`${BASE}pricing/`, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json(mockBudgetOverview().pricing);
    }));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("blended-rate");
    fireEvent.change(screen.getByLabelText("Output share percent"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(body.output_share).toBe(0.5));
    expect(body).toMatchObject({ input_usd_per_million: "3.0000", output_usd_per_million: "15.0000" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("shows the server's message when a rate is refused", async () => {
    server.use(http.put(`${BASE}pricing/`, () => HttpResponse.json({ detail: "The blended price must be above zero." }, { status: 400 })));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("blended-rate");
    fireEvent.change(screen.getByLabelText("Input price per million"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    expect(await screen.findByRole("status")).toHaveTextContent("must be above zero");
  });
});

describe("TokenBudgetsPanel — role defaults", () => {
  const row = () => screen.getByTestId("role-SA");

  it("typing tokens shows the dollars, and typing dollars shows the tokens", async () => {
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("role-SA");
    const warnT = within(row()).getByLabelText("Solutions Architect warn tokens");
    const warnD = within(row()).getByLabelText("Solutions Architect warn dollars");
    fireEvent.change(warnT, { target: { value: "20000" } });
    expect(warnD).toHaveValue("0.108");
    fireEvent.change(warnD, { target: { value: "0.54" } });
    expect(warnT).toHaveValue("100000");
  });

  it("saves in the unit the admin typed, and only the limit they touched", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(http.put(`${BASE}roles/SA/`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({});
    }));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("role-SA");
    fireEvent.change(within(row()).getByLabelText("Solutions Architect warn tokens"), { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Solutions Architect" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ warn_tokens: 20000 });

    fireEvent.change(within(row()).getByLabelText("Solutions Architect block dollars"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Solutions Architect" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ block_usd: "5" });
  });

  it("sends null to clear a limit", async () => {
    let body: unknown;
    serve(withRoles({ SA: { warn: 20000, block: 100000 } }));
    server.use(http.put(`${BASE}roles/SA/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("role-SA");
    fireEvent.change(within(row()).getByLabelText("Solutions Architect warn tokens"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Solutions Architect" }));
    await waitFor(() => expect(body).toEqual({ warn_tokens: null }));
  });

  it("Save is disabled until something is edited", async () => {
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("role-SA");
    expect(screen.getByRole("button", { name: "Save Solutions Architect" })).toBeDisabled();
  });

  it("shows the server's reason when a limit is refused (warn above block)", async () => {
    server.use(http.put(`${BASE}roles/SA/`, () =>
      HttpResponse.json({ detail: "The warn limit can't be higher than the block limit." }, { status: 400 })));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("role-SA");
    fireEvent.change(within(row()).getByLabelText("Solutions Architect warn tokens"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Solutions Architect" }));
    expect(await within(row()).findByRole("alert")).toHaveTextContent("can't be higher than the block limit");
  });

  it("reloads after a save so the dollar value comes from the server", async () => {
    let loads = 0;
    server.use(
      http.get(BASE, () => { loads++; return HttpResponse.json(mockBudgetOverview()); }),
      http.put(`${BASE}roles/SA/`, () => HttpResponse.json({})),
    );
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("role-SA");
    fireEvent.change(within(row()).getByLabelText("Solutions Architect warn tokens"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Solutions Architect" }));
    await waitFor(() => expect(loads).toBe(2));
  });
});

describe("TokenBudgetsPanel — people", () => {
  const people = () => mockBudgetOverview({
    users: [
      mockBudgetUser({ user_id: 1, username: "alice", display_name: "Alice Adams", role: "SA", state: "ok",
        used_tokens: 1500, used_usd: "0.0200",
        warn: { tokens: 20000, usd: "0.1080" }, warn_source: "role", block: { tokens: 100000, usd: "0.5400" }, block_source: "role" }),
      mockBudgetUser({ user_id: 2, username: "bob", display_name: "Bob Brown", role: "CSM", state: "warn",
        used_tokens: 25000, used_usd: "0.3000", warn: { tokens: 20000, usd: "0.1080" }, warn_source: "user",
        has_override: true, days_at_limit_14: 5, days_blocked_14: 1 }),
      mockBudgetUser({ user_id: 3, username: "cy", display_name: "Cy Chen", role: "PM", state: "blocked",
        days_at_limit_14: 6, block_at_warn: true, has_override: true }),
    ],
  });

  it("shows usage in tokens and dollars, status, and where each limit comes from", async () => {
    serve(people());
    render(<TokenBudgetsPanel />);
    const alice = await screen.findByTestId("person-alice");
    expect(alice).toHaveTextContent("1,500");
    expect(alice).toHaveTextContent("$0.0200");
    expect(alice).toHaveTextContent("OK");
    expect(alice).toHaveTextContent("role default");
    expect(screen.getByTestId("person-bob")).toHaveTextContent("Over warn limit");
    expect(screen.getByTestId("person-bob")).toHaveTextContent("custom");
    expect(screen.getByTestId("person-cy")).toHaveTextContent("Blocked");
  });

  it("flags someone who keeps hitting their limit — unless they're already restricted", async () => {
    serve(people());
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("person-bob");
    expect(screen.getByTestId("consistent-bob")).toHaveTextContent("Keeps hitting it");
    expect(screen.getByTestId("person-bob")).toHaveTextContent("1 blocked");
    expect(screen.queryByTestId("consistent-alice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("consistent-cy")).not.toBeInTheDocument();
  });

  it("the Restrict checkbox turns the warn limit into a block, via the server", async () => {
    let body: unknown;
    serve(people());
    server.use(http.put(`${BASE}users/2/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("person-bob");
    expect(screen.getByLabelText("Restrict Cy Chen")).toBeChecked();
    expect(screen.getByLabelText("Restrict Bob Brown")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Restrict Bob Brown"));
    await waitFor(() => expect(body).toEqual({ block_at_warn: true }));
  });

  it("sets a personal amount, and offers Reset only to people who have one", async () => {
    let body: unknown;
    serve(people());
    server.use(http.put(`${BASE}users/1/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("person-alice");
    expect(screen.queryByRole("button", { name: "Reset Alice Adams to role default" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset Bob Brown to role default" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("alice warn dollars"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Alice Adams" }));
    await waitFor(() => expect(body).toEqual({ warn_usd: "1" }));
  });

  it("Reset removes the override", async () => {
    let called = false;
    serve(people());
    server.use(http.delete(`${BASE}users/2/`, () => { called = true; return new HttpResponse(null, { status: 204 }); }));
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("person-bob");
    fireEvent.click(screen.getByRole("button", { name: "Reset Bob Brown to role default" }));
    await waitFor(() => expect(called).toBe(true));
  });

  it("filters the list", async () => {
    serve(people());
    render(<TokenBudgetsPanel />);
    await screen.findByTestId("person-alice");
    fireEvent.change(screen.getByLabelText("Filter people"), { target: { value: "cy" } });
    expect(screen.queryByTestId("person-alice")).not.toBeInTheDocument();
    expect(screen.getByTestId("person-cy")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter people"), { target: { value: "zzz" } });
    expect(screen.getByText("No one matches.")).toBeInTheDocument();
  });
});
