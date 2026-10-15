import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockUserProfile } from "../../test/handlers/team";

let mockProfile: Record<string, unknown> | null = { ...mockUserProfile, is_staff: true, access_level: "admin" };
vi.mock("../../context/CurrentUserContext", () => ({ useCurrentUser: () => mockProfile }));

const page = <T,>(results: T[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });

async function renderPage() {
  const { default: AdminDataPage } = await import("../AdminDataPage");
  render(<MemoryRouter><AdminDataPage /></MemoryRouter>);
}

describe("AdminDataPage", () => {
  it("is blocked for non-admins", async () => {
    mockProfile = { ...mockUserProfile, is_staff: true, access_level: "pm" };
    await renderPage();
    expect(screen.getByText(/only visible to Admins/)).toBeInTheDocument();
    mockProfile = { ...mockUserProfile, is_staff: true, access_level: "admin" };
  });

  it("requests every row (scope=all) and shows memberships with names", async () => {
    let scope: string | null = null;
    server.use(
      http.get("/api/v1/team/tags/", () => page([])),
      http.get("/api/v1/team/memberships/", ({ request }) => {
        scope = new URL(request.url).searchParams.get("scope");
        return page([{ id: 3, user: 7, user_email: "ana@x.com", user_display_name: "Ana Diaz", team: 2, team_name: "Remote", role: "member", created_at: "2026-10-01T00:00:00Z" }]);
      }),
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Memberships" }));
    expect(await screen.findByText(/Ana Diaz/)).toBeInTheDocument();
    expect(screen.getByText(/Remote/)).toBeInTheDocument();
    expect(scope).toBe("all");
  });

  it("shows voice sessions that have no linked user", async () => {
    let scope: string | null = null;
    server.use(
      http.get("/api/v1/team/tags/", () => page([])),
      http.get("/api/v1/realtime/voice-sessions/", ({ request }) => {
        scope = new URL(request.url).searchParams.get("scope");
        return page([{ id: 1, call_sid: "CA123", from_number: "+1555", to_number: "+1666", status: "completed", duration_seconds: 42, started_at: "2026-10-01T00:00:00Z" }]);
      }),
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Voice Sessions" }));
    expect(await screen.findByText("CA123")).toBeInTheDocument();
    expect(scope).toBe("all");
  });

  it("skill invocations use the real field names", async () => {
    server.use(
      http.get("/api/v1/team/tags/", () => page([])),
      http.get("/api/v1/skills/invocations/", () => page([{ id: 5, skill: 1, skill_name: "summarize", invoked_by: 2, invoked_by_username: "lkane", arguments: {}, result: {}, status: "success", error: "", duration_ms: 120, invoked_at: "2026-10-02T10:00:00Z" }])),
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Skill Invocations" }));
    expect(await screen.findByText("lkane")).toBeInTheDocument();
    expect(screen.getByText("120 ms")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("explains an empty table instead of looking broken", async () => {
    server.use(http.get("/api/v1/team/tags/", () => page([])));
    await renderPage();
    await waitFor(() => expect(screen.getByText(/No rows yet/)).toBeInTheDocument());
  });

  it("links back to Settings", async () => {
    server.use(http.get("/api/v1/team/tags/", () => page([])));
    await renderPage();
    expect(screen.getByRole("link", { name: /Settings/ })).toHaveAttribute("href", "/settings");
  });
});
