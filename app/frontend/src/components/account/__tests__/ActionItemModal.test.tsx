import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { ActionItemModal } from "../ActionItemModal";
import { getLogsForResource } from "../../../lib/appLog";
import { apiClient } from "../../../lib/api";
import type { AirtableActionItem } from "../../../types";

vi.mock("../../comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../ActionItemCardOccurrences", () => ({ ActionItemCardOccurrences: () => null }));
vi.mock("../../ActivityLogSection", () => ({ default: () => null }));
vi.mock("../../CommentIcon", () => ({ default: () => null }));
vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

const mockItem: AirtableActionItem = {
  id: 7,
  airtable_id: "recAAA001",
  account: 1,
  account_name: "Acme Corp",
  task: "Fix billing issue",
  task_details: "",
  status: "Open",
  priority: "High",
  due_date: null,
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  salesforce_task_id: "",
  assignee_airtable_id: "",
  assignee_name: "",
  reminder: null,
  reminder_id: null,
  reminder_due_at: null,
  reminder_status: null,
  linked_meeting: null,
  linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "",
};

const ATTACHMENTS_URL = "/api/v1/airtable/action-items/:id/attachments/";
const SLACK_URL = "https://acme.slack.com/archives/C123/p456";

function registerHandlers() {
  server.use(
    http.get(ATTACHMENTS_URL, () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/artifacts/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/action-items/field-options/", () =>
      HttpResponse.json({
        status: ["Open", "In Progress", "Done", "Blocked", "Backlogged"],
        priority: ["Low", "Medium", "High", "Critical"],
      })
    ),
  );
}

function renderModal() {
  return render(<ActionItemModal item={mockItem} accountId={1} onClose={vi.fn()} />);
}

/** Pick a file through the hidden input behind the "+ File" button. */
function chooseFile(name = "notes.pdf") {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["hello"], name, { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

function attachmentsSection(): HTMLElement {
  let el: HTMLElement | null = screen.getByText(/^Attachments/);
  while (el && el.parentElement && !el.className.includes("mb-2")) el = el.parentElement;
  return (el?.parentElement ?? document.body) as HTMLElement;
}

describe("ActionItemModal attachments", () => {
  beforeEach(() => {
    registerHandlers();
  });

  it("renders the + File control and no attachments initially", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
  });

  it("a successfully uploaded file appears in the attachment list", async () => {
    server.use(
      http.post(ATTACHMENTS_URL, () =>
        HttpResponse.json(
          {
            id: 99,
            action_item: 7,
            artifact_type: "file",
            name: "notes.pdf",
            url: "",
            file_url: "http://localhost/media/action_item_attachments/2026/08/notes.pdf",
            mime_type: "application/pdf",
            file_size: 5,
            uploaded_by: 1,
            uploaded_by_username: "lizkane",
            created_at: "2026-08-18T00:00:00Z",
            updated_at: "2026-08-18T00:00:00Z",
          },
          { status: 201 }
        )
      )
    );
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile();

    // This is the reported symptom: the file must actually show up.
    await waitFor(() => expect(screen.getByText("notes.pdf")).toBeInTheDocument());
    expect(screen.queryByText("No attachments yet.")).not.toBeInTheDocument();
    expect(within(attachmentsSection()).getByText(/Attachments \(1\)/)).toBeInTheDocument();
  });

  /**
   * Asserted on the `FormData` axios was handed, not on the intercepted request body.
   *
   * `request.formData()` cannot work here, and not because of anything the app does. Axios
   * deliberately leaves `Content-Type` for the platform to fill in with its multipart
   * boundary, but under jsdom the adapter stringifies the `FormData` — the intercepted body
   * is the literal text `"[object FormData]"` with `Content-Type: text/plain`, so undici
   * throws `Content-Type was not one of "multipart/form-data"...` before any assertion runs.
   * Verified against the live server by hand: a real upload returns 201 with the file
   * stored, so the failure was the harness, never the upload.
   *
   * Reading the `FormData` off the outgoing request config keeps what the test is actually
   * for — that the request carries `artifact_type=file`, the name, and the file itself —
   * without asserting on a body only this environment mangles. An axios request
   * interceptor sees the real object before the adapter stringifies it. The sibling test
   * above already covers the response path.
   */
  it("sends the file as multipart with artifact_type=file", async () => {
    let sent: FormData | null = null;
    const interceptorId = apiClient.interceptors.request.use((config) => {
      if (config.data instanceof FormData && String(config.url).includes("/attachments/")) {
        sent = config.data;
      }
      return config;
    });

    server.use(
      http.post(ATTACHMENTS_URL, () =>
        HttpResponse.json({ id: 1, artifact_type: "file", name: "notes.pdf", url: "", file_url: "u" }, { status: 201 })
      )
    );
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile();

    // The attachment renders only if the POST succeeded, so this also pins the round trip.
    await waitFor(() => expect(screen.getByText("notes.pdf")).toBeInTheDocument());

    try {
      const fd = sent as FormData | null;
      expect(fd).not.toBeNull();
      expect(fd!.get("artifact_type")).toBe("file");
      expect(fd!.get("name")).toBe("notes.pdf");
      expect((fd!.get("file") as File)?.name).toBe("notes.pdf");
    } finally {
      apiClient.interceptors.request.eject(interceptorId);
    }
  });

  // The bug was invisible because the rejection was swallowed: the user picked a file and
  // absolutely nothing happened, with no error anywhere.
  it("surfaces a permission error instead of failing silently", async () => {
    server.use(
      http.post(ATTACHMENTS_URL, () =>
        HttpResponse.json({ detail: "You can only modify action items assigned to you." }, { status: 403 })
      )
    );
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You can only modify action items assigned to you.");
    expect(alert).toHaveTextContent("notes.pdf");
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
  });

  it("surfaces a rejected file type", async () => {
    server.use(
      http.post(ATTACHMENTS_URL, () =>
        HttpResponse.json({ error: "File type '.svg' is not permitted." }, { status: 400 })
      )
    );
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile("logo.svg");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("not permitted");
    expect(alert).toHaveTextContent("logo.svg");
  });

  it("falls back to a generic message when the server sends no detail", async () => {
    server.use(http.post(ATTACHMENTS_URL, () => new HttpResponse(null, { status: 500 })));
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Upload failed.");
  });

  it("clears a previous error once an upload succeeds", async () => {
    server.use(http.post(ATTACHMENTS_URL, () => new HttpResponse(null, { status: 500 })));
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile();
    await screen.findByRole("alert");

    server.use(
      http.post(ATTACHMENTS_URL, () =>
        HttpResponse.json({ id: 2, artifact_type: "file", name: "second.pdf", url: "", file_url: "u" }, { status: 201 })
      )
    );
    chooseFile("second.pdf");

    await waitFor(() => expect(screen.getByText("second.pdf")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Regression: StepsPanel, its hook, types and API client all existed but nothing rendered
  // the component, so the checklist was unreachable in the app.
  it("renders the checklist for a real action item", async () => {
    server.use(
      http.get("/api/v1/airtable/steps/", () =>
        HttpResponse.json([
          { id: 1, action_item: 7, title: "Step one", status: "Done", order: 0, created_at: "2026-08-18T00:00:00Z" },
          { id: 2, action_item: 7, title: "Step two", status: "Open", order: 1, created_at: "2026-08-18T00:00:00Z" },
        ])
      )
    );
    renderModal();

    await waitFor(() => expect(screen.getByText("Checklist")).toBeInTheDocument());
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("places the checklist as its own section directly below the description", async () => {
    server.use(http.get("/api/v1/airtable/steps/", () => HttpResponse.json([])));
    renderModal();
    await waitFor(() => expect(screen.getByText("Checklist")).toBeInTheDocument());

    const description = screen.getByText("Description");
    const checklist = screen.getByText("Checklist");
    const attachments = screen.getByText(/^Attachments/);

    // Description → Checklist → Attachments, and the checklist is a sibling section rather
    // than something nested inside the description field.
    expect(description.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checklist.compareDocumentPosition(attachments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByPlaceholderText(/Additional context/).contains(checklist)).toBe(false);
  });

  it("no longer invites writing steps into the description", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText("Description")).toBeInTheDocument());

    // Steps have a real field now, so the description placeholder must not advertise them.
    expect(screen.getByPlaceholderText("Additional context or notes…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/steps/i)).not.toBeInTheDocument();
  });

  it("scopes the checklist request to this action item", async () => {
    let scoped: string | null = null;
    server.use(
      http.get("/api/v1/airtable/steps/", ({ request }) => {
        scoped = new URL(request.url).searchParams.get("action_item");
        return HttpResponse.json([]);
      })
    );
    renderModal();

    await waitFor(() => expect(scoped).toBe("7"));
  });

  it("hides the checklist for an unsaved local-* draft", async () => {
    // Steps key off the numeric PK, which a draft does not have until it is promoted.
    render(<ActionItemModal item={{ ...mockItem, airtable_id: "local-1" }} accountId={1} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());
    expect(screen.queryByText("Checklist")).not.toBeInTheDocument();
  });

  // ── Drag and drop files ──────────────────────────────────────────────────────

  it("uploads a file dragged onto the modal, same as the + File button", async () => {
    server.use(
      http.post(ATTACHMENTS_URL, () =>
        HttpResponse.json({ id: 42, artifact_type: "file", name: "dragged.pdf", url: "", file_url: "u" }, { status: 201 })
      )
    );
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const panel = screen.getByTestId("action-item-modal-panel");
    const file = new File(["hello"], "dragged.pdf", { type: "application/pdf" });
    fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [file] } });

    await waitFor(() => expect(screen.getByText("dragged.pdf")).toBeInTheDocument());
  });

  it("shows a drop overlay while a file is dragged over, and clears it on drop", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const panel = screen.getByTestId("action-item-modal-panel");
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();

    // No file payload here on purpose — the upload path itself is covered by the test
    // above; this one only pins that the overlay clears on drop.
    fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();
  });

  it("clears the drop overlay on dragLeave without uploading anything", async () => {
    const patches: unknown[] = [];
    server.use(http.post(ATTACHMENTS_URL, () => { patches.push(1); return HttpResponse.json({}, { status: 201 }); }));
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const panel = screen.getByTestId("action-item-modal-panel");
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();

    fireEvent.dragLeave(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it("ignores a drag that carries no files (e.g. dragging a card over the modal)", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const panel = screen.getByTestId("action-item-modal-panel");
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();
  });

  it("does not accept a file drop on an unsaved local-* draft", async () => {
    const patches: unknown[] = [];
    server.use(http.post(ATTACHMENTS_URL, () => { patches.push(1); return HttpResponse.json({}, { status: 201 }); }));
    render(<ActionItemModal item={{ ...mockItem, airtable_id: "local-1" }} accountId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    const panel = screen.getByTestId("action-item-modal-panel");
    const file = new File(["hello"], "dragged.pdf", { type: "application/pdf" });
    fireEvent.dragEnter(panel, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();

    fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files: [file] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toHaveLength(0);
  });

  // ── Slack link ──────────────────────────────────────────────────────────────

  it("saves a pasted Slack link straight away, without waiting for Save", async () => {
    const patches: Array<Record<string, unknown>> = [];
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...mockItem, slack_thread_url: SLACK_URL });
      })
    );
    const onAutosaved = vi.fn();
    render(<ActionItemModal item={mockItem} accountId={1} onClose={vi.fn()} onAutosaved={onAutosaved} />);
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Slack$/ }));
    const input = screen.getByPlaceholderText("https://…");
    fireEvent.paste(input, { clipboardData: { getData: () => SLACK_URL } });

    // Every other field on this form is a draft you review before saving. A pasted link is
    // not — before this it was dropped on the floor with no sign anything went wrong.
    await waitFor(() => expect(patches).toEqual([{ slack_thread_url: SLACK_URL }]));
    expect(onAutosaved).toHaveBeenCalled();
    // The chip replacing the input is the only confirmation the user gets.
    await waitFor(() => expect(screen.getByText("Slack ↗")).toBeInTheDocument());
  });

  // Regression: callers close the modal in response to `onUpdated` (the explicit Save
  // button). A pasted Slack link used to fire that same callback, so the modal closed itself
  // the instant a link landed — "paste a link and the modal just closes" was the report.
  it("does not fire onUpdated for a pasted Slack link — only onAutosaved", async () => {
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", () =>
        HttpResponse.json({ ...mockItem, slack_thread_url: SLACK_URL })
      )
    );
    const onUpdated = vi.fn();
    const onAutosaved = vi.fn();
    render(
      <ActionItemModal item={mockItem} accountId={1} onClose={vi.fn()} onUpdated={onUpdated} onAutosaved={onAutosaved} />
    );
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Slack$/ }));
    const input = screen.getByPlaceholderText("https://…");
    fireEvent.paste(input, { clipboardData: { getData: () => SLACK_URL } });

    await waitFor(() => expect(onAutosaved).toHaveBeenCalled());
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("does not write when the pill is opened and dismissed with Escape", async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", async () => {
        patches.push(1);
        return HttpResponse.json(mockItem);
      })
    );
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Slack$/ }));
    const input = screen.getByPlaceholderText("https://…");
    fireEvent.change(input, { target: { value: SLACK_URL } });
    fireEvent.keyDown(input, { key: "Escape" });

    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toHaveLength(0);
  });

  // ── Activity log ────────────────────────────────────────────────────────────

  it("records a field change in the activity log on Save", async () => {
    localStorage.clear();
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", () =>
        HttpResponse.json({ ...mockItem, task: "Renamed task" })
      ),
      // addLog fires a fire-and-forget POST; give it a handler so the network layer is quiet.
      http.post("/api/v1/realtime/activity/", () => HttpResponse.json({ id: 1 }, { status: 201 }))
    );
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("Fix billing issue"), { target: { value: "Renamed task" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      const logs = getLogsForResource("action_item", "recAAA001");
      expect(logs.some((l) => l.message.includes("Title updated"))).toBe(true);
    });
  });

  it("Save PATCHes only edited fields — never a stale time_spent", async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...mockItem, task: "Renamed task" });
      }),
      http.post("/api/v1/realtime/activity/", () => HttpResponse.json({ id: 1 }, { status: 201 }))
    );
    render(<ActionItemModal item={{ ...mockItem, time_spent: 900 }} accountId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("Fix billing issue"), { target: { value: "Renamed task" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ task: "Renamed task" });
  });

  it("writes no activity entry when Save changes nothing", async () => {
    localStorage.clear();
    server.use(
      http.patch("/api/v1/airtable/action-items/:id/fields/", () => HttpResponse.json(mockItem)),
      http.post("/api/v1/realtime/activity/", () => HttpResponse.json({ id: 1 }, { status: 201 }))
    );
    renderModal();
    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(screen.getByDisplayValue("Fix billing issue")).toBeInTheDocument());
    expect(getLogsForResource("action_item", "recAAA001")).toHaveLength(0);
  });

  it("re-reads the attachment list on open so a prior upload is shown", async () => {
    server.use(
      http.get(ATTACHMENTS_URL, () =>
        HttpResponse.json([
          { id: 5, artifact_type: "file", name: "already-there.pdf", url: "", file_url: "u", mime_type: "application/pdf", file_size: 10 },
        ])
      )
    );
    renderModal();

    await waitFor(() => expect(screen.getByText("already-there.pdf")).toBeInTheDocument());
  });
});

describe("ActionItemModal — positioning", () => {
  beforeEach(registerHandlers);

  it("portals to document.body so a transformed ancestor cannot confine it", () => {
    // CalendarPage renders the sidebar (and so this modal) inside a translate-x panel;
    // a transform on any ancestor makes `position: fixed` resolve against it.
    const { container } = render(
      <div data-testid="sliding-panel" style={{ transform: "translateX(0)" }}>
        <ActionItemModal item={mockItem} accountId={1} onClose={vi.fn()} />
      </div>,
    );
    const panel = screen.getByTestId("action-item-modal-panel");
    expect(screen.getByTestId("sliding-panel").contains(panel)).toBe(false);
    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement?.parentElement).toBe(document.body);
  });

  it("still closes on backdrop click after portalling", () => {
    const onClose = vi.fn();
    render(<ActionItemModal item={mockItem} accountId={1} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("action-item-modal-panel").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
