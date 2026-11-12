import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockReminders } from "../../test/handlers/scheduler";
import { mockAgentSkill, mockPagePin, pagePinsFor } from "../../test/handlers/skills";

// ── Mock cross-cutting context hooks ────────────────────────────────────────

vi.mock("../../context/ExportContext", () => ({
  useExport: () => ({
    exportMode: false,
    toggleItem: vi.fn(),
    isSelected: vi.fn(() => false),
  }),
}));

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

vi.mock("../../components/comments/CommentContext", () => ({
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
  // RemindersPage renders CommentTrigger / CommentPreviewList, which consume this.
  // Same stub shape the AccountDetailPage and ActionItemsPage suites use.
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
}));

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  fetchSharedLogsForResource: vi.fn(async () => []),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
}));

// SVG imports resolve to empty objects in happy-dom
vi.mock("../../assets/icons/Schedule.svg?react", () => ({ default: () => null }));

// ── Helpers ──────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: RemindersPage } = await import("../RemindersPage");
  render(
    <MemoryRouter>
      <RemindersPage />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RemindersPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows loading state initially", async () => {
    // Delay the response so we can observe the loading state
    server.use(
      http.get("/api/v1/scheduler/reminders/", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ results: mockReminders, count: mockReminders.length });
      })
    );
    await renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  });

  it("shows empty state when there are no reminders", async () => {
    server.use(
      http.get("/api/v1/scheduler/reminders/", () =>
        HttpResponse.json({ results: [], count: 0 })
      )
    );
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No.*reminders/i)).toBeInTheDocument()
    );
  });

  it("renders reminder titles when data is loaded", async () => {
    await renderPage();
    await waitFor(() =>
      expect(screen.getByText(mockReminders[0].title)).toBeInTheDocument()
    );
    expect(screen.getByText(mockReminders[1].title)).toBeInTheDocument();
  });

  it("clicking '+ New Reminder' opens the form", async () => {
    await renderPage();
    await waitFor(() => screen.getByText(mockReminders[0].title));
    fireEvent.click(screen.getByText("+ New Reminder"));
    expect(screen.getByText("New Reminder")).toBeInTheDocument();
  });

  it("clicking Delete button calls deleteReminder with correct id", async () => {
    // Track DELETE requests
    const deleteIds: string[] = [];
    server.use(
      http.delete("/api/v1/scheduler/reminders/:id/", ({ params }) => {
        deleteIds.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockReminders[0].title));

    // Click the delete button (title="Delete") on the first reminder
    const deleteButtons = screen.getAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(deleteIds).toContain(String(mockReminders[0].id)));
  });

  it("clicking Dismiss button calls dismissReminder with correct id", async () => {
    const dismissedIds: string[] = [];
    server.use(
      http.post("/api/v1/scheduler/reminders/:id/dismiss/", ({ params }) => {
        dismissedIds.push(params.id as string);
        return HttpResponse.json({ ...mockReminders[0], status: "dismissed" });
      })
    );

    await renderPage();
    await waitFor(() => screen.getByText(mockReminders[0].title));

    const dismissButtons = screen.getAllByTitle("Dismiss");
    fireEvent.click(dismissButtons[0]);

    await waitFor(() => expect(dismissedIds).toContain(String(mockReminders[0].id)));
  });

  describe("opens on All", () => {
    it("asks for every reminder, not just pending ones", async () => {
      let status: string | null = "unset";
      server.use(http.get("/api/v1/scheduler/reminders/", ({ request }) => {
        status = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({ results: mockReminders, count: mockReminders.length });
      }));
      await renderPage();
      await waitFor(() => expect(status).toBeNull());
    });

    it("shows a dismissed reminder straight away alongside a pending one", async () => {
      const pending = { ...mockReminders[0], id: 31, title: "Still pending", status: "pending" };
      const dismissed = { ...mockReminders[0], id: 32, title: "Long dismissed", status: "dismissed" };
      server.use(http.get("/api/v1/scheduler/reminders/", () => HttpResponse.json({ results: [pending, dismissed], count: 2 })));
      await renderPage();
      expect(await screen.findByText("Still pending")).toBeInTheDocument();
      expect(screen.getByText("Long dismissed")).toBeInTheDocument();
    });

    it("the other tabs are still there and narrow the list", async () => {
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      for (const name of ["Pending", "All", "Dismissed"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
      let status: string | null = null;
      server.use(http.get("/api/v1/scheduler/reminders/", ({ request }) => {
        status = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({ results: [], count: 0 });
      }));
      fireEvent.click(screen.getByRole("button", { name: "Pending" }));
      await waitFor(() => expect(status).toBe("pending"));
    });
  });

  describe("the form's fields", () => {
    it("offers the same fields as the calendar's reminder form", async () => {
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      fireEvent.click(screen.getByText("+ New Reminder"));
      expect(await screen.findByPlaceholderText(/Reminder title/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Additional notes/)).toBeInTheDocument();
      expect(document.querySelector('input[type="datetime-local"]')).not.toBeNull();
      expect(screen.getByTestId("reminder-links-field")).toBeInTheDocument();
      expect(screen.getByText("Also notify")).toBeInTheDocument();
      const channels = screen.getByRole("group", { name: "Notify me via" });
      expect(within(channels).getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["In-app", "Laptop", "Phone", "Slack"]);
    });

    it("says the channels are the creator's own and teammates are reached their own way", async () => {
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      fireEvent.click(screen.getByText("+ New Reminder"));
      expect(await screen.findByText(/Anyone you add under .Also notify. is reached the way they chose in their own Settings/)).toBeInTheDocument();
    });

    it("sends the creator's channels and nothing about a teammate's", async () => {
      const posts: Array<Record<string, unknown>> = [];
      server.use(http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...mockReminders[0], id: 99 }, { status: 201 });
      }));
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      fireEvent.click(screen.getByText("+ New Reminder"));
      fireEvent.change(await screen.findByPlaceholderText(/Reminder title/), { target: { value: "Ping" } });
      const channels = screen.getByRole("group", { name: "Notify me via" });
      fireEvent.click(within(channels).getByRole("checkbox", { name: "Phone" }));
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({ notify_in_app: true, notify_sms: true, notify_push: false, notify_slack: false, recipients: [] });
    });

    it("sends exactly the fields the shared builder defines", async () => {
      const posts: Array<Record<string, unknown>> = [];
      server.use(http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...mockReminders[0], id: 99 }, { status: 201 });
      }));
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      fireEvent.click(screen.getByText("+ New Reminder"));
      fireEvent.change(await screen.findByPlaceholderText(/Reminder title/), { target: { value: "Ping" } });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      const { buildReminderPayload } = await import("../../lib/reminderDraft");
      const expected = buildReminderPayload({
        title: "x", body: "", dueLocal: "2026-12-01T10:00", links: [], recipients: [],
        channels: { notify_in_app: true, notify_push: false, notify_sms: false, notify_slack: false },
      });
      expect(Object.keys(posts[0]).sort()).toEqual(Object.keys(expected).sort());
    });
  });

  describe("order", () => {
    it("asks for the most recent first, and for the whole history", async () => {
      let params: URLSearchParams | null = null;
      server.use(http.get("/api/v1/scheduler/reminders/", ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ results: mockReminders, count: mockReminders.length });
      }));
      await renderPage();
      await waitFor(() => expect(params).not.toBeNull());
      expect(params!.get("ordering")).toBe("-due_at");
      expect(params!.get("page_size")).toBe("500");
    });

    it("lists reminders in the order the server returns them, newest at the top", async () => {
      const newest = { ...mockReminders[0], id: 21, title: "Newest one", due_at: "2026-12-01T09:00:00Z" };
      const oldest = { ...mockReminders[0], id: 22, title: "Oldest one", due_at: "2026-01-01T09:00:00Z" };
      server.use(http.get("/api/v1/scheduler/reminders/", () => HttpResponse.json({ results: [newest, oldest], count: 2 })));
      await renderPage();
      const first = await screen.findByText("Newest one");
      const second = screen.getByText("Oldest one");
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe("linking a reminder to records", () => {
    async function openForm() {
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      fireEvent.click(screen.getByText("+ New Reminder"));
      return screen.findByTestId("reminder-links-field");
    }
    const field = () => screen.getByTestId("reminder-links-field");
    const pickType = (label: string) => fireEvent.change(within(field()).getByLabelText("Record type"), { target: { value: label } });

    function captureCreates() {
      const posts: Array<Record<string, unknown>> = [];
      server.use(http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posts.push(body);
        return HttpResponse.json({ ...mockReminders[0], id: 99, ...body }, { status: 201 });
      }));
      return posts;
    }

    it("offers a list of existing records of the chosen type, not a free-text box for a name", async () => {
      await openForm();
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link to a record" }));
      const list = await within(field()).findByRole("listbox", { name: "Account results" });
      expect(await within(list).findByRole("option", { name: /Acme Corp/ })).toBeInTheDocument();
      expect(within(list).getByRole("option", { name: /Initech/ })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Resource name/)).toBeNull();
    });

    it("shows that type's records when the type changes, with their detail", async () => {
      await openForm();
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link to a record" }));
      pickType("action_item");
      const list = await within(field()).findByRole("listbox", { name: "Action item results" });
      const option = await within(list).findByRole("option", { name: /Draft QBR deck/ });
      expect(option).toHaveTextContent("Acme Corp · Open");
    });

    it("typing filters the list through the server", async () => {
      const queries: string[] = [];
      server.use(http.get("/api/v1/scheduler/reminders/link-options/", ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        queries.push(q);
        return HttpResponse.json({ results: q === "init" ? [{ id: 2, label: "Initech", detail: "" }] : [{ id: 1, label: "Acme Corp", detail: "" }, { id: 2, label: "Initech", detail: "" }] });
      }));
      await openForm();
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link to a record" }));
      await within(field()).findByRole("option", { name: /Acme Corp/ });
      fireEvent.change(within(field()).getByRole("combobox", { name: /Search/ }), { target: { value: "init" } });
      expect(await within(field()).findByRole("option", { name: /Initech/ })).toBeInTheDocument();
      expect(within(field()).queryByRole("option", { name: /Acme Corp/ })).toBeNull();
      expect(queries).toContain("init");
    });

    it("says so when nothing matches, or the user has nothing of that type", async () => {
      server.use(http.get("/api/v1/scheduler/reminders/link-options/", () => HttpResponse.json({ results: [] })));
      await openForm();
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link to a record" }));
      expect(await within(field()).findByText("No accounts available to you.")).toBeInTheDocument();
      fireEvent.change(within(field()).getByRole("combobox", { name: /Search/ }), { target: { value: "zzz" } });
      expect(await within(field()).findByText("No matching records.")).toBeInTheDocument();
    });

    it("links to several records of different types and saves them all", async () => {
      const posts = captureCreates();
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/Reminder title|What do you want/i) ?? document.body, { target: { value: "Prep QBR" } });
      for (const [type, name] of [["account", /Acme Corp/], ["action_item", /Draft QBR deck/], ["calendar_event", /Acme QBR/]] as const) {
        fireEvent.click(within(field()).getByRole("button", { name: /\+ Link/ }));
        pickType(type);
        fireEvent.mouseDown(await within(field()).findByRole("option", { name }));
      }
      const chips = within(field()).getByRole("list", { name: "Linked records" });
      expect(within(chips).getAllByRole("listitem")).toHaveLength(3);
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0].links).toEqual([
        { resource_type: "account", resource_id: 1, resource_label: "Acme Corp" },
        { resource_type: "action_item", resource_id: 11, resource_label: "Draft QBR deck" },
        { resource_type: "calendar_event", resource_id: 21, resource_label: "Acme QBR" },
      ]);
      // The single-link fields are the server's to derive now.
      expect(posts[0]).not.toHaveProperty("resource_type");
    });

    it("does not offer a record that is already linked, and a link can be removed", async () => {
      const posts = captureCreates();
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/Reminder title|What do you want/i), { target: { value: "x" } });
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link to a record" }));
      fireEvent.mouseDown(await within(field()).findByRole("option", { name: /Acme Corp/ }));
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link another record" }));
      await within(field()).findByRole("option", { name: /Initech/ });
      expect(within(field()).queryByRole("option", { name: /Acme Corp/ })).toBeNull();

      fireEvent.click(within(field()).getByRole("button", { name: "Cancel linking" }));
      fireEvent.click(within(field()).getByRole("button", { name: "Remove link to Acme Corp" }));
      expect(within(field()).queryByRole("list", { name: "Linked records" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0].links).toEqual([]);
    });

    it("keyboard: arrows move, Enter picks", async () => {
      await openForm();
      fireEvent.click(within(field()).getByRole("button", { name: "+ Link to a record" }));
      const box = within(field()).getByRole("combobox", { name: /Search/ });
      await within(field()).findByRole("option", { name: /Initech/ });
      fireEvent.keyDown(box, { key: "ArrowDown" });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(within(field()).getByRole("list", { name: "Linked records" })).toHaveTextContent("Initech");
    });

    it("editing a reminder shows its existing links, and an old single link as one", async () => {
      server.use(http.get("/api/v1/scheduler/reminders/", () => HttpResponse.json({ results: [
        { ...mockReminders[0], id: 5, title: "Has two", links: [
          { resource_type: "account", resource_id: 1, resource_label: "Acme Corp" },
          { resource_type: "task", resource_id: 31, resource_label: "Send contract" }] },
        { ...mockReminders[0], id: 6, title: "Old style", links: [], resource_type: "account", resource_id: 2, resource_label: "Initech" },
      ], count: 2 })));
      await renderPage();
      await screen.findByText("Has two");
      expect(screen.getByText(/Acme Corp · Send contract/)).toBeInTheDocument();
      fireEvent.click(screen.getAllByTitle("Edit")[1]);
      const chips = await within(await screen.findByTestId("reminder-links-field")).findByRole("list", { name: "Linked records" });
      expect(chips).toHaveTextContent("Initech");
    });
  });

  describe("notifying teammates", () => {
    async function openForm() {
      await renderPage();
      await waitFor(() => screen.getByText(mockReminders[0].title));
      fireEvent.click(screen.getByText("+ New Reminder"));
      return screen.findByTestId("reminder-links-field");
    }
    const field = () => screen.getByTestId("reminder-links-field");

    async function linkActionItem() {
      fireEvent.click(within(field()).getByRole("button", { name: /\+ Link/ }));
      fireEvent.change(within(field()).getByLabelText("Record type"), { target: { value: "action_item" } });
      fireEvent.mouseDown(await within(field()).findByRole("option", { name: /Draft QBR deck/ }));
    }
    async function openTeammates() {
      fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
      await screen.findByTestId("recipient-2");
    }
    function captureCreates() {
      const posts: Array<Record<string, unknown>> = [];
      server.use(http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posts.push(body);
        return HttpResponse.json({ ...mockReminders[0], id: 99, ...body }, { status: 201 });
      }));
      return posts;
    }

    it("explains how to get a teammate list until something with an account is linked", async () => {
      await openForm();
      expect(screen.getByTestId("recipients-hint")).toHaveTextContent("Link an account");
      expect(screen.queryByRole("button", { name: "Notify teammates" })).toBeNull();
    });

    it("offers the team of the account behind a linked action item — no account link needed", async () => {
      await openForm();
      await linkActionItem();
      await openTeammates();
      expect(screen.getByTestId("recipients-from")).toHaveTextContent("From Acme Corp");
      expect(screen.getByRole("checkbox", { name: "Ana Reyes" })).toBeEnabled();
    });

    it("lists a teammate who opted out but will not let you pick them, and says why", async () => {
      await openForm();
      await linkActionItem();
      await openTeammates();
      expect(screen.getByRole("checkbox", { name: /Ben Ortiz/ })).toBeDisabled();
      expect(screen.getByTestId("recipient-3")).toHaveAttribute("title", expect.stringContaining("has turned off being notified"));
    });

    describe("your manager, and colleagues for Admin reminders", () => {
      const manager = { user_id: 7, name: "Sam Boss", available: true, reason: "", accounts: ["Your manager"] };
      const serveRecipients = (payload: object) =>
        server.use(http.get("/api/v1/scheduler/reminders/recipients/", () => HttpResponse.json(payload)));

      it("offers the manager with nothing linked at all — they need not be on any of your accounts", async () => {
        serveRecipients({ results: [manager], sources: ["Your manager"], accounts: [] });
        await openForm();
        expect(await screen.findByRole("button", { name: "Notify teammates" })).toHaveTextContent("Just me");
        expect(screen.queryByTestId("recipients-hint")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Notify teammates" }));
        expect(await screen.findByTestId("recipients-from")).toHaveTextContent("From Your manager");
        expect(screen.getByRole("checkbox", { name: "Sam Boss" })).toBeEnabled();
      });

      it("notifying the manager takes the same explicit yes, and sends no links", async () => {
        serveRecipients({ results: [manager], sources: ["Your manager"], accounts: [] });
        const posts = captureCreates();
        await openForm();
        fireEvent.change(screen.getByPlaceholderText(/Reminder title/), { target: { value: "Heads up" } });
        fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
        fireEvent.click(await screen.findByRole("checkbox", { name: "Sam Boss" }));
        fireEvent.click(screen.getByRole("button", { name: "Create" }));
        expect(await screen.findByRole("alertdialog")).toHaveTextContent("Sam Boss");
        expect(posts).toHaveLength(0);
        fireEvent.click(screen.getByRole("button", { name: "Yes, notify them" }));
        await waitFor(() => expect(posts).toHaveLength(1));
        expect(posts[0]).toMatchObject({ recipients: [7], confirm_notify_others: true, links: [] });
      });

      it("a manager who opted out is listed but cannot be picked, with the reason", async () => {
        serveRecipients({
          results: [{ ...manager, available: false, reason: "Sam Boss has turned off being notified by other users in their Settings." }],
          sources: ["Your manager"], accounts: [],
        });
        await openForm();
        fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
        expect(await screen.findByRole("checkbox", { name: /Sam Boss/ })).toBeDisabled();
        expect(screen.getByTestId("recipient-7")).toHaveAttribute("title", expect.stringContaining("turned off being notified"));
      });

      it("says where each person comes from when there is more than one source", async () => {
        serveRecipients({
          results: [
            { user_id: 2, name: "Ana Reyes", available: true, reason: "", accounts: ["Your colleagues"] },
            manager,
          ],
          sources: ["Your colleagues", "Your manager"], accounts: [],
        });
        await openForm();
        fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
        expect(await screen.findByTestId("recipients-from")).toHaveTextContent("From Your colleagues, Your manager");
        expect(screen.getByTestId("recipient-2")).toHaveTextContent("(Your colleagues)");
        expect(screen.getByTestId("recipient-7")).toHaveTextContent("(Your manager)");
      });

      it("with no manager and nothing linked it explains how to get a list", async () => {
        await openForm();
        expect(await screen.findByTestId("recipients-hint")).toHaveTextContent("Link an account");
      });
    });

    describe("team members who have never signed in", () => {
      const roster = {
        results: [
          { user_id: null, member_id: 61, name: "Pat Nologin", available: false,
            reason: "Pat Nologin hasn't signed in to AgentPM yet, so there is no way to notify them in the app.", accounts: ["Acme Corp"] },
          { user_id: 2, member_id: 20, name: "Ana Reyes", available: true, reason: "", accounts: ["Acme Corp"] },
        ],
        sources: ["Acme Corp"], accounts: ["Acme Corp"],
      };
      const serveRoster = (payload: object = roster) =>
        server.use(http.get("/api/v1/scheduler/reminders/recipients/", () => HttpResponse.json(payload)));

      it("lists them, so an account's team is not mistaken for empty", async () => {
        serveRoster();
        await openForm();
        await linkActionItem();
        fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
        expect(await screen.findByRole("checkbox", { name: /Pat Nologin/ })).toBeInTheDocument();
        expect(screen.queryByTestId("recipients-hint")).toBeNull();
      });

      it("will not let you pick them, and says why and how it differs from opting out", async () => {
        serveRoster();
        await openForm();
        await linkActionItem();
        fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
        const pat = await screen.findByRole("checkbox", { name: /Pat Nologin/ });
        expect(pat).toBeDisabled();
        fireEvent.click(pat);
        expect(pat).not.toBeChecked();
        const row = screen.getByTestId("recipient-m61");
        expect(row).toHaveAttribute("title", expect.stringContaining("hasn't signed in to AgentPM"));
        expect(row).toHaveTextContent("not on AgentPM yet");
        expect(screen.getByRole("checkbox", { name: "Ana Reyes" })).toBeEnabled();
      });

      it("a team of people who have all never signed in still lists them all, none choosable", async () => {
        serveRoster({ results: [roster.results[0], { ...roster.results[0], member_id: 62, name: "Quinn Nologin" }], sources: ["Acme Corp"], accounts: ["Acme Corp"] });
        await openForm();
        await linkActionItem();
        fireEvent.click(await screen.findByRole("button", { name: "Notify teammates" }));
        const boxes = await screen.findAllByRole("checkbox", { name: /Nologin/ });
        expect(boxes).toHaveLength(2);
        boxes.forEach((b) => expect(b).toBeDisabled());
      });

      it("when you really are the only one on the account it says so, not that you are not on it", async () => {
        serveRoster({ results: [], sources: ["Acme Corp"], accounts: ["Acme Corp"] });
        await openForm();
        await linkActionItem();
        expect(await screen.findByTestId("recipients-hint")).toHaveTextContent("You are the only person on Acme Corp");
      });

      it("and says it differently when none of the linked records is on an account you are on", async () => {
        serveRoster({ results: [], sources: [], accounts: [] });
        await openForm();
        await linkActionItem();
        expect(await screen.findByTestId("recipients-hint")).toHaveTextContent("None of the linked records belongs to an account you are on");
      });
    });

    it("notifies only me by default, and sends no recipients", async () => {
      const posts = captureCreates();
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/Reminder title/), { target: { value: "Solo" } });
      await linkActionItem();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0].recipients).toEqual([]);
      expect(posts[0]).not.toHaveProperty("confirm_notify_others");
    });

    it("asks 'are you sure?' before notifying anyone, and sends nothing until they say yes", async () => {
      const posts = captureCreates();
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/Reminder title/), { target: { value: "Prep QBR" } });
      await linkActionItem();
      await openTeammates();
      fireEvent.click(screen.getByRole("checkbox", { name: "Ana Reyes" }));
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent("Are you sure you want to notify these users?");
      expect(dialog).toHaveTextContent("Ana Reyes");
      expect(posts).toHaveLength(0);

      fireEvent.click(within(dialog).getByRole("button", { name: "Go back" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(posts).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      fireEvent.click(await screen.findByRole("button", { name: "Yes, notify them" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({ recipients: [2], confirm_notify_others: true });
      expect(posts[0].links).toEqual([{ resource_type: "action_item", resource_id: 11, resource_label: "Draft QBR deck" }]);
    });

    it("shows the server's reason when it refuses, and keeps the form", async () => {
      server.use(http.post("/api/v1/scheduler/reminders/", () =>
        HttpResponse.json({ recipients: ["Ana Reyes has turned off being notified by other users in their Settings."] }, { status: 400 })));
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/Reminder title/), { target: { value: "Prep QBR" } });
      await linkActionItem();
      await openTeammates();
      fireEvent.click(screen.getByRole("checkbox", { name: "Ana Reyes" }));
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      fireEvent.click(await screen.findByRole("button", { name: "Yes, notify them" }));

      expect(await screen.findByText(/turned off being notified/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Reminder title/)).toHaveValue("Prep QBR");
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("unlinking the record that reached them takes them off the list", async () => {
      const posts = captureCreates();
      await openForm();
      fireEvent.change(screen.getByPlaceholderText(/Reminder title/), { target: { value: "Prep QBR" } });
      await linkActionItem();
      await openTeammates();
      fireEvent.click(screen.getByRole("checkbox", { name: "Ana Reyes" }));
      expect(screen.getByRole("button", { name: "Notify teammates" })).toHaveTextContent("Me + Ana Reyes");

      fireEvent.click(within(field()).getByRole("button", { name: "Remove link to Draft QBR deck" }));
      expect(await screen.findByTestId("recipients-hint")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0].recipients).toEqual([]);
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    describe("editing a reminder that already notifies someone", () => {
      const existing = {
        ...mockReminders[0], id: 5, title: "Has a teammate",
        links: [{ resource_type: "action_item", resource_id: 11, resource_label: "Draft QBR deck" }],
        recipients: [2], recipient_details: [{ id: 2, name: "Ana Reyes" }],
      };
      async function openEdit() {
        server.use(http.get("/api/v1/scheduler/reminders/", () => HttpResponse.json({ results: [existing], count: 1 })));
        await renderPage();
        await screen.findByText("Has a teammate");
        fireEvent.click(screen.getByTitle("Edit"));
        await screen.findByRole("button", { name: "Notify teammates" });
      }

      it("shows who is already being notified", async () => {
        await openEdit();
        await waitFor(() => expect(screen.getByRole("button", { name: "Notify teammates" })).toHaveTextContent("Me + Ana Reyes"));
      });

      it("saving an unrelated change does not ask again and does not re-send the approval", async () => {
        const patches: Array<Record<string, unknown>> = [];
        server.use(http.patch("/api/v1/scheduler/reminders/:id/", async ({ request }) => {
          patches.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(existing);
        }));
        await openEdit();
        await waitFor(() => expect(screen.getByRole("button", { name: "Notify teammates" })).toHaveTextContent("Ana Reyes"));
        fireEvent.change(screen.getByPlaceholderText(/Reminder title/), { target: { value: "Renamed" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(patches).toHaveLength(1));
        expect(screen.queryByRole("alertdialog")).toBeNull();
        expect(patches[0].recipients).toEqual([2]);
        expect(patches[0]).not.toHaveProperty("confirm_notify_others");
      });
    });
  });
});

describe("RemindersPage — pinned Claude skills", () => {
  it("lists them in a column to the right of the page's content", async () => {
    server.use(pagePinsFor("reminders", [mockPagePin({ page: "reminders", skill: mockAgentSkill({ id: 1, name: "weekly-update" }) })]));
    await renderPage();
    const aside = await screen.findByTestId("reminders-skills-column");
    expect(await within(aside).findByRole("button", { name: /^Weekly Update/ })).toBeInTheDocument();
    // Same flex row as the reminders column, and after it → on its right.
    const column = aside.previousElementSibling as HTMLElement;
    expect(aside.parentElement).toHaveStyle({ display: "flex" });
    expect(column).toHaveTextContent(/Reminders/);
    expect(aside).toHaveStyle({ width: "260px", position: "sticky" });
    // The column itself keeps its width cap.
    expect(column).toHaveStyle({ maxWidth: "800px" });
  });

  it("is a vertical list with the add dropdown", async () => {
    server.use(pagePinsFor("reminders", [mockPagePin({ page: "reminders", skill: mockAgentSkill({ id: 1, name: "weekly-update" }) })]));
    await renderPage();
    const aside = await screen.findByTestId("reminders-skills-column");
    await within(aside).findByRole("button", { name: /^Weekly Update/ });
    expect(within(aside).getByTestId("pinned-skills-reminders")).toHaveStyle({ flexDirection: "column" });
    expect(within(aside).getByLabelText("Pin a Claude Skill to this page")).toBeInTheDocument();
  });

  it("shows pins for this page only", async () => {
    server.use(pagePinsFor("calendar", [mockPagePin({ skill: mockAgentSkill({ id: 1, name: "weekly-update" }) })]));
    await renderPage();
    const aside = await screen.findByTestId("reminders-skills-column");
    expect(await within(aside).findByText("No Claude skills pinned here yet.")).toBeInTheDocument();
  });
});
