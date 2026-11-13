import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../../test/msw-server";
import { mockTeamMembers } from "../../../test/handlers/team";
import TeamMemberTimezone, { timezoneTooltip } from "../TeamMemberTimezone";

const base = mockTeamMembers[1];

describe("TeamMemberTimezone", () => {
  it("shows local time with an 'assigned by' tooltip and the override note", () => {
    const m = { ...base, timezone: "Europe/Paris", timezone_source: "assigned" as const, assigned_by_username: "liz" };
    render(<TeamMemberTimezone member={m} onUpdated={() => {}} />);
    expect(screen.getByTestId("contact-local-time")).toBeInTheDocument();
    expect(timezoneTooltip(m)).toMatch(/assigned by liz/);
    expect(timezoneTooltip(m)).toMatch(/own setting will override/);
  });

  it("a self-set zone offers no edit control", () => {
    render(<TeamMemberTimezone member={{ ...base, timezone: "America/Chicago", timezone_source: "self" }} onUpdated={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("with no zone, 'Set time zone' assigns one through the endpoint", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/v1/team/members/:id/assign-timezone/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...base, timezone: "Asia/Tokyo", timezone_source: "assigned", assigned_by_username: "tester" });
      }),
    );
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<TeamMemberTimezone member={{ ...base, timezone: "", timezone_source: "" }} onUpdated={onUpdated} />);
    await user.click(screen.getByRole("button", { name: "Set time zone" }));
    await user.type(screen.getByRole("combobox"), "Asia/Tokyo");
    await user.click(await screen.findByRole("button", { name: /Asia\/Tokyo/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(body).toEqual({ timezone: "Asia/Tokyo" });
  });

  it("shows the server's refusal when the zone is already set", async () => {
    server.use(
      http.post("/api/v1/team/members/:id/assign-timezone/", () =>
        HttpResponse.json({ detail: "A time zone is already set for this person." }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render(<TeamMemberTimezone member={{ ...base, timezone: "", timezone_source: "" }} onUpdated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Set time zone" }));
    await user.type(screen.getByRole("combobox"), "Asia/Tokyo");
    await user.click(await screen.findByRole("button", { name: /Asia\/Tokyo/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already set/);
  });
});

describe("TeamMemberTimezone popover layering", () => {
  it("is portalled to document.body above the nav, and closes on Escape / outside click", async () => {
    const { Z } = await import("../../../lib/zLayers");
    const user = userEvent.setup();
    const { container } = render(<TeamMemberTimezone member={{ ...base, timezone: "", timezone_source: "" }} onUpdated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Set time zone" }));
    const pop = screen.getByRole("dialog");
    expect(pop.parentElement).toBe(document.body);
    expect(container.contains(pop)).toBe(false);
    expect(pop.style.zIndex).toBe(String(Z.popover));
    expect(Z.popover).toBeGreaterThan(Z.nav);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Set time zone" }));
    await user.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
