import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockApplets, mockPin, mockTags } from "../../test/handlers/discover";

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
    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it("clicking '+ Add Applet' shows the applet form", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));

    fireEvent.click(screen.getByText("Add to Discovery"));

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

  it("shows each linked site's own favicon, falling back to the type icon when it fails", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    const imgs = screen.getAllByTestId("site-favicon") as HTMLImageElement[];
    expect(imgs.map((i) => i.src)).toContain("https://example.com/favicon.ico");
    expect(imgs.map((i) => i.src)).toContain("https://github.com/favicon.ico");
    expect(imgs.every((i) => !i.src.includes("google.com/s2"))).toBe(true);
    fireEvent.error(imgs.find((i) => i.src === "https://example.com/favicon.ico")!);
    expect(screen.getAllByTestId("site-favicon").some((i) => (i as HTMLImageElement).src === "https://example.com/favicon.ico")).toBe(false);
  });

  it("offers every type and the new categories in the form and the filters", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    for (const label of ["Applets", "Tools", "Sites", "Docs", "Repos"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const c of ["Documentation", "Reference", "Reporting", "Communication", "Data", "AI", "Security", "Productivity"]) {
      expect(screen.getByRole("button", { name: c })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText("Add to Discovery"));
    const type = (await screen.findByLabelText(/Type/)) as HTMLSelectElement;
    expect(Array.from(type.options).map((o) => o.value)).toEqual(["applet", "tool", "site", "doc", "repo"]);
    const category = screen.getByLabelText(/Category/) as HTMLSelectElement;
    expect(Array.from(category.options).map((o) => o.value)).toContain("Documentation");
    expect(screen.getByText(/useful to many people/i)).toBeInTheDocument();
  });

  it("filters by type", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    fireEvent.click(screen.getByRole("button", { name: "Repos" }));
    expect(screen.queryByText(mockApplets[0].name)).toBeNull();
    expect(screen.getByText(mockApplets[1].name)).toBeInTheDocument();
  });

  it("the tag filter uses the site-wide tag list and narrows the cards", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    const tag = await screen.findByRole("button", { name: mockTags[0].name });
    fireEvent.click(tag);
    expect(tag).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(mockApplets[0].name)).toBeNull();
    expect(screen.getByText(mockApplets[1].name)).toBeInTheDocument();
  });

  it("the form lists existing tags, lets you pick some and create one, and saves them", async () => {
    let body: { tags?: string[] } = {};
    server.use(
      http.post("/api/v1/discover/applets/", async ({ request }) => {
        body = (await request.json()) as { tags?: string[] };
        return HttpResponse.json({ ...mockApplets[0], id: 50, ...body }, { status: 201 });
      }),
      http.head("*", () => new HttpResponse(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({}));
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    fireEvent.click(screen.getByText("Add to Discovery"));
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Wiki" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Docs" } });
    fireEvent.change(screen.getByLabelText(/URL/), { target: { value: "https://wiki.example.com" } });
    fireEvent.change(screen.getByPlaceholderText(/Type a name/), { target: { value: "Alice Smith" } });
    const group = screen.getByRole("group", { name: "Existing tags" });
    fireEvent.click(within(group).getByRole("button", { name: /^crm/ }));
    const input = screen.getByPlaceholderText(/search tags/i);
    fireEvent.change(input, { target: { value: "Brand New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Discovery", hidden: false }));
    await waitFor(() => expect(body.tags).toEqual(["crm", "Brand New"]));
    vi.unstubAllGlobals();
  });

  it("pin popover: pin to my profile", async () => {
    let posted: unknown;
    server.use(http.post("/api/v1/discover/pins/", async ({ request }) => {
      posted = await request.json();
      return HttpResponse.json(mockPin, { status: 201 });
    }));
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    fireEvent.click(screen.getByRole("button", { name: `Pin ${mockApplets[0].name}` }));
    fireEvent.click(await screen.findByRole("button", { name: /Pin to my profile/ }));
    await waitFor(() => expect(posted).toEqual({ applet: 1, account: null }));
  });

  it("pin popover: search and pin to an account", async () => {
    let posted: unknown;
    server.use(http.post("/api/v1/discover/pins/", async ({ request }) => {
      posted = await request.json();
      return HttpResponse.json({ ...mockPin, account: 1 }, { status: 201 });
    }));
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    fireEvent.click(screen.getByRole("button", { name: `Pin ${mockApplets[0].name}` }));
    fireEvent.click(await screen.findByRole("button", { name: /Pin to an account/ }));
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "acm" } });
    fireEvent.click(await screen.findByRole("button", { name: "Acme Corp" }));
    await waitFor(() => expect(posted).toEqual({ applet: 1, account: 1 }));
  });

  it("pin popover: a pinned item shows as pinned and toggling it unpins; others' pins can't be removed", async () => {
    let deleted = "";
    server.use(
      http.get("/api/v1/discover/pins/", () => HttpResponse.json([
        mockPin,
        { ...mockPin, id: 8, account: 1, account_name: "Acme Corp", pinned_by_username: "bob", can_remove: false },
      ])),
      http.delete("/api/v1/discover/pins/:id/", ({ params }) => { deleted = String(params.id); return new HttpResponse(null, { status: 204 }); }),
    );
    await renderPage();
    await waitFor(() => screen.getByText(mockApplets[0].name));
    const btn = await screen.findByRole("button", { name: `Pin ${mockApplets[0].name}` });
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(btn);
    fireEvent.click(await screen.findByRole("button", { name: /Pin to an account/ }));
    expect(await screen.findByRole("button", { name: "Acme Corp" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Pin to my profile/ }));
    await waitFor(() => expect(deleted).toBe("7"));
  });
});
