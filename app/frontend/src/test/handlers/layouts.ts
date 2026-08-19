import { http, HttpResponse } from "msw";
import type { PageLayout, UserPageNote, WorkingSession } from "../../types";

export const mockPageLayout = (overrides: Partial<PageLayout> = {}): PageLayout => ({
  id: 1,
  name: "Test layout",
  creator: 1,
  creator_name: "lizkane",
  forked_from: null,
  forked_from_name: null,
  nodes: [],
  is_public: false,
  heart_count: 0,
  fork_count: 0,
  hearted: false,
  pinned: true,
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
  ...overrides,
});

export const mockWorkingSession = (
  overrides: Partial<WorkingSession> = {},
): WorkingSession => ({
  id: 1,
  owner: 1,
  owner_username: "lizkane",
  name: "Test session",
  canvas_nodes: [],
  record_refs: [],
  airtable_id: "",
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
  ...overrides,
});

export const mockUserPageNote = (overrides: Partial<UserPageNote> = {}): UserPageNote => ({
  id: 1,
  owner: 1,
  owner_username: "lizkane",
  content: "",
  account_ref_label: "",
  created_at: "2026-08-18T00:00:00Z",
  updated_at: "2026-08-18T00:00:00Z",
  ...overrides,
});

/**
 * DRF envelope, as returned by a plain ModelViewSet inheriting the global
 * PageNumberPagination. Exported so tests can assert against the shape the live
 * server actually sends rather than a convenient bare array.
 */
export const layoutsPage = <T>(results: T[]) =>
  HttpResponse.json({ count: results.length, next: null, previous: null, results });

export const layoutsHandlers = [
  // `pinned/` is a custom @action returning `Response(serializer.data)` — a BARE
  // array, unlike its sibling routes below. This asymmetry is real and is what
  // made the enveloped endpoints easy to mistype; keep both shapes represented
  // here so page tests exercise the same mix production does.
  http.get("/api/v1/layouts/pinned/", () => HttpResponse.json([])),

  // Plain ModelViewSets → paginated envelope.
  http.get("/api/v1/layouts/working-sessions/", () => layoutsPage<WorkingSession>([])),
  http.get("/api/v1/layouts/page-notes/", () => layoutsPage<UserPageNote>([])),
  http.get("/api/v1/layouts/", () => layoutsPage<PageLayout>([])),

  http.post("/api/v1/layouts/working-sessions/", async ({ request }) => {
    const body = await request.json() as Partial<WorkingSession>;
    return HttpResponse.json(mockWorkingSession({ ...body, id: 99 }), { status: 201 });
  }),
  http.patch("/api/v1/layouts/working-sessions/:id/", async ({ request }) => {
    const body = await request.json() as Partial<WorkingSession>;
    return HttpResponse.json(mockWorkingSession(body));
  }),
  http.delete("/api/v1/layouts/working-sessions/:id/", () =>
    new HttpResponse(null, { status: 204 })),

  http.post("/api/v1/layouts/page-notes/", async ({ request }) => {
    const body = await request.json() as Partial<UserPageNote>;
    return HttpResponse.json(mockUserPageNote({ ...body, id: 99 }), { status: 201 });
  }),
  http.patch("/api/v1/layouts/page-notes/:id/", async ({ request }) => {
    const body = await request.json() as Partial<UserPageNote>;
    return HttpResponse.json(mockUserPageNote(body));
  }),
  http.delete("/api/v1/layouts/page-notes/:id/", () =>
    new HttpResponse(null, { status: 204 })),
];
