import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockComment } from "../../../test/handlers/comments";
import { CurrentUserProvider } from "../../../context/CurrentUserContext";
import InlineCommentThread from "../InlineCommentThread";

function renderThread(props?: Partial<React.ComponentProps<typeof InlineCommentThread>>) {
  render(
    <MemoryRouter>
      <CurrentUserProvider>
        <InlineCommentThread
          resourceType="action_item"
          resourceId={10}
          resourceLabel="Test item"
          {...props}
        />
      </CurrentUserProvider>
    </MemoryRouter>
  );
}

describe("InlineCommentThread", () => {
  it("shows loading indicator initially", () => {
    renderThread();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders comments after data loads", async () => {
    renderThread();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    expect(screen.getByText(mockComment.content)).toBeInTheDocument();
    expect(screen.getByText(mockComment.author_display)).toBeInTheDocument();
  });

  it("shows empty state when no comments", async () => {
    server.use(
      http.get("/api/v1/comments/comments/", () =>
        HttpResponse.json({ results: [], count: 0 })
      )
    );
    renderThread();
    await waitFor(() =>
      expect(screen.getByText(/No comments yet/)).toBeInTheDocument()
    );
  });

  it("shows section label when resourceLabel is provided", async () => {
    renderThread({ resourceLabel: "My Task" });
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/Comments · My Task/)).toBeInTheDocument();
  });

  it("compact mode: hides section label, shows 'New Comments' header", async () => {
    renderThread({ compact: true });
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    expect(screen.getByText("New Comments")).toBeInTheDocument();
    expect(screen.queryByText(/Comments ·/)).not.toBeInTheDocument();
  });

  it("renders URL in comment content as a clickable link", async () => {
    server.use(
      http.get("/api/v1/comments/comments/", () =>
        HttpResponse.json({
          results: [{ ...mockComment, content: "See https://example.com for details" }],
          count: 1,
        })
      )
    );
    renderThread();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("adds a comment on Enter keypress", async () => {
    let postCount = 0;
    server.use(
      http.post("/api/v1/comments/comments/", () => {
        postCount++;
        return HttpResponse.json({ ...mockComment, id: 99, content: "Inline reply" });
      })
    );
    renderThread();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );

    const textarea = screen.getByPlaceholderText(/Add a comment/);
    await userEvent.type(textarea, "Inline reply");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(postCount).toBe(1));
  });
});
