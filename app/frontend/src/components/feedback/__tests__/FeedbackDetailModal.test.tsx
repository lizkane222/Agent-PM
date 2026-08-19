import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockFeedbackItems } from "../../../test/handlers/feedback";
import FeedbackDetailModal from "../FeedbackDetailModal";
import type { FeedbackComment, FeedbackItem } from "../../../types";

const COMMENTS_PATH = "/api/v1/feedback/comments/";

const existingComment: FeedbackComment = {
  id: 5,
  feedback: 1,
  author: 1,
  author_username: "alice",
  author_display: "Alice Smith",
  content: "Reproduced on staging",
  created_at: "2026-07-11T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
};

function renderModal(item: FeedbackItem = mockFeedbackItems[0]) {
  render(<FeedbackDetailModal item={item} onClose={vi.fn()} />);
}

function newCommentBox() {
  return screen.getByPlaceholderText(/Add a comment or update/i);
}

describe("FeedbackDetailModal — Enter posts a comment", () => {
  it("posts on a bare Enter, with no click on Post", async () => {
    let body: unknown = "not called";
    server.use(
      http.post(COMMENTS_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...existingComment, id: 9, content: "Still happening" });
      })
    );

    renderModal();
    const box = newCommentBox();
    fireEvent.change(box, { target: { value: "Still happening" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(body).not.toBe("not called"));
    expect(body).toEqual({ feedback: 1, content: "Still happening" });
    expect(await screen.findByText("Still happening")).toBeInTheDocument();
  });

  it("does not post on Shift+Enter — that inserts a newline", async () => {
    let calls = 0;
    server.use(http.post(COMMENTS_PATH, () => { calls += 1; return HttpResponse.json(existingComment); }));

    renderModal();
    const box = newCommentBox();
    fireEvent.change(box, { target: { value: "Line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });

  it("does not post an empty comment on Enter", async () => {
    let calls = 0;
    server.use(http.post(COMMENTS_PATH, () => { calls += 1; return HttpResponse.json(existingComment); }));

    renderModal();
    fireEvent.keyDown(newCommentBox(), { key: "Enter" });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });

  it("still posts when the Post button is clicked", async () => {
    let calls = 0;
    server.use(
      http.post(COMMENTS_PATH, () => {
        calls += 1;
        return HttpResponse.json({ ...existingComment, id: 10, content: "Clicked instead" });
      })
    );

    renderModal();
    fireEvent.change(newCommentBox(), { target: { value: "Clicked instead" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(calls).toBe(1));
  });
});

describe("FeedbackDetailModal — Enter saves a comment edit", () => {
  const withComment: FeedbackItem = {
    ...mockFeedbackItems[0],
    comments: [existingComment],
    comment_count: 1,
  };

  function openEditor() {
    renderModal(withComment);
    fireEvent.click(screen.getByTitle("Edit comment"));
    return screen.getByDisplayValue("Reproduced on staging");
  }

  it("PATCHes on a bare Enter", async () => {
    let body: unknown = "not called";
    server.use(
      http.patch(`${COMMENTS_PATH}:id/`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...existingComment, content: "Reproduced on prod too" });
      })
    );

    const box = openEditor();
    fireEvent.change(box, { target: { value: "Reproduced on prod too" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(body).not.toBe("not called"));
    expect(body).toEqual({ content: "Reproduced on prod too" });
  });

  it("does not PATCH on Shift+Enter", async () => {
    let calls = 0;
    server.use(http.patch(`${COMMENTS_PATH}:id/`, () => { calls += 1; return HttpResponse.json(existingComment); }));

    const box = openEditor();
    fireEvent.change(box, { target: { value: "Line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });

  it("Escape closes the editor without saving", async () => {
    let calls = 0;
    server.use(http.patch(`${COMMENTS_PATH}:id/`, () => { calls += 1; return HttpResponse.json(existingComment); }));

    const box = openEditor();
    fireEvent.change(box, { target: { value: "Discard me" } });
    fireEvent.keyDown(box, { key: "Escape" });

    await waitFor(() => expect(screen.queryByDisplayValue("Discard me")).not.toBeInTheDocument());
    expect(calls).toBe(0);
  });
});
