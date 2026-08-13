import { http, HttpResponse } from "msw";
import type { SyncDeleteRequest, SyncReviewItem } from "../../types";

export const mockSyncReviewItem: SyncReviewItem = {
  id: 1,
  source: "confluence",
  source_id: "page-001",
  source_url: "https://example.atlassian.net/wiki/page-001",
  content_type: "page",
  raw_content: { title: "Q3 Launch Plan" },
  status: "pending_human",
  suggested_account: 1,
  suggested_account_name: "Acme Corp",
  confidence_score: 0.75,
  claude_analysis: "High relevance based on name matches.",
  is_sensitive: false,
  reviewed_by: null,
  reviewed_by_email: null,
  reviewed_at: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

export const mockSyncDeleteRequest: SyncDeleteRequest = {
  id: 1,
  review_item: 1,
  account: 1,
  account_name: "Acme Corp",
  requested_by: 2,
  requested_by_email: "reviewer@example.com",
  status: "pending",
  reviewed_by: null,
  reviewed_by_email: null,
  reason: "Wrong account",
  claude_mismatch_analysis: "",
  created_at: "2026-08-01T00:00:00Z",
  resolved_at: null,
};

const ITEMS_URL = "/api/v1/sync-review/items/";
const DELETE_REQUESTS_URL = "/api/v1/sync-review/delete-requests/";

export const syncReviewHandlers = [
  http.get(ITEMS_URL, () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [mockSyncReviewItem] })
  ),
  http.get(`${ITEMS_URL}pending-count/`, () =>
    HttpResponse.json({ count: 1 })
  ),
  http.patch(`${ITEMS_URL}:id/accept/`, () =>
    HttpResponse.json({ ...mockSyncReviewItem, status: "accepted" })
  ),
  http.patch(`${ITEMS_URL}:id/reject/`, () =>
    HttpResponse.json({ ...mockSyncReviewItem, status: "rejected" })
  ),
  http.patch(`${ITEMS_URL}:id/reassign/`, () =>
    HttpResponse.json({ ...mockSyncReviewItem, status: "pending_human" })
  ),
  http.post(`${ITEMS_URL}:id/request-delete/`, () =>
    HttpResponse.json(mockSyncDeleteRequest, { status: 201 })
  ),
  http.get(DELETE_REQUESTS_URL, () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [mockSyncDeleteRequest] })
  ),
  http.patch(`${DELETE_REQUESTS_URL}:id/resolve/`, () =>
    HttpResponse.json({ ...mockSyncDeleteRequest, status: "approved" })
  ),
];
