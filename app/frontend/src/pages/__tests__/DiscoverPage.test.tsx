import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockApplets } from "../../test/handlers/discover";

// ── Mock cross-cutting deps ──────────────────────────────────────────────────

vi.mock("../../context/CurrentUserContext", () => ({
  // Return a user whose username matches mockApplets[0].submitted_by_username so canDelete=true
  useCurrentUser: () => ({
    id: 1,
    username: "alice",
    email: "alice@example.com",
    is_staff: false,
    display_name: "Alice Smith",
    avatar_url: "",
    title: "",
    role: "member",
    phone_number: "",
    timezone: "UTC",
    slack_user_id: "",
    google_account_email: "",
    airtable_collaborator_id: "",
    notification_email: true,
    notification_slack: false,
    notify_default_in_app: true,
    notify_default_slack: false,
    notify_default_push: false,
    notify_default_sms: false,
    push_subscription_active: false,
    staff_view_override: false,
  }),
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../assets/icons/Innovation.svg?react", () => ({ default: () => null }));

// team/members called by useTeam inside DiscoverPage
server.use(
  http.get("/api/v1/team/members/", () =>
    HttpResponse.json({ results: [], count: 0 })
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: DiscoverPage } = await import("../DiscoverPage");
  render(
    <MemoryRouter>
      <DiscoverPage />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DiscoverPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders applet names when data is loaded", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(mockApplets[0].name)).toBeInTheDocument()
    );
    expect(screen.getByText(mockApplets[1].name)).toBeInTheDocument();
  });

  it("shows empty state when no applets returned", async () => {
    server.use(
      http.get("/api/v1/discover/applets/", () =>
        HttpResponse.json({ results: [], count: 0 })
      )
    );
    await renderPage();
    await waitFor(() =>
      expect(screen.queryByText(mockApplets[0].name)).not.toBeInTheDocument()
    );
    expect(screen.getByText(/No applets yet/i)).toBeInTheDocument();
  });

  it("clicking '+ Add Applet' shows the applet form", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));

    fireEvent.click(screen.getByText("New Applet"));

    await waitFor(() =>
      expect(screen.getByText(/Fill in the form/i)).toBeInTheDocument()
    );
  });

  it("delete button calls deleteApplet with correct id", async () => {
    const deletedIds: string[] = [];
    server.use(
      http.delete("/api/v1/discover/applets/:id/", ({ params }) => {
        deletedIds.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));

    const deleteButtons = screen.getAllByTitle("Delete applet");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(deletedIds).toContain(String(mockApplets[0].id)));
  });
});
