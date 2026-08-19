/**
 * The one comment affordance. Covers the count badge, the panel it opens, the
 * suppressed focus ring, and the `disabled` escape hatch for records with no PK.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { CurrentUserProvider } from "../../../context/CurrentUserContext";
import { CommentProvider } from "../CommentContext";
import CommentTrigger from "../CommentTrigger";
import CommentCountBadge from "../CommentCountBadge";
import { commentMenuItem } from "../commentMenuItem";
import { resetCommentSummaries } from "../../../lib/commentSummaryStore";
import { resetRequestCache } from "../../../lib/requestCache";

const SUMMARY_URL = "/api/v1/comments/comments/summary/";

function withCount(count: number) {
  server.use(
    http.get(SUMMARY_URL, () =>
      HttpResponse.json({ results: { "10": { count, comments: [] } } })
    )
  );
}

function wrap(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <CurrentUserProvider>
        <CommentProvider>{node}</CommentProvider>
      </CurrentUserProvider>
    </MemoryRouter>
  );
}

describe("CommentTrigger", () => {
  beforeEach(() => {
    resetCommentSummaries();
    resetRequestCache();
  });

  it('reads "Add a comment" when the record has none', async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));
    wrap(<CommentTrigger resourceType="action_item" resourceId={10} resourceLabel="Task" />);

    expect(screen.getByRole("button", { name: "Add a comment" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("button", { name: "Add a comment" })).toBeInTheDocument();
  });

  it("shows the count once the rollup lands", async () => {
    withCount(3);
    wrap(<CommentTrigger resourceType="action_item" resourceId={10} resourceLabel="Task" />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Comments (3)" })).toBeInTheDocument()
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("suppresses the global focus-visible outline", () => {
    // index.css applies `*:focus-visible { outline: 2px solid … }`, which on a small
    // round icon button reads as an unexplained blue ring left on the record.
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));
    wrap(<CommentTrigger resourceType="action_item" resourceId={10} />);

    const btn = screen.getByRole("button", { name: "Add a comment" });
    expect(btn.className).toContain("focus:outline-none");
    expect(btn.className).toContain("focus-visible:outline-none");
  });

  it("opens the comment panel with the record's label", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));
    wrap(
      <CommentTrigger resourceType="action_item" resourceId={10} resourceLabel="Follow up in Slack" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Add a comment" }));

    await waitFor(() => expect(screen.getByText("Comments")).toBeInTheDocument());
    expect(screen.getByText("Follow up in Slack")).toBeInTheDocument();
  });

  it("renders nothing when disabled, and asks for no rollup", async () => {
    let called = false;
    server.use(
      http.get(SUMMARY_URL, () => {
        called = true;
        return HttpResponse.json({ results: {} });
      })
    );
    wrap(<CommentTrigger resourceType="action_item" resourceId={10} disabled />);
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("renders nothing without an id", () => {
    wrap(<CommentTrigger resourceType="action_item" resourceId={null} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("CommentCountBadge", () => {
  beforeEach(() => {
    resetCommentSummaries();
    resetRequestCache();
  });

  it("renders nothing when the record has no comments", async () => {
    server.use(http.get(SUMMARY_URL, () => HttpResponse.json({ results: {} })));
    wrap(<CommentCountBadge resourceType="calendar_event" resourceId={10} />);
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByTestId("comment-count-badge")).not.toBeInTheDocument();
  });

  it("renders a plain span (no nested button) with the count", async () => {
    withCount(2);
    wrap(<CommentCountBadge resourceType="calendar_event" resourceId={10} />);

    const badge = await waitFor(() => screen.getByTestId("comment-count-badge"));
    expect(badge.tagName).toBe("SPAN");
    expect(badge).toHaveAttribute("title", "2 comments");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("commentMenuItem", () => {
  it('reads "Add comment" with no count', () => {
    expect(commentMenuItem(() => {}).label).toBe("Add comment");
    expect(commentMenuItem(() => {}, 0).label).toBe("Add comment");
  });

  it("carries the count when there is one", () => {
    expect(commentMenuItem(() => {}, 1).label).toBe("Comments (1)");
    expect(commentMenuItem(() => {}, 12).label).toBe("Comments (12)");
  });

  it("passes the click handler straight through", () => {
    let hits = 0;
    commentMenuItem(() => { hits += 1; }, 2).onClick();
    expect(hits).toBe(1);
  });
});
