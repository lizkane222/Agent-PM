import { http, HttpResponse } from "msw";
import type { FeedbackItem } from "../../types";

export const mockFeedbackItems: FeedbackItem[] = [
  {
    id: 1,
    author: 1,
    author_username: "alice",
    author_display: "Alice Smith",
    description: "The reminders page loads slowly on initial visit.",
    element_label: "RemindersPage",
    element_path: "/reminders",
    page_url: "/reminders",
    attachment: null,
    status: "open",
    comments: [],
    comment_count: 0,
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
  },
];

export const feedbackHandlers = [
  http.get("/api/v1/feedback/feedback/", () =>
    HttpResponse.json({ results: mockFeedbackItems, count: mockFeedbackItems.length })
  ),
];
