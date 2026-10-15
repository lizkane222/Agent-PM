import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockUserProfile } from "../../test/handlers/team";

// ── Mock cross-cutting context ────────────────────────────────────────────────

// Stateful so a checkbox change re-renders, like the real context (which also PATCHes).
vi.mock("../../context/NotificationDefaultsContext", async () => {
  const React = await import("react");
  const initial = {
    notify_default_in_app: true,
    notify_default_slack: false,
    notify_default_push: false,
    notify_default_sms: false,
  };
  return {
    useNotificationDefaults: () => {
      const [defaults, setState] = React.useState(initial);
      return { defaults, setDefaults: (patch: Partial<typeof initial>) => setState((d) => ({ ...d, ...patch })) };
    },
  };
});

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

  // ── Integrations not configured on this server ──────────────────────────────

  describe("not-yet-configured integrations", () => {
    function serveAvailability(myVote: string | null = null) {
      const votes: unknown[] = [];
      server.use(
        http.get("/api/v1/integrations/availability/", () =>
          HttpResponse.json({ providers: {
            google: { configured: true, my_vote: null, yes_votes: 0 },
            zoom: { configured: false, my_vote: myVote, yes_votes: 2 },
          } }),
        ),
        http.post("/api/v1/integrations/votes/", async ({ request }) => {
          votes.push(await request.json());
          return HttpResponse.json({ ok: true });
        }),
      );
      return votes;
    }

    function connectButtonFor(name: string) {
      const title = screen.getByText(name, { selector: "p" });
      return title.closest(".py-4")!.querySelector("button")! as HTMLButtonElement;
    }

    it("Connect opens the vote modal instead of navigating anywhere", async () => {
      serveAvailability();
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await renderPage();
      await waitFor(() => expect(screen.getByText("Zoom", { selector: "p" })).toBeInTheDocument());
      await waitFor(() => {
        fireEvent.click(connectButtonFor("Zoom"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      expect(screen.getByRole("dialog")).toHaveTextContent("This integration hasn't yet been configured");
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it("YES records the vote and closes the modal", async () => {
      const votes = serveAvailability();
      await renderPage();
      await waitFor(() => expect(screen.getByText("Zoom", { selector: "p" })).toBeInTheDocument());
      await waitFor(() => { fireEvent.click(connectButtonFor("Zoom")); expect(screen.getByRole("dialog")).toBeInTheDocument(); });
      fireEvent.click(screen.getByRole("button", { name: "YES" }));
      await waitFor(() => expect(votes).toEqual([{ provider: "zoom", vote: "yes" }]));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it('"Not now" records a not_now vote', async () => {
      const votes = serveAvailability("yes");
      await renderPage();
      await waitFor(() => expect(screen.getByText("Zoom", { selector: "p" })).toBeInTheDocument());
      await waitFor(() => { fireEvent.click(connectButtonFor("Zoom")); expect(screen.getByRole("dialog")).toBeInTheDocument(); });
      expect(screen.getByRole("dialog")).toHaveTextContent("You voted YES");
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      await waitFor(() => expect(votes).toEqual([{ provider: "zoom", vote: "not_now" }]));
    });
  });

  // ── Tokens ───────────────────────────────────────────────────────────────────

  it("shows only the masked hint for a configured org token", async () => {
    server.use(
      http.get("/api/v1/integrations/scraper-status/", () =>
        HttpResponse.json({ confluence: true, jira: true, zendesk: false, gong: false, notion: false,
          hints: { confluence: "••••••••9f3a", jira: "••••••••9f3a" } }),
      ),
    );
    await renderPage();
    expect(await screen.findByTestId("token-hint-confluence")).toHaveTextContent("••••••••9f3a");
  });

  // ── Phone ────────────────────────────────────────────────────────────────────

  it("saves the phone number in E.164 using the selected country code", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.patch("/api/v1/team/profiles/me/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...mockUserProfile, ...body });
      }),
    );
    await renderPage();
    const country = await screen.findByRole("combobox", { name: "Country code" });
    fireEvent.change(country, { target: { value: "GB" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), { target: { value: "07700 900123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    await waitFor(() => expect(body.phone_number).toBe("+447700900123"));
  });

  // ── Test notifications on Save ──────────────────────────────────────────────

  describe("test notifications on Save Profile", () => {
    function serveSaveAndTests() {
      const tested: string[][] = [];
      server.use(
        http.patch("/api/v1/team/profiles/me/", async ({ request }) =>
          HttpResponse.json({ ...mockUserProfile, ...((await request.json()) as object) })),
        http.post("/api/v1/scheduler/notifications/test/", async ({ request }) => {
          const { channels } = (await request.json()) as { channels: string[] };
          tested.push(channels);
          return HttpResponse.json({ results: channels.map((c) => ({
            channel: c, status: c === "sms" ? "skipped" : "sent", detail: c === "sms" ? "Add a phone number under Your Profile." : "",
          })) });
        }),
      );
      return tested;
    }

    it("tests only options that were changed and are now on", async () => {
      const tested = serveSaveAndTests();
      await renderPage();
      // In-app is already on (unchanged → not tested); turn on Slack DM and SMS.
      fireEvent.click(await screen.findByRole("checkbox", { name: /Slack DM/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Phone \(SMS\)/ }));
      fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
      await waitFor(() => expect(tested).toEqual([["slack", "sms"]]));
      const results = await screen.findByTestId("notification-test-results");
      expect(results).toHaveTextContent("Test Slack DM: sent");
      expect(results).toHaveTextContent("Add a phone number under Your Profile.");
    });

    it("an option switched off is not tested", async () => {
      const tested = serveSaveAndTests();
      await renderPage();
      fireEvent.click(await screen.findByRole("checkbox", { name: /In-app/ })); // on → off
      fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
      await screen.findByText("Profile saved.");
      expect(tested).toEqual([]);
    });

    it("a second save without changes sends no test", async () => {
      const tested = serveSaveAndTests();
      await renderPage();
      fireEvent.click(await screen.findByRole("checkbox", { name: /^Slack notifications/ })); // off → on
      fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
      await waitFor(() => expect(tested).toEqual([["slack_general"]]));
      fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
      await new Promise((r) => setTimeout(r, 50));
      expect(tested).toEqual([["slack_general"]]);
    });
  });

  // ── Admin: user access ──────────────────────────────────────────────────────

  describe("user access (Admin)", () => {
    const directory = [
      { profile_id: 1, user_id: 1, username: "me", email: "me@x.com", display_name: "Me", access_level: "admin", is_self: true },
      { profile_id: 2, user_id: 2, username: "bea", email: "bea@x.com", display_name: "Bea", access_level: "basic", is_self: false },
    ];

    function serveAdmin(level: "admin" | "pm" | "basic" = "admin") {
      const changes: unknown[] = [];
      const searches: string[] = [];
      server.use(
        http.get("/api/v1/team/profiles/me/", () => HttpResponse.json({ ...mockUserProfile, is_staff: level === "admin", access_level: level })),
        http.get("/api/v1/team/profiles/directory/", ({ request }) => {
          const q = new URL(request.url).searchParams.get("search") ?? "";
          searches.push(q);
          return HttpResponse.json({ results: directory.filter((u) => u.display_name.toLowerCase().includes(q.toLowerCase())) });
        }),
        http.patch("/api/v1/team/profiles/:id/access-level/", async ({ params, request }) => {
          const body = (await request.json()) as { access_level: string };
          changes.push({ id: Number(params.id), ...body });
          return HttpResponse.json({ profile_id: Number(params.id), access_level: body.access_level });
        }),
      );
      return { changes, searches };
    }

    it("lists users with their current access level", async () => {
      serveAdmin();
      await renderPage();
      const select = await screen.findByRole("combobox", { name: "Access level for Bea" });
      expect((select as HTMLSelectElement).value).toBe("basic");
    });

    it("search narrows the list", async () => {
      const { searches } = serveAdmin();
      await renderPage();
      await screen.findByRole("combobox", { name: "Access level for Bea" });
      fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), { target: { value: "bea" } });
      await waitFor(() => expect(searches).toContain("bea"));
      await waitFor(() => expect(screen.queryByRole("combobox", { name: "Access level for Me" })).not.toBeInTheDocument());
    });

    it("changing the level PATCHes the access-level endpoint", async () => {
      const { changes } = serveAdmin();
      await renderPage();
      fireEvent.change(await screen.findByRole("combobox", { name: "Access level for Bea" }), { target: { value: "pm" } });
      await waitFor(() => expect(changes).toEqual([{ id: 2, access_level: "pm" }]));
      await waitFor(() => expect((screen.getByRole("combobox", { name: "Access level for Bea" }) as HTMLSelectElement).value).toBe("pm"));
    });

    it("is hidden from PM and Basic users", async () => {
      serveAdmin("pm");
      await renderPage();
      await screen.findByRole("button", { name: "Save Profile" });
      expect(screen.queryByText("Staff Data View")).not.toBeInTheDocument();
      expect(screen.queryByRole("searchbox", { name: "Search users" })).not.toBeInTheDocument();
    });
  });
});
