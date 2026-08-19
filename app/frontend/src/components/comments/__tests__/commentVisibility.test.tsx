/**
 * The reported bug, end to end: "I've commented on this action item but for some reason
 * it's not displaying on the action item until I click on the comment icon."
 *
 * The card's preview and the panel's thread are two independent subscribers to the same
 * server fact. Before `lib/commentSummaryStore` existed there was nothing to tell the
 * card that the panel had posted, so the card only refreshed on remount.
 *
 * Rendered together here — a record with a comment trigger and an inline preview, plus
 * the global CommentProvider that owns the panel — so the wiring is covered as the user
 * experiences it rather than one component at a time.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockComment } from "../../../test/handlers/comments";
import { CurrentUserProvider } from "../../../context/CurrentUserContext";
import { CommentProvider } from "../CommentContext";
import CommentPreviewList from "../CommentPreviewList";
import CommentTrigger from "../CommentTrigger";
import { resetCommentSummaries } from "../../../lib/commentSummaryStore";
import { resetRequestCache } from "../../../lib/requestCache";
import type { Comment } from "../../../types";

const SUMMARY_URL = "/api/v1/comments/comments/summary/";
const LIST_URL = "/api/v1/comments/comments/";

/** A record card: comment icon in its header, latest comments in its body. */
function Card() {
  return (
    <div>
      <CommentTrigger resourceType="action_item" resourceId={10} resourceLabel="Follow up in Slack" />
      <CommentPreviewList
        resourceType="action_item"
        resourceId={10}
        resourceLabel="Follow up in Slack"
      />
    </div>
  );
}

function renderCard() {
  return render(
    <MemoryRouter>
      <CurrentUserProvider>
        <CommentProvider>
          <Card />
        </CommentProvider>
      </CurrentUserProvider>
    </MemoryRouter>
  );
}

describe("comment visibility on a record", () => {
  beforeEach(() => {
    resetCommentSummaries();
    resetRequestCache();
  });

  it("a comment posted in the panel appears on the record without reopening it", async () => {
    // Server state, shared by the thread route and the rollup route.
    const thread: Comment[] = [];
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ results: thread, count: thread.length })),
      http.post(LIST_URL, async ({ request }) => {
        const body = (await request.json()) as { content: string };
        const created: Comment = {
          ...mockComment,
          id: thread.length + 1,
          content: body.content,
          author_display: "Liz Kane",
        };
        thread.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get(SUMMARY_URL, () =>
        HttpResponse.json({
          results: thread.length
            ? {
                "10": {
                  count: thread.length,
                  comments: thread.map((c) => ({
                    id: c.id,
                    resource_id: 10,
                    author: c.author,
                    author_display: c.author_display,
                    content: c.content,
                    created_at: c.created_at,
                  })),
                },
              }
            : {},
        })
      )
    );

    renderCard();

    // Nothing on the record to begin with.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add a comment" })).toBeInTheDocument()
    );
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();

    // Open the panel and post.
    await userEvent.click(screen.getByRole("button", { name: "Add a comment" }));
    const composer = await waitFor(() => screen.getByPlaceholderText(/Add a comment/));
    await userEvent.type(composer, "need to add diagram as artifact");
    await userEvent.keyboard("{Enter}");

    // The record itself now shows the comment and the count, with no remount.
    await waitFor(() =>
      expect(screen.getByTestId("comment-preview-list")).toBeInTheDocument()
    );
    expect(
      screen.getByTestId("comment-preview-list")
    ).toHaveTextContent("need to add diagram as artifact");
    expect(screen.getByRole("button", { name: "Comments (1)" })).toBeInTheDocument();
  });

  it("deleting the last comment clears the record's preview and badge", async () => {
    // author must match mockUserProfile.id — CommentPanel only offers Edit/Delete on
    // your own comments.
    let thread: Comment[] = [{ ...mockComment, author: 1, author_display: "Alice Smith" }];
    server.use(
      http.get(LIST_URL, () => HttpResponse.json({ results: thread, count: thread.length })),
      http.delete(`${LIST_URL}:id/`, () => {
        thread = [];
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(SUMMARY_URL, () =>
        HttpResponse.json({
          results: thread.length
            ? {
                "10": {
                  count: thread.length,
                  comments: thread.map((c) => ({
                    id: c.id,
                    resource_id: 10,
                    author: c.author,
                    author_display: c.author_display,
                    content: c.content,
                    created_at: c.created_at,
                  })),
                },
              }
            : {},
        })
      )
    );

    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Comments (1)" })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: "Comments (1)" }));
    // The content shows up twice once the panel is open (card preview + thread), so
    // assert on the Delete affordance the panel adds rather than on the text.
    const del = await waitFor(() => screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(del);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add a comment" })).toBeInTheDocument()
    );
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();
  });
});
