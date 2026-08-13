import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockSyncReviewItem, mockSyncDeleteRequest } from "../../test/handlers/sync_review";

async function renderPage() {
  const { default: SyncReviewPage } = await import("../SyncReviewPage");
  render(
    <MemoryRouter>
      <SyncReviewPage />
    </MemoryRouter>
  );
}

describe("SyncReviewPage", () => {
  it("renders page heading and tabs", async () => {
    await renderPage();
    expect(screen.getByText("Sync Review Queue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review Items" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Requests" })).toBeInTheDocument();
  });

  it("shows loading state then displays review items", async () => {
    await renderPage();
    await waitFor(() => {
      const title = (mockSyncReviewItem.raw_content as Record<string, string>)["title"];
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });

  it("shows empty state when no items match filter", async () => {
    server.use(
      http.get("/api/v1/sync-review/items/", () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      )
    );
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("No items found.")).toBeInTheDocument();
    });
  });

  it("switches to Delete Requests tab and shows delete request", async () => {
    server.use(
      http.get("/api/v1/sync-review/delete-requests/", () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [mockSyncDeleteRequest] })
      )
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Requests" }));
    await waitFor(() => {
      expect(screen.getByText(`Delete Request #${mockSyncDeleteRequest.id}`)).toBeInTheDocument();
    });
  });

  it("shows empty delete requests state", async () => {
    server.use(
      http.get("/api/v1/sync-review/delete-requests/", () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      )
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Requests" }));
    await waitFor(() => {
      expect(screen.getByText("No pending delete requests.")).toBeInTheDocument();
    });
  });

  it("expands an item row and shows Accept/Reject buttons", async () => {
    await renderPage();
    const title = (mockSyncReviewItem.raw_content as Record<string, string>)["title"]!;
    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
    fireEvent.click(screen.getByText(title));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    });
  });
});
