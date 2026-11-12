import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect, vi } from "vitest";
import { server } from "../../../test/msw-server";
import { mockArtifact } from "../../../test/handlers/accounts";

const reportError = vi.fn();
vi.mock("../../../context/AppErrorContext", () => ({ useAppError: () => ({ reportError }) }));
vi.mock("../../shared/RichTextMentionEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="description" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("../../shared/LinkedRecordsList", () => ({ default: () => null }));

import { ArtifactDetailsRail } from "../ArtifactDetailsRail";

const art = { ...mockArtifact, uploaded_by: 1, uploaded_by_username: "alice", description: "<p>old</p>" };

describe("ArtifactDetailsRail", () => {
  it("is read-only without edit permission", () => {
    render(<ArtifactDetailsRail artifact={art} canEdit={false} onUpdated={vi.fn()} />);
    expect(screen.queryByTestId("artifact-edit-btn")).toBeNull();
    expect(screen.getByTestId("artifact-details")).toHaveTextContent("old");
  });

  it("shows 'Updated by' with the date when the artifact has been edited", () => {
    render(<ArtifactDetailsRail artifact={{ ...art, updated_by: 2, updated_by_username: "bob", updated_at: "2026-03-05T12:00:00Z" }} canEdit={false} onUpdated={vi.fn()} />);
    expect(screen.getByTestId("artifact-updated-by")).toHaveTextContent(/Updated by bob · .*2026/);
  });

  it("hides 'Updated by' for a never-edited artifact", () => {
    render(<ArtifactDetailsRail artifact={art} canEdit={false} onUpdated={vi.fn()} />);
    expect(screen.queryByTestId("artifact-updated-by")).toBeNull();
  });

  it("PATCHes name, url, category and description, then reports the saved artifact", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(http.patch("/api/v1/accounts/artifacts/:id/", async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...art, ...body, updated_by: 1, updated_by_username: "alice" });
    }));
    const onUpdated = vi.fn();
    render(<ArtifactDetailsRail artifact={art} canEdit onUpdated={onUpdated} />);
    fireEvent.click(screen.getByTestId("artifact-edit-btn"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://example.com/new" } });
    fireEvent.click(screen.getByTestId("artifact-edit-icon-slack"));
    fireEvent.change(screen.getByLabelText("description"), { target: { value: "<p>new</p>" } });
    fireEvent.click(screen.getByTestId("artifact-save-btn"));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(body).toMatchObject({ name: "Renamed", url: "https://example.com/new", icon_key: "slack", description: "<p>new</p>", references: [] });
    expect(onUpdated.mock.calls[0][0].name).toBe("Renamed");
    expect(screen.queryByTestId("artifact-save-btn")).toBeNull();
  });

  it("surfaces a failed save and keeps the form open", async () => {
    reportError.mockClear();
    server.use(http.patch("/api/v1/accounts/artifacts/:id/", () => HttpResponse.json({ detail: "nope" }, { status: 403 })));
    const onUpdated = vi.fn();
    render(<ArtifactDetailsRail artifact={art} canEdit onUpdated={onUpdated} />);
    fireEvent.click(screen.getByTestId("artifact-edit-btn"));
    fireEvent.click(screen.getByTestId("artifact-save-btn"));
    await waitFor(() => expect(reportError).toHaveBeenCalledWith(expect.stringContaining("nope")));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByTestId("artifact-save-btn")).toBeInTheDocument();
  });

  it("refuses an empty name or link URL without calling the API", () => {
    reportError.mockClear();
    render(<ArtifactDetailsRail artifact={art} canEdit onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTestId("artifact-edit-btn"));
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("artifact-save-btn"));
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("URL"));
  });
});
