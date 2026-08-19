import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { ActionItemModal } from "../ActionItemModal";
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

  it("sends the file as multipart with artifact_type=file", async () => {
    let seenType: string | null = null;
    let seenName: string | null = null;
    let seenFilename: string | null = null;
    server.use(
      http.post(ATTACHMENTS_URL, async ({ request }) => {
        const fd = await request.formData();
        seenType = String(fd.get("artifact_type"));
        seenName = String(fd.get("name"));
        seenFilename = (fd.get("file") as File)?.name ?? null;
        return HttpResponse.json({ id: 1, artifact_type: "file", name: "notes.pdf", url: "", file_url: "u" }, { status: 201 });
      })
    );
    renderModal();
    await waitFor(() => expect(screen.getByText("+ File")).toBeInTheDocument());

    chooseFile();

    await waitFor(() => expect(seenType).toBe("file"));
    expect(seenName).toBe("notes.pdf");
    expect(seenFilename).toBe("notes.pdf");
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
