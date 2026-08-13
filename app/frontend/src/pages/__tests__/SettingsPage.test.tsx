import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockUserProfile } from "../../test/handlers/team";

// ── Mock cross-cutting context ────────────────────────────────────────────────

vi.mock("../../context/NotificationDefaultsContext", () => ({
  useNotificationDefaults: () => ({
    defaults: {
      notify_default_in_app: true,
      notify_default_slack: false,
      notify_default_push: false,
      notify_default_sms: false,
    },
    setDefaults: vi.fn(),
  }),
}));

// ── Mock auth module ───────────────────────────────────────────────────────────
// Stub all exports used by lib/api.ts's request interceptor so API calls work.

vi.mock("../../lib/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  isTokenExpired: vi.fn(() => false),
  refreshAccessToken: vi.fn(() => Promise.resolve("")),
  clearTokens: vi.fn(),
}));

import { logout } from "../../lib/auth";
const mockLogout = vi.mocked(logout);

// ── Mock SVG imports ──────────────────────────────────────────────────────────

vi.mock("../../assets/icons/Settings.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/google-calendar.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/gmail.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/google-drive.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/google-docs.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/google-sheets.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/google-slides.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/zoom.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/LucidChart.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/github.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/notion.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/microsoft-teams.svg?react", () => ({ default: () => null }));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: SettingsPage } = await import("../SettingsPage");
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure window.location.href is an absolute URL before each test so that
    // axios's isURLSameOrigin helper (which calls new URL()) doesn't throw.
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost/" },
      writable: true,
      configurable: true,
    });
  });

  it("shows loading state while data is fetching", async () => {
    server.use(
      http.get("/api/v1/integrations/status/", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ connected: [], sync_states: [] });
      })
    );
    await renderPage();
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
  });

  it("renders sign-out button after data loads", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
    );
  });

  it("shows profile display name after loading", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByDisplayValue(mockUserProfile.display_name)).toBeInTheDocument()
    );
  });

  it("shows org data sources section with token-not-configured status", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/organization data sources/i)).toBeInTheDocument()
    );
    expect(screen.getAllByText(/token not configured/i).length).toBeGreaterThan(0);
  });

  it("shows active status for org source when token is configured", async () => {
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get("/api/v1/integrations/scraper-status/", () =>
        HttpResponse.json({ confluence: true, jira: true, zendesk: false, gong: false, notion: false })
      )
    );
    await renderPage();
    await waitFor(() => expect(screen.getAllByText(/^Active$/i).length).toBeGreaterThanOrEqual(2));
  });

  it("clicking sign out calls logout() and navigates to /oidc/logout/", async () => {
    const locationMock = { href: "/" };
    Object.defineProperty(window, "location", { value: locationMock, writable: true });

    await renderPage();
    const btn = await screen.findByRole("button", { name: /sign out/i });
    fireEvent.click(btn);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(locationMock.href).toBe("/oidc/logout/"));
  });

  it("shows Register Gmail watch button when Gmail is connected", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /register gmail watch/i })).toBeInTheDocument()
    );
  });

  it("clicking Register Gmail watch button calls the API and shows success feedback", async () => {
    await renderPage();
    const btn = await screen.findByRole("button", { name: /register gmail watch/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/watch registered/i)).toBeInTheDocument()
    );
  });
});
