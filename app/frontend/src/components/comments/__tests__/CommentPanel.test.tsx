import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockComment } from "../../../test/handlers/comments";
import { CurrentUserProvider } from "../../../context/CurrentUserContext";
import CommentPanel from "../CommentPanel";

function renderPanel(props?: Partial<React.ComponentProps<typeof CommentPanel>>) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <CurrentUserProvider>
        <CommentPanel
          resourceType="action_item"
          resourceId={10}
          resourceLabel="Test item"
          onClose={onClose}
          {...props}
        />
      </CurrentUserProvider>
    </MemoryRouter>
  );
  return { onClose };
}

describe("CommentPanel", () => {
  it("shows loading indicator initially", () => {
    renderPanel();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders comments after data loads", async () => {
    renderPanel();
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
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/No comments yet/)).toBeInTheDocument()
    );
  });

  it("calls onClose when X button is clicked", async () => {
    const { onClose } = renderPanel();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    // The close SVG button is the only button without text in the header
    const allButtons = screen.getAllByRole("button");
    const xButton = allButtons.find((btn) => btn.querySelector("svg"));
    if (xButton) fireEvent.click(xButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a comment on Enter keypress in composer", async () => {
    let postCount = 0;
    server.use(
      http.post("/api/v1/comments/comments/", () => {
        postCount++;
        return HttpResponse.json({ ...mockComment, id: 99, content: "Hello" });
      })
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );

    const textarea = screen.getByPlaceholderText(/Add a comment/);
    await userEvent.type(textarea, "Hello");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(postCount).toBe(1));
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
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("displays comment count in header", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    expect(screen.getByText(/1 comment/)).toBeInTheDocument();
  });

  it("counts replies in the header total", async () => {
    // A header reading "1 comment" on a thread with three replies understates it, and
    // disagrees with the badge on the card, which counts replies server-side.
    server.use(
      http.get("/api/v1/comments/comments/", () =>
        HttpResponse.json({
          results: [{
            ...mockComment,
            replies: [
              { ...mockComment, id: 2, parent: mockComment.id, content: "r1" },
              { ...mockComment, id: 3, parent: mockComment.id, content: "r2" },
            ],
          }],
          count: 1,
        })
      )
    );
    renderPanel();

    await waitFor(() => expect(screen.getByText("3 comments")).toBeInTheDocument());
  });

  it("keeps the count on one line no matter how long the record label is", async () => {
    // Regression: the label used to render inline after "Comments" with Tailwind
    // `truncate`, which is inert on an inline <span>. A long action-item title therefore
    // ran full width, squeezed the flex sibling to min-content, and rendered
    // "1 comment" one character per line, vertically.
    const longLabel =
      "Liz will follow up later today in Slack with what she thinks needs to be done, " +
      "including a diagram, and some tasks for Suresh to look at on his side.";
    renderPanel({ resourceLabel: longLabel });
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );

    const count = screen.getByText("1 comment");
    expect(count.className).toContain("whitespace-nowrap");
    // The count and the close button sit in a shrink-0 group, so the label cannot
    // squeeze them; the label itself lives in a min-w-0 column and clamps.
    expect(count.parentElement?.className).toContain("shrink-0");

    const label = screen.getByTitle(longLabel);
    expect(label.tagName).toBe("P");
    expect(label).toHaveStyle({ overflow: "hidden" });
    expect(label.parentElement?.className).toContain("min-w-0");
  });

  it("wraps long unbroken comment content instead of scrolling sideways", async () => {
    server.use(
      http.get("/api/v1/comments/comments/", () =>
        HttpResponse.json({
          results: [{ ...mockComment, content: "supercalifragilisticexpialidocious".repeat(6) }],
          count: 1,
        })
      )
    );
    renderPanel();

    const body = await waitFor(() =>
      screen.getByText("supercalifragilisticexpialidocious".repeat(6))
    );
    expect(body).toHaveStyle({ overflowWrap: "anywhere" });
  });

  it("does not leave a focus outline on the close button", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    );
    const close = screen.getByRole("button", { name: "Close comments" });
    expect(close.className).toContain("focus-visible:outline-none");
  });
});
