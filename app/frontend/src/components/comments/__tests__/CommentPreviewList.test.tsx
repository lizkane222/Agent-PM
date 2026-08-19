import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { CurrentUserProvider } from "../../../context/CurrentUserContext";
import { CommentProvider } from "../CommentContext";
import CommentPreviewList from "../CommentPreviewList";
import { resetCommentSummaries } from "../../../lib/commentSummaryStore";
import { resetRequestCache } from "../../../lib/requestCache";
import type { CommentPreview } from "../../../types";

const SUMMARY_URL = "/api/v1/comments/comments/summary/";

function preview(id: number, author: string, content: string): CommentPreview {
  return {
    id,
    resource_id: 10,
    author: id,
    author_display: author,
    content,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function summary(count: number, comments: CommentPreview[]) {
  server.use(
    http.get(SUMMARY_URL, () => HttpResponse.json({ results: { "10": { count, comments } } }))
  );
}

function renderList(props?: Partial<React.ComponentProps<typeof CommentPreviewList>>) {
  return render(
    <MemoryRouter>
      <CurrentUserProvider>
        <CommentProvider>
          <CommentPreviewList
            resourceType="action_item"
            resourceId={10}
            resourceLabel="Follow up in Slack"
            {...props}
          />
        </CommentProvider>
      </CurrentUserProvider>
    </MemoryRouter>
  );
}

describe("CommentPreviewList", () => {
  beforeEach(() => {
    resetCommentSummaries();
    resetRequestCache();
  });

  it("renders nothing while the rollup is still loading", () => {
    renderList();
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();
  });

  it("renders nothing for a record with no comments", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));
    renderList();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();
  });

  it("shows each returned comment with its author", async () => {
    summary(2, [preview(1, "Liz Kane", "need to add diagram as artifact"), preview(2, "Suresh", "on it")]);
    renderList();

    await waitFor(() =>
      expect(screen.getByText("need to add diagram as artifact")).toBeInTheDocument()
    );
    expect(screen.getByText("on it")).toBeInTheDocument();
    expect(screen.getByText("Liz Kane:")).toBeInTheDocument();
    expect(screen.getByText("Suresh:")).toBeInTheDocument();
  });

  it("summarises the comments the server capped out of the preview", async () => {
    summary(7, [preview(1, "A", "one"), preview(2, "B", "two"), preview(3, "C", "three")]);
    renderList();

    await waitFor(() => expect(screen.getByText("+4 more comments")).toBeInTheDocument());
  });

  it("singularises the overflow label", async () => {
    summary(4, [preview(1, "A", "one"), preview(2, "B", "two"), preview(3, "C", "three")]);
    renderList();

    await waitFor(() => expect(screen.getByText("+1 more comment")).toBeInTheDocument());
  });

  it("offers 'View thread' when nothing is hidden", async () => {
    summary(1, [preview(1, "A", "only one")]);
    renderList();

    await waitFor(() => expect(screen.getByText("View thread")).toBeInTheDocument());
  });

  it("opens the global comment panel when the affordance is clicked", async () => {
    summary(1, [preview(1, "A", "only one")]);
    renderList();

    await waitFor(() => expect(screen.getByText("View thread")).toBeInTheDocument());
    await userEvent.click(screen.getByText("View thread"));

    // The panel header carries the record label the preview was given.
    await waitFor(() => expect(screen.getByText("Comments")).toBeInTheDocument());
    expect(screen.getAllByText("Follow up in Slack").length).toBeGreaterThan(0);
  });

  it("prefers an explicit onOpen over the global panel", async () => {
    summary(1, [preview(1, "A", "only one")]);
    let opened = false;
    renderList({ onOpen: () => { opened = true; } });

    await waitFor(() => expect(screen.getByText("View thread")).toBeInTheDocument());
    await userEvent.click(screen.getByText("View thread"));

    expect(opened).toBe(true);
    expect(screen.queryByText("Comments")).not.toBeInTheDocument();
  });

  it("renders the overflow as plain text when not interactive", async () => {
    // Nested <button> is invalid HTML, so rows that are themselves buttons opt out.
    summary(5, [preview(1, "A", "one")]);
    renderList({ interactive: false });

    await waitFor(() => expect(screen.getByText("+4 more comments")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+4 more comments" })).not.toBeInTheDocument();
  });

  it("sends no request when there is no id to ask about", async () => {
    let called = false;
    server.use(
      http.get(SUMMARY_URL, () => {
        called = true;
        return HttpResponse.json({ results: {} });
      })
    );
    renderList({ resourceId: null });
    await new Promise((r) => setTimeout(r, 20));

    expect(called).toBe(false);
    expect(screen.queryByTestId("comment-preview-list")).not.toBeInTheDocument();
  });
});
