import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockArtifact } from "../../../test/handlers/accounts";
import { MemoryRouter } from "react-router-dom";
import { ArtifactsPanel } from "../ArtifactsPanel";
import type { CommentReference, GoalSection } from "../../../types";

// Silence console.error from act() warnings in tests
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function renderPanel(props: Partial<Parameters<typeof ArtifactsPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ArtifactsPanel accountId={1} {...props} />
    </MemoryRouter>,
  );
}

describe("ArtifactsPanel", () => {
  // ── Rendering ──────────────────────────────────────────────────────────────

  it("renders artifact names from the API", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Product Spec")).toBeInTheDocument();
      expect(screen.getByText("utils.js")).toBeInTheDocument();
    });
  });

  it("shows empty upload prompt when API returns no artifacts", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () => HttpResponse.json([]))
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/Drop files here/)).toBeInTheDocument()
    );
  });

  it("shows view switcher tabs when artifacts exist", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By Integration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By Category" })).toBeInTheDocument();
  });

  it("shows code file icon category for a .js file artifact", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("utils.js"));
    // The file_size badge confirms it's rendered as a file artifact
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  // ── Context menu ───────────────────────────────────────────────────────────

  it("opens context menu with edit and delete on right-click", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const card = screen.getByText("Product Spec").closest("[draggable]")!;
    fireEvent.contextMenu(card);
    expect(screen.getByText("Edit artifact")).toBeInTheDocument();
    expect(screen.getByText("Delete artifact")).toBeInTheDocument();
  });

  it("closes context menu when clicking outside", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const card = screen.getByText("Product Spec").closest("[draggable]")!;
    fireEvent.contextMenu(card);
    expect(screen.getByText("Edit artifact")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(screen.queryByText("Edit artifact")).not.toBeInTheDocument()
    );
  });

  it("shows copy link item when artifact has a URL", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    expect(screen.getByText("Copy link")).toBeInTheDocument();
  });

  // ── Delete confirmation ────────────────────────────────────────────────────

  it("shows confirmation prompt after clicking Delete artifact", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Delete artifact"));
    expect(screen.getByText("Delete this artifact?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("canceling confirmation returns to normal context menu", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Delete artifact"));
    expect(screen.getByText("Delete this artifact?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Delete artifact")).toBeInTheDocument();
    expect(screen.queryByText("Delete this artifact?")).not.toBeInTheDocument();
  });

  it("confirming delete calls API and removes the artifact from the list", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Delete artifact"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByText("Product Spec")).not.toBeInTheDocument()
    );
    // Other artifact should still be visible
    expect(screen.getByText("utils.js")).toBeInTheDocument();
  });

  // ── Edit artifact modal ────────────────────────────────────────────────────

  it("opens edit modal on Edit artifact click", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    // Modal heading
    expect(screen.getByRole("heading", { name: "Edit artifact" })).toBeInTheDocument();
    // Pre-populated name field
    expect(screen.getByDisplayValue("Product Spec")).toBeInTheDocument();
  });

  it("save changes calls updateArtifact and updates the artifact in the list", async () => {
    server.use(
      http.patch("/api/v1/accounts/artifacts/:id/", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...mockArtifact, name: String(body.name ?? mockArtifact.name) });
      })
    );
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    const nameInput = screen.getByDisplayValue("Product Spec");
    fireEvent.change(nameInput, { target: { value: "Updated Spec" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Updated Spec")).toBeInTheDocument());
  });

  it("canceling the edit modal closes it without changes", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Edit artifact" })).not.toBeInTheDocument()
    );
    expect(screen.getByText("Product Spec")).toBeInTheDocument();
  });

  // ── Category ───────────────────────────────────────────────────────────────

  it("shows Set category option in context menu", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    expect(screen.getByText("Set category…")).toBeInTheDocument();
  });

  it("setting a category shows the category label on the artifact card", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Set category…"));
    const catInput = screen.getByPlaceholderText(/Finance/);
    fireEvent.change(catInput, { target: { value: "Legal" } });
    fireEvent.keyDown(catInput, { key: "Enter" });
    // Category is stored as "Legal" — CSS text-transform uppercases visually but text node is "Legal"
    await waitFor(() => expect(screen.getByText("Legal")).toBeInTheDocument());
  });

  it("category label persists to localStorage", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Set category…"));
    const catInput = screen.getByPlaceholderText(/Finance/);
    fireEvent.change(catInput, { target: { value: "Finance" } });
    fireEvent.keyDown(catInput, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());
    const stored = JSON.parse(localStorage.getItem("artifact-categories::1") ?? "{}");
    expect(stored[1]).toBe("Finance");
  });

  // ── View switching ─────────────────────────────────────────────────────────

  it("By Integration view groups artifacts under a Google heading", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "By Integration" }));
    // google_docs → "Google" group
    expect(screen.getByText(/^Google/)).toBeInTheDocument();
    // file artifact → "Files" group
    expect(screen.getByText(/^Files/)).toBeInTheDocument();
  });

  it("By Category view shows Uncategorized group when no categories set", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "By Category" }));
    expect(screen.getByText(/Uncategorized/)).toBeInTheDocument();
  });

  it("By Category view groups artifacts by their assigned category", async () => {
    // Pre-seed localStorage
    localStorage.setItem("artifact-categories::1", JSON.stringify({ 1: "Legal" }));
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "By Category" }));
    // Group headers are uppercase-styled <p> elements — find by partial text content
    expect(screen.getAllByText(/Legal/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Uncategorized/).length).toBeGreaterThanOrEqual(1);
  });

  it("By Project view shows Unlinked group when no goals have this artifact in resources", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "By Project" }));
    expect(screen.getByText(/Unlinked/)).toBeInTheDocument();
  });

  it("By Project view groups artifact under a project that has it in resources", async () => {
    const goals: GoalSection[] = [
      {
        id: "goal-1",
        name: "Launch Plan",
        url: "",
        actionIds: [],
        meetingIds: [],
        goalIds: [],
        resources: [{ id: `artifact-${mockArtifact.id}`, label: mockArtifact.name, url: mockArtifact.url ?? "" }],
      },
    ];
    renderPanel({ goals });
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "By Project" }));
    expect(screen.getByText(/^Launch Plan/)).toBeInTheDocument();
  });

  // ── Drag ───────────────────────────────────────────────────────────────────

  it("artifact card is draggable", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const card = screen.getByText("Product Spec").closest("[draggable]")!;
    expect(card.getAttribute("draggable")).toBe("true");
  });

  // ── Description / creator / linked records ─────────────────────────────────

  it("edit modal offers a rich-text description field", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    expect(screen.getByText(/Description/)).toBeInTheDocument();
  });

  it("saving the edit modal PATCHes description and references", async () => {
    const seen: Record<string, unknown>[] = [];
    server.use(
      http.patch("/api/v1/accounts/artifacts/:id/", async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        seen.push(body);
        return HttpResponse.json({ ...mockArtifact, ...body });
      }),
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
        HttpResponse.json([{ ...mockArtifact, description: "<p>The source of truth</p>" }])
      ),
    );
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].description).toBe("<p>The source of truth</p>");
    expect(seen[0].references).toEqual([]);
  });

  it("shows who added the artifact on the card", async () => {
    renderPanel();
    // mockCodeArtifact was uploaded by alice; mockArtifact has no uploader.
    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
  });

  it("shows a used-in count when the artifact is referenced elsewhere", async () => {
    const usedIn: CommentReference[] = [
      { resource_type: "calendar_event", resource_id: 7, label: "Kickoff call", url: "/calendar" },
      { resource_type: "action_item", resource_id: 9, label: "Send SOW", url: "/action-items" },
    ];
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
        HttpResponse.json([{ ...mockArtifact, used_in: usedIn }])
      ),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("used in 2")).toBeInTheDocument());
  });

  it("the viewer lists the description, the creator and both link directions", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
        HttpResponse.json([{
          ...mockArtifact,
          description: "<p>Signed contract</p>",
          uploaded_by_username: "bob",
          references: [{ resource_type: "meeting", resource_id: 2, label: "Weekly sync", url: "/calendar" }],
          used_in: [{ resource_type: "project", resource_id: 3, label: "Segment rollout", url: "/accounts/1" }],
        }])
      ),
    );
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByText("Product Spec"));
    const panel = await screen.findByTestId("artifact-details");
    expect(panel).toHaveTextContent("Signed contract");
    expect(panel).toHaveTextContent("bob");
    expect(panel).toHaveTextContent("Mentions in description");
    expect(panel).toHaveTextContent("Weekly sync");
    expect(panel).toHaveTextContent("Used in");
    expect(panel).toHaveTextContent("Segment rollout");
  });

  it("the viewer omits the details panel when there is nothing to show", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByText("Product Spec"));
    await waitFor(() => expect(screen.getByText("Open in new tab ↗")).toBeInTheDocument());
    expect(screen.queryByTestId("artifact-details")).not.toBeInTheDocument();
  });

  it("dragstart sets artifactDrop data with artifact id and name", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const card = screen.getByText("Product Spec").closest("[draggable]")!;
    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData, types: [] } });
    expect(setData).toHaveBeenCalledWith(
      "artifactDrop",
      expect.stringContaining("Product Spec")
    );
  });
});

// ── Artifact images + file icon choice ───────────────────────────────────────

import { apiClient } from "../../../lib/api";
import { beforeAll, afterEach } from "vitest";

describe("ArtifactsPanel — images and file icons", () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  // jsdom stringifies FormData before MSW sees it, so capture the real object at the axios layer.
  let sent: Array<{ method?: string; url: string; data: unknown }> = [];
  let interceptorId = 0;
  beforeEach(() => {
    sent = [];
    interceptorId = apiClient.interceptors.request.use((config) => {
      if (config.method !== "get") sent.push({ method: config.method, url: String(config.url), data: config.data });
      return config;
    });
  });
  afterEach(() => apiClient.interceptors.request.eject(interceptorId));

  const png = () => new File(["png"], "cover.png", { type: "image/png" });
  const formOf = (urlPart: string) => sent.find((r) => r.url.includes(urlPart) && r.data instanceof FormData)?.data as FormData | undefined;

  it("picking a file opens the icon dialog instead of uploading straight away", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "plan.pdf", { type: "application/pdf" })] } });

    expect(await screen.findByTestId("upload-file-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("upload-icon-0-file_pdf")).toHaveAttribute("aria-pressed", "true");
    expect(sent.filter((r) => r.method === "post")).toHaveLength(0);
  });

  it("uploads with the chosen icon and the optional image", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "plan.pdf", { type: "application/pdf" })] } });
    await screen.findByTestId("upload-file-dialog");

    fireEvent.click(screen.getByTestId("upload-icon-0-file_slides"));
    const cover = png();
    fireEvent.change(screen.getByTestId("artifact-image-input"), { target: { files: [cover] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(formOf("/artifacts/")).toBeDefined());
    const fd = formOf("/artifacts/")!;
    expect(fd.get("icon_key")).toBe("file_slides");
    expect(fd.get("artifact_type")).toBe("file");
    expect((fd.get("custom_image") as File).name).toBe("cover.png");
    expect(screen.queryByTestId("upload-file-dialog")).not.toBeInTheDocument();
  });

  it("cancelling the dialog uploads nothing", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "plan.pdf", { type: "application/pdf" })] } });
    await screen.findByTestId("upload-file-dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("upload-file-dialog")).not.toBeInTheDocument();
    expect(sent.filter((r) => r.method === "post")).toHaveLength(0);
  });

  it("an artifact with an uploaded image shows it on its card", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
        HttpResponse.json([{ ...mockArtifact, image_url: "http://x/brand.png" }]),
      ),
    );
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const card = screen.getByText("Product Spec").closest("[draggable]")!;
    expect(card.querySelector('img[src="http://x/brand.png"]')).not.toBeNull();
  });

  it("an unrecognised link falls back to the site's favicon on its card", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
        HttpResponse.json([{ ...mockArtifact, url: "https://wiki.acme-corp.io/page", icon_key: "link", artifact_type: "link", mime_type: "" }]),
      ),
    );
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    const card = screen.getByText("Product Spec").closest("[draggable]")!;
    expect(card.querySelector("img")!.getAttribute("src")).toContain("domain=wiki.acme-corp.io");
  });

  it("the edit modal sends a replacement image as multipart", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    fireEvent.change(screen.getByTestId("artifact-image-input"), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(formOf("/accounts/artifacts/")).toBeDefined());
    expect((formOf("/accounts/artifacts/")!.get("custom_image") as File).name).toBe("cover.png");
  });

  it("removing a saved image sends remove_image", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () =>
        HttpResponse.json([{ ...mockArtifact, image_url: "http://x/brand.png" }]),
      ),
    );
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.contextMenu(screen.getByText("Product Spec").closest("[draggable]")!);
    fireEvent.click(screen.getByText("Edit artifact"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sent.some((r) => r.method === "patch")).toBe(true));
    const patch = sent.find((r) => r.method === "patch")!;
    expect((patch.data as { remove_image?: boolean }).remove_image).toBe(true);
  });

  it("the Add link modal sends the image along with the link", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "+ Link" }));
    fireEvent.change(screen.getByPlaceholderText("https://…"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByTestId("artifact-image-input"), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() => expect(formOf("/artifacts/")).toBeDefined());
    const fd = formOf("/artifacts/")!;
    expect(fd.get("url")).toBe("https://example.com");
    expect((fd.get("custom_image") as File).name).toBe("cover.png");
  });

  it("the Add link modal stays plain JSON when no image is chosen", async () => {
    renderPanel();
    await waitFor(() => screen.getByText("Product Spec"));
    fireEvent.click(screen.getByRole("button", { name: "+ Link" }));
    fireEvent.change(screen.getByPlaceholderText("https://…"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() => expect(sent.some((r) => r.method === "post")).toBe(true));
    expect(sent.find((r) => r.method === "post")!.data instanceof FormData).toBe(false);
  });
});
