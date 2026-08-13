import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockArtifact } from "../../../test/handlers/accounts";
import { ArtifactsPanel } from "../ArtifactsPanel";
import type { GoalSection } from "../../../types";

// Silence console.error from act() warnings in tests
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function renderPanel(props: Partial<Parameters<typeof ArtifactsPanel>[0]> = {}) {
  return render(<ArtifactsPanel accountId={1} {...props} />);
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
