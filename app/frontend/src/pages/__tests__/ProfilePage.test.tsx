import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, configure, cleanup, within, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http } from "msw";
import { server } from "../../test/msw-server";
import ProfilePage, { nextFreeSlot, reminderWindow, visibleReminder } from "../ProfilePage";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { CommentProvider } from "../../components/comments/CommentContext";
import { mockActionItem } from "../../test/handlers/action_items";
import { mockAgentSkill } from "../../test/handlers/skills";
import { mockArtifact, mockAccount, mockTicket, mockTicketToReview } from "../../test/handlers/accounts";
import { mockReminders } from "../../test/handlers/scheduler";
import { mockUserProfile } from "../../test/handlers/team";
import { mockComment } from "../../test/handlers/comments";
import { EXPORT_ITEM_DRAG_KEY } from "../../components/ExportBar";
import { layoutsPage, mockWorkingSession, mockUserPageNote } from "../../test/handlers/layouts";
import { mockMemberProfile, mockPublicItem, mockNotification, mockAllocation } from "../../test/handlers/profile";

// ActionItemModal imports an SVG as a component (`?react`), which the test transform cannot do.
// Its own test file mocks it the same way.
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

const trayItem = {
  id: "action_item:recABC",
  type: "action_item",
  label: "Follow up with the security team on SOC2 evidence for the renewal",
  summary: "In Progress · High",
  content: "full content",
  accountName: "Acme Corp",
  accent: "#0263E0",
};

/** jsdom has no DataTransfer; RTL forwards whatever object we give it. */
function trayDataTransfer(item: unknown = trayItem) {
  return {
    types: [EXPORT_ITEM_DRAG_KEY],
    dropEffect: "none",
    getData: (key: string) => (key === EXPORT_ITEM_DRAG_KEY ? JSON.stringify(item) : ""),
  };
}

/**
 * Let the mount-time requests finish before a test returns. The page fires ~14 GETs on
 * mount; if one outlives the test it lands in lib/requestCache.ts *after* the
 * afterEach reset, and the next test is served that stale default instead of its own
 * server.use() override.
 */
async function requestCacheIdle() {
  const { requestCacheStats } = await import("../../lib/requestCache");
  const { requestSemaphore } = await import("../../lib/rateLimit");
  // Two places a request can still be pending: running (the coalescing map) or waiting its turn
  // behind the client's 6-wide concurrency cap. Only counting the first let queued requests start
  // after the next test had begun, and land in its cache — a failure that only showed up when the
  // whole suite was loading the machine.
  const busy = () =>
    requestCacheStats().inFlight > 0 || requestSemaphore.inFlight > 0 || requestSemaphore.queued > 0;
  for (let i = 0; i < 400 && busy(); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function settle() {
  await waitFor(() => {
    expect(screen.getByText("Working Sessions")).toBeInTheDocument();
    expect(screen.getByText("Team handbook")).toBeInTheDocument();
    expect(screen.getByText(/⏰ Call Acme/)).toBeInTheDocument();
  });
}

function renderProfilePage(path = "/profile") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CurrentUserProvider>
       <AppErrorProvider>
        <CommentProvider>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:memberId" element={<ProfilePage />} />
          <Route path="/team" element={<div>team page</div>} />
          <Route path="/edit-preview" element={<div>full builder</div>} />
        </Routes>
        </CommentProvider>
       </AppErrorProvider>
      </CurrentUserProvider>
    </MemoryRouter>,
  );
}

// ~14 mount requests behind a 6-wide client cap: the default 1s waitFor is too tight under load.
configure({ asyncUtilTimeout: 4000 });

describe("ProfilePage", () => {
  /**
   * Unscoped, like the profile page: a role page covers the whole book of business.
   * It lives in the My Skills *header* rather than the body, which is gated on
   * skills.length and would hide it for a role with no Claude skills — as here.
   *
   * Queried by title, not role: CollapsibleSection's header is itself a <button>, so
   * its accessible name absorbs the nested button's text and getByRole finds two.
   */
  beforeEach(() => localStorage.clear());

  // Every test leaves ~14 mount requests behind. If they finish after the global
  // afterEach has reset lib/requestCache.ts they repopulate it, and the next test is
  // served those stale defaults instead of its own server.use() override. Draining
  // here — before the global reset — keeps each test's responses its own.
  afterEach(async () => {
    // Unmount first: while the page is mounted it can start new requests after the drain
    // looked, and those would finish once the global reset has already run.
    cleanup();
    await requestCacheIdle();
  });

  it("no longer offers GET Meeting Notes — the backend imports notes on its own", async () => {
    renderProfilePage();
    await screen.findByRole("button", { name: /Collapse My Skills/ });
    expect(screen.queryByTitle(/all of your accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /GET Meeting Notes/i })).not.toBeInTheDocument();
    await settle();
  });

  it("renders with no working sessions", async () => {
    renderProfilePage();
    await waitFor(() =>
      expect(screen.getByText("LAYOUTS")).toBeInTheDocument());
  });

  /**
   * Regression: same root cause as the ProfilePage test — /layouts/working-sessions/
   * returns a paginated envelope, workingSessionApi.list declared a bare array, and
   * `sessions.map(...)` / `sessions.find(...)` threw during render. A throw in render
   * unmounts the whole route, so /role/sa came back blank.
   */
  it("renders working sessions returned inside a paginated envelope", async () => {
    server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
      layoutsPage([mockWorkingSession({ id: 1, name: "Enveloped session" })])));

    renderProfilePage();

    // The page makes ~14 requests on mount and the client caps concurrency at 6, so the
    // sessions fetch can queue behind others; the default 1s waitFor is too tight.
    await waitFor(() =>
      expect(screen.getByText("Enveloped session")).toBeInTheDocument(), { timeout: 2000 });
  });

  it("stays mounted when the layouts endpoints fail outright", async () => {
    server.use(
      http.get("*/api/v1/layouts/working-sessions/", () =>
        new Response(null, { status: 500 })),
      http.get("*/api/v1/layouts/page-notes/", () =>
        new Response(null, { status: 500 })),
      http.get("*/api/v1/layouts/pinned/", () =>
        new Response(null, { status: 500 })),
    );

    renderProfilePage();

    await waitFor(() =>
      expect(screen.getByText("LAYOUTS")).toBeInTheDocument());
  });

  /**
   * Both of these surfaces listened for drops with dnd-kit only, while the export
   * tray drags with the HTML5 API — so nothing could ever be dropped on either.
   * The working-sessions canvas even had a fully-written `addRef` behind a dnd-kit
   * `data.item` payload that no draggable in the app ever publishes.
   */
  describe("export-tray drops", () => {
    it("adds the record to the working-session canvas", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals" })])));

      renderProfilePage();
      // Wait for the session list to land first: SessionCanvas is keyed on the
      // active session, so it remounts when the fetch resolves and any element
      // captured before then is detached.
      await screen.findByText("Renewals");
      // Retry the drop against a freshly queried canvas: the element can still be
      // swapped out by a late re-render, and a drop on a detached node does nothing.
      await waitFor(() => {
        const canvas = document.querySelector("[data-session-canvas]") as HTMLElement;
        expect(canvas).toBeTruthy();
        fireEvent.dragOver(canvas, { dataTransfer: trayDataTransfer() });
        fireEvent.drop(canvas, { dataTransfer: trayDataTransfer() });
        expect(screen.getByText(trayItem.label)).toBeInTheDocument();
        // The summary was carried on every ref and never rendered before.
        expect(screen.getByText(trayItem.summary)).toBeInTheDocument();
      });
    });

    it("shows the whole title instead of clipping it to one line", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals", record_refs: [trayItem] })])));

      renderProfilePage();

      const title = await screen.findByText(trayItem.label);
      // 220px card with `nowrap` + ellipsis showed roughly 23 of these 65 chars.
      expect(title.style.whiteSpace).not.toBe("nowrap");
      expect(title.style.overflowWrap).toBe("anywhere");
    });

    /**
     * The Canvas section had no export support at all — its dnd-kit handler only
     * knew the "mini-palette" and "mini-canvas" kinds, so a tray pill was ignored
     * even before the protocol mismatch mattered.
     */
    it("renders a dropped record on the Canvas as a full card", async () => {
      renderProfilePage();
      await screen.findByText(/Drag components or export-tray records here/i);
      const canvas = document.querySelector("[data-canvas-viewport], [data-mini-canvas]")
        ?? (await screen.findByText(/Drag components or export-tray records here/i)).parentElement?.parentElement;
      expect(canvas).toBeTruthy();

      fireEvent.dragOver(canvas as HTMLElement, { dataTransfer: trayDataTransfer() });
      fireEvent.drop(canvas as HTMLElement, { dataTransfer: trayDataTransfer() });

      // Title, account and summary all present — a fixed 120×72 sketch box could
      // not have shown them, which is why record nodes are content-height.
      expect(await screen.findByText(trayItem.label)).toBeInTheDocument();
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
      expect(screen.getByText(trayItem.summary)).toBeInTheDocument();
    });

    it("hands the mini canvas over to the full builder, with records as real record cards", async () => {
      sessionStorage.clear();
      renderProfilePage();
      await screen.findByText(/Drag components or export-tray records here/i);
      const canvas = (await screen.findByText(/Drag components or export-tray records here/i)).parentElement?.parentElement as HTMLElement;
      fireEvent.dragOver(canvas, { dataTransfer: trayDataTransfer() });
      fireEvent.drop(canvas, { dataTransfer: trayDataTransfer() });
      await screen.findByText(trayItem.label);

      fireEvent.click(screen.getByRole("button", { name: /Open full builder/i }));

      expect(await screen.findByText("full builder")).toBeInTheDocument();
      const handed = JSON.parse(sessionStorage.getItem("mini_canvas_handoff") ?? "[]");
      expect(handed).toHaveLength(1);
      expect(handed[0].type).toBe("RecordCard");
      expect(handed[0].props).toMatchObject({ recordTitle: trayItem.label, accountName: "Acme Corp", typeLabel: "Action Item" });
    });

    it("hands over nothing, and clears a leftover handoff, when the canvas is empty", async () => {
      sessionStorage.setItem("mini_canvas_handoff", JSON.stringify([{ id: "stale", type: "Card", props: {}, children: [] }]));
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: /Open full builder/i }));
      expect(await screen.findByText("full builder")).toBeInTheDocument();
      expect(sessionStorage.getItem("mini_canvas_handoff")).toBeNull();
    });

    it("ignores drags that aren't tray pills", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals" })])));

      renderProfilePage();
      await screen.findByText("Renewals");
      const canvas = document.querySelector("[data-session-canvas]") as HTMLElement;

      fireEvent.drop(canvas, { dataTransfer: { types: ["text/plain"], getData: () => "" } });

      expect(screen.getByText(/Drop records here/i)).toBeInTheDocument();
    });
  });

  /**
   * Slot assignment used `refs.length` — a count, not a position. Add three, delete
   * the middle one, and the next drop computed index 2: the slot the third card was
   * still occupying, so the new card landed exactly on top of it.
   */
  describe("nextFreeSlot", () => {
    it("lays the first row out across three columns", () => {
      expect(nextFreeSlot([])).toEqual({ _x: 16, _y: 16 });
      expect(nextFreeSlot([{ ...trayItem, _x: 16, _y: 16 }])).toEqual({ _x: 256, _y: 16 });
      expect(nextFreeSlot([
        { ...trayItem, _x: 16, _y: 16 },
        { ...trayItem, id: "b", _x: 256, _y: 16 },
      ])).toEqual({ _x: 496, _y: 16 });
    });

    it("wraps to the next row once a row is full", () => {
      const row = [
        { ...trayItem, _x: 16, _y: 16 },
        { ...trayItem, id: "b", _x: 256, _y: 16 },
        { ...trayItem, id: "c", _x: 496, _y: 16 },
      ];
      expect(nextFreeSlot(row)).toEqual({ _x: 16, _y: 226 });
    });

    it("refills a hole left by a delete instead of stacking on an occupied slot", () => {
      const afterDeletingMiddle = [
        { ...trayItem, _x: 16, _y: 16 },
        { ...trayItem, id: "c", _x: 496, _y: 16 },
      ];
      // The old count-based math returned {496, 16} here — directly on top of "c".
      expect(nextFreeSlot(afterDeletingMiddle)).toEqual({ _x: 256, _y: 16 });
    });

    it("never returns a slot already taken, for any deletion pattern", () => {
      const occupied = [
        { ...trayItem, _x: 16, _y: 16 },
        { ...trayItem, id: "b", _x: 496, _y: 16 },
        { ...trayItem, id: "c", _x: 256, _y: 226 },
      ];
      const slot = nextFreeSlot(occupied);
      expect(occupied.some(r => r._x === slot._x && r._y === slot._y)).toBe(false);
    });
  });

  it("loads an existing notepad note out of the paginated envelope", async () => {
    server.use(http.get("*/api/v1/layouts/page-notes/", () =>
      layoutsPage([mockUserPageNote({ id: 1, content: "my saved note" })])));
    renderProfilePage();
    // A short note appears twice once loaded: as its tab label (first 20 chars) and as
    // the editor body. Assert on the editor, which is what proves the envelope was read.
    await waitFor(() => {
      const editor = document.querySelector(".ProseMirror");
      expect(editor).toBeTruthy();
      expect(editor).toHaveTextContent("my saved note");
    });
  });

  describe("My Artifacts — search, sort and filter", () => {
    const art = (over: Record<string, unknown>) => ({ ...mockArtifact, ...over });
    // The page only fetches artifacts for accounts the signed-in user is a team member of.
    const serveArtifacts = (list: unknown[]) => server.use(
      http.get("*/api/v1/accounts/accounts/", () =>
        Response.json({ count: 1, next: null, previous: null, results: [{ ...mockAccount, id: 1, team_members: [{ id: 1 }] }] })),
      http.get("*/api/v1/accounts/accounts/artifacts-batch/", () => Response.json(list)),
    );
    const open = async () => {
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: /Expand My Artifacts/ }));
    };
    const names = () => screen.queryAllByText(/^(Alpha|Bravo|Charlie)$/).map(e => e.textContent ?? "");

    it("shows the same browse bar the account page has", async () => {
      serveArtifacts([art({ id: 1, name: "Alpha" }), art({ id: 2, name: "Beta" })]);
      await open();
      expect(await screen.findByTestId("artifact-browse-bar")).toBeInTheDocument();
      expect(screen.getByTestId("artifact-search")).toBeInTheDocument();
      for (const k of ["sort", "category", "creator"]) expect(screen.getByTestId(`artifact-filter-${k}`)).toBeInTheDocument();
      expect(screen.getByTestId("artifact-filter-linked")).toBeInTheDocument();
    });

    it("search narrows the grid and says so when nothing matches", async () => {
      serveArtifacts([art({ id: 1, name: "Alpha plan" }), art({ id: 2, name: "Beta notes" })]);
      await open();
      const search = await screen.findByTestId("artifact-search");
      fireEvent.change(search, { target: { value: "alpha" } });
      await waitFor(() => expect(screen.queryByText("Beta notes")).toBeNull());
      expect(screen.getByText("Alpha plan")).toBeInTheDocument();
      fireEvent.change(search, { target: { value: "zzz" } });
      expect(await screen.findByTestId("artifact-no-match")).toBeInTheDocument();
    });

    it("search also matches the account's name, since this page mixes accounts", async () => {
      serveArtifacts([art({ id: 1, name: "Alpha plan" })]);
      await open();
      await screen.findByText("Alpha plan");
      fireEvent.change(screen.getByTestId("artifact-search"), { target: { value: "acme" } });
      expect(await screen.findByText("Alpha plan")).toBeInTheDocument();
    });

    it("sorts by name, both directions", async () => {
      serveArtifacts([art({ id: 1, name: "Bravo" }), art({ id: 2, name: "Alpha" }), art({ id: 3, name: "Charlie" })]);
      await open();
      await screen.findByText("Bravo");
      fireEvent.click(screen.getByTestId("artifact-filter-sort"));
      fireEvent.click(screen.getByTestId("artifact-sort-name_asc"));
      await waitFor(() => expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]));
      fireEvent.click(screen.getByTestId("artifact-sort-name_desc"));
      await waitFor(() => expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]));
    });

    it("filters by creator and by the action items that use the artifact", async () => {
      serveArtifacts([
        art({ id: 1, name: "By Ann", uploaded_by_username: "ann" }),
        art({ id: 2, name: "By Bob", uploaded_by_username: "bob", used_in: [{ resource_type: "action_item", resource_id: 9, label: "x", url: "/" }] }),
      ]);
      await open();
      await screen.findByText("By Ann");
      fireEvent.click(screen.getByTestId("artifact-filter-creator"));
      fireEvent.click(screen.getByTestId("artifact-creator-chip-bob"));
      await waitFor(() => expect(screen.queryByText("By Ann")).toBeNull());
      expect(screen.getByText("By Bob")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Remove filter By bob/ }));
      fireEvent.click(screen.getByTestId("artifact-filter-linked"));
      await waitFor(() => expect(screen.queryByText("By Ann")).toBeNull());
      expect(screen.getByText("By Bob")).toBeInTheDocument();
    });

    it("the empty state still offers to add one, with no browse bar", async () => {
      serveArtifacts([]);
      await open();
      expect(await screen.findByText(/No artifacts yet/)).toBeInTheDocument();
      expect(screen.queryByTestId("artifact-browse-bar")).toBeNull();
    });
  });

  describe("Notepad — link a note to an account", () => {
    const LABEL = /Link this note to an account/;
    const serveAccount = () => server.use(
      http.get("*/api/v1/accounts/accounts/", () => Response.json({
        count: 2, next: null, previous: null,
        results: [
          { ...mockAccount, id: 1, company_name: "Acme Corp", team_members: [{ id: 1 }] },
          { ...mockAccount, id: 2, company_name: "Globex", team_members: [{ id: 1 }] },
        ],
      })),
    );
    const serveNotes = (notes: unknown[]) => server.use(
      http.get("*/api/v1/layouts/page-notes/", () => layoutsPage(notes as never[])),
    );

    it("offers the user's accounts and explains what linking does", async () => {
      serveAccount();
      renderProfilePage();
      const select = await screen.findByLabelText(LABEL);
      await waitFor(() => expect(within(select).getByRole("option", { name: "Globex" })).toBeInTheDocument());
      expect(within(select).getByRole("option", { name: /general note/i })).toBeInTheDocument();
      expect(screen.getByTestId("notepad-link-hint").textContent).toMatch(/appears under that account's Account Notes/);
    });

    it("saves the link as soon as an account is chosen on an existing note", async () => {
      serveAccount();
      serveNotes([mockUserPageNote({ id: 5, content: "<p>Kickoff notes</p>" })]);
      let body: Record<string, unknown> = {};
      server.use(http.patch("*/api/v1/layouts/page-notes/:id/", async ({ request }) => {
        body = await request.json() as Record<string, unknown>;
        return Response.json(mockUserPageNote({ id: 5, content: "<p>Kickoff notes</p>", account: 2, account_name: "Globex", account_ref_label: "Globex" }));
      }));
      renderProfilePage();
      const select = await screen.findByLabelText(LABEL);
      await waitFor(() => expect(within(select).getByRole("option", { name: "Globex" })).toBeInTheDocument());
      fireEvent.change(select, { target: { value: "2" } });
      await waitFor(() => expect(body.account).toBe(2));
      expect(body.account_ref_label).toBe("Globex");
      expect((screen.getByLabelText(LABEL) as HTMLSelectElement).value).toBe("2");
      expect(screen.getByTestId("notepad-link-hint").textContent).toMatch(/Account Notes.*Globex.*Only you can see it/);
    });

    it("opens a linked note with its account already chosen, and switching notes switches the account", async () => {
      serveAccount();
      serveNotes([
        mockUserPageNote({ id: 5, content: "<p>Linked one</p>", account: 1, account_name: "Acme Corp", account_ref_label: "Acme Corp" }),
        mockUserPageNote({ id: 6, content: "<p>General one</p>" }),
      ]);
      renderProfilePage();
      const select = await screen.findByLabelText(LABEL);
      await waitFor(() => expect((select as HTMLSelectElement).value).toBe("1"));
      fireEvent.click(await screen.findByRole("button", { name: "General one" }));
      await waitFor(() => expect((screen.getByLabelText(LABEL) as HTMLSelectElement).value).toBe(""));
    });

    it("can unlink: choosing 'general note' sends account: null", async () => {
      serveAccount();
      serveNotes([mockUserPageNote({ id: 5, content: "<p>x</p>", account: 1, account_name: "Acme Corp", account_ref_label: "Acme Corp" })]);
      let body: Record<string, unknown> = {};
      server.use(http.patch("*/api/v1/layouts/page-notes/:id/", async ({ request }) => {
        body = await request.json() as Record<string, unknown>;
        return Response.json(mockUserPageNote({ id: 5, content: "<p>x</p>" }));
      }));
      renderProfilePage();
      const select = await screen.findByLabelText(LABEL);
      await waitFor(() => expect((select as HTMLSelectElement).value).toBe("1"));
      fireEvent.change(select, { target: { value: "" } });
      await waitFor(() => expect(body).toMatchObject({ account: null, account_ref_label: "" }));
    });

    it("does not create an empty note just because an account was picked", async () => {
      serveAccount();
      let posts = 0;
      server.use(http.post("*/api/v1/layouts/page-notes/", () => { posts++; return Response.json(mockUserPageNote({ id: 9 }), { status: 201 }); }));
      renderProfilePage();
      const select = await screen.findByLabelText(LABEL);
      await waitFor(() => expect(within(select).getByRole("option", { name: "Globex" })).toBeInTheDocument());
      fireEvent.change(select, { target: { value: "2" } });
      await new Promise(r => setTimeout(r, 100));
      expect(posts).toBe(0);
    });
  });

  describe("full-screen sections", () => {
    const mine = (n: number, over: Record<string, unknown> = {}) =>
      ({ ...mockActionItem, id: n, airtable_id: `rec${n}`, task: `Task ${n}`, status: "In Progress", assignee_airtable_id: "usrME", priority: "High", account_name: "Acme Corp", ...over });
    const serve = (items: unknown[]) => server.use(
      http.get("*/api/v1/team/profiles/me/", () => Response.json({ ...mockUserProfile, airtable_collaborator_id: "usrME" })),
      http.get("*/api/v1/airtable/action-items/", () => Response.json(items)),
    );
    const expandBtn = (title: string) => screen.findByRole("button", { name: `Open ${title} in full screen` });

    it("action items: shows five rows in view and scrolls to the rest", async () => {
      serve(Array.from({ length: 8 }, (_, i) => mine(i + 1)));
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 8" });
      const scroller = screen.getByTestId("action-items-scroll");
      expect(scroller.style.overflowY).toBe("auto");
      // Every item is there to scroll to, but the box is only five rows tall.
      expect(within(scroller).getAllByRole("button")).toHaveLength(8);
      const rows = 5, row = 36, gap = 6;
      expect(scroller.style.maxHeight).toBe(`${rows * (row + gap) - gap}px`);
    });

    it("action items: with five or fewer there is nothing to scroll", async () => {
      serve([mine(1), mine(2)]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 2" });
      const scroller = screen.getByTestId("action-items-scroll");
      expect(scroller.scrollHeight <= scroller.clientHeight || scroller.clientHeight === 0).toBe(true);
    });

    it("the expand icon opens a full-screen list of cards, one per action item", async () => {
      serve([mine(1), mine(2), mine(3)]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 3" });
      fireEvent.click(await expandBtn("Action Items (In Progress)"));
      const panel = screen.getByRole("dialog", { name: /Action Items \(In Progress\) — full screen/ });
      expect(within(panel).getAllByTestId("full-card")).toHaveLength(3);
      // Closed cards show a summary only.
      expect(within(panel).getAllByText(/Acme Corp · High/).length).toBe(3);
    });

    it("clicking cards shows all of an item's data, and several stay open at once", async () => {
      serve([mine(1, { task_details: "<p>Call the <b>customer</b></p>", time_spent: 5400, due_date: "2026-11-12" }), mine(2), mine(3)]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 3" });
      fireEvent.click(await expandBtn("Action Items (In Progress)"));
      const panel = screen.getByRole("dialog");
      fireEvent.click(within(panel).getByRole("button", { name: /Task 1/ }));
      fireEvent.click(within(panel).getByRole("button", { name: /Task 2/ }));
      expect(within(panel).getAllByTestId("full-card").filter(c => c.getAttribute("data-open") === "true")).toHaveLength(2);
      // Fields from the record, formatted rather than raw.
      expect(within(panel).getAllByText("Task details").length).toBeGreaterThan(0);
      expect(within(panel).getByText("customer").tagName).toBe("B");
      expect(within(panel).getByText("1h 30m")).toBeInTheDocument();
      expect(within(panel).getAllByText("Assignee name").length).toBe(2);
    });

    it("Escape and the X both close it", async () => {
      serve([mine(1)]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 1" });
      fireEvent.click(await expandBtn("Action Items (In Progress)"));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: /full screen/ })).toBeNull();
      fireEvent.click(await expandBtn("Action Items (In Progress)"));
      fireEvent.click(screen.getByRole("button", { name: "Close full screen" }));
      expect(screen.queryByRole("dialog", { name: /full screen/ })).toBeNull();
    });

    it("double-clicking the section's heading opens it too", async () => {
      serve([mine(1)]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 1" });
      const heading = screen.getAllByText(/^ACTION ITEMS/)[0];
      fireEvent.doubleClick(heading);
      expect(screen.getByRole("dialog", { name: /Action Items \(In Progress\) — full screen/ })).toBeInTheDocument();
    });

    it("an action item card can open the action item itself", async () => {
      serve([mine(1)]);
      server.use(http.get("*/api/v1/airtable/action-items/:id/attachments/", () => Response.json([])));
      renderProfilePage();
      await screen.findByRole("button", { name: "Task 1" });
      fireEvent.click(await expandBtn("Action Items (In Progress)"));
      const panel = screen.getByRole("dialog");
      fireEvent.click(within(panel).getByRole("button", { name: /Task 1/ }));
      fireEvent.click(within(panel).getByRole("button", { name: "Open action item" }));
      expect(await screen.findByText(/^Attachments/)).toBeInTheDocument();
    });

    it("reminders: the card shows the reminder's status and due time", async () => {
      renderProfilePage();
      await screen.findByText("Follow up with client");
      fireEvent.click(await expandBtn("Reminders (Today / Tomorrow)"));
      const panel = screen.getByRole("dialog");
      fireEvent.click(within(panel).getByRole("button", { name: /Follow up with client/ }));
      expect(within(panel).getByText("Due at")).toBeInTheDocument();
      expect(within(panel).getByText("Status")).toBeInTheDocument();
    });

    it("every section on the page has the full-screen control", async () => {
      renderProfilePage();
      await settle();
      const titles = [
        "Action Items (In Progress)", "Reminders (Today / Tomorrow)", "Comments", "Layouts", "Quick create & links",
        "My Skills", "My Accounts", "Time Allocation", "Notifications", "Public",
        "Notepad", "Mini Canvas", "Working Sessions",
      ];
      for (const t of titles) expect(await expandBtn(t), t).toBeInTheDocument();
    });

    it("My Artifacts has it too once the section is opened", async () => {
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: /Expand My Artifacts/ }));
      expect(await expandBtn("My Artifacts")).toBeInTheDocument();
    });

    it("notepad: the full view lists each note with its linked account", async () => {
      server.use(http.get("*/api/v1/layouts/page-notes/", () => layoutsPage([
        mockUserPageNote({ id: 5, content: "<p>Kickoff notes</p>", account: 1, account_name: "Acme Corp", account_ref_label: "Acme Corp" }),
      ] as never[])));
      renderProfilePage();
      await settle();
      fireEvent.click(await expandBtn("Notepad"));
      const panel = screen.getByRole("dialog", { name: /Notepad — full screen/ });
      const card = await within(panel).findByRole("button", { name: /Kickoff notes/ });
      expect(within(panel).getByText(/Acme Corp · Updated/)).toBeInTheDocument();
      fireEvent.click(card);
      expect(within(panel).getByText("Linked account")).toBeInTheDocument();
    });

    it("time allocation: the full view adds a card per account, Admin included", async () => {
      server.use(http.get("*/api/v1/salesforce/time-allocation/", () => Response.json(mockAllocation([
        // Local day, like the app: toISOString() is the UTC day, which is "tomorrow" every evening west of UTC.
        { date: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10), account: "Acme Corp", minutes: 60, source: "logged" },
      ]))));
      renderProfilePage();
      await settle();
      fireEvent.click(await expandBtn("Time Allocation"));
      const panel = screen.getByRole("dialog", { name: /Time Allocation — full screen/ });
      expect(await within(panel).findByRole("button", { name: /Acme Corp/ })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: /^Admin/ })).toBeInTheDocument();
    });

    it("working sessions: one card per session", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () => layoutsPage([
        mockWorkingSession({ id: 1, name: "Planning session" }),
      ] as never[])));
      renderProfilePage();
      await settle();
      fireEvent.click(await expandBtn("Working Sessions"));
      const panel = screen.getByRole("dialog", { name: /Working Sessions — full screen/ });
      expect(await within(panel).findByRole("button", { name: /Planning session/ })).toBeInTheDocument();
    });

    it("someone else's profile gets it on the Public section", async () => {
      renderProfilePage("/profile/7");
      expect(await screen.findByRole("button", { name: "Open Public in full screen" })).toBeInTheDocument();
    });
  });

  describe("ticket sections (JIRAs, Zendesk, Product Gaps)", () => {
    const TITLES = ["JIRAs / Engineering Tickets", "Zendesk / Support Tickets", "Product Gaps"];
    const stray = { ...mockTicketToReview, kind: "zendesk" as const, title: "Stray Zendesk" };
    const serveTickets = (confirmed: unknown[], review: unknown[] = []) => server.use(
      http.get("*/api/v1/accounts/tickets/", ({ request }) => {
        const u = new URL(request.url);
        const list = u.searchParams.get("review") === "needs_review"
          ? review
          : (confirmed as { kind: string }[]).filter(x => !u.searchParams.get("kind") || x.kind === u.searchParams.get("kind"));
        return Response.json({ count: list.length, next: null, previous: null, results: list });
      }),
    );

    it("shows the three sections by default, right after My Accounts", async () => {
      renderProfilePage();
      await settle();
      const heads = Array.from(document.querySelectorAll("section > div > button > span")).map(e => e.textContent?.trim());
      const at = (t: string) => heads.findIndex(h => h?.toLowerCase().startsWith(t.toLowerCase()));
      expect(at("My Accounts")).toBeGreaterThan(-1);
      expect(at(TITLES[0])).toBe(at("My Accounts") + 1);
      expect(at(TITLES[1])).toBe(at("My Accounts") + 2);
      expect(at(TITLES[2])).toBe(at("My Accounts") + 3);
    });

    it("adds them once to a layout saved before they existed, and respects a later removal", async () => {
      localStorage.setItem("profileVisibleSections-v1", JSON.stringify(["skills", "accounts", "artifacts"]));
      localStorage.removeItem("profileTicketSectionsAdded-v1");
      const first = renderProfilePage();
      for (const t of TITLES) expect(await screen.findByRole("button", { name: new RegExp(`Collapse ${t.replace(/[/()]/g, ".")}`) })).toBeInTheDocument();
      first.unmount();
      // The person removes one; reloading must not bring it back.
      localStorage.setItem("profileVisibleSections-v1", JSON.stringify(["skills", "accounts", "jira_tickets", "product_gaps"]));
      renderProfilePage();
      await screen.findByRole("button", { name: /Collapse Product Gaps/ });
      expect(screen.queryByRole("button", { name: /Collapse Zendesk/ })).toBeNull();
    });

    it("shows each kind's records with the account they belong to", async () => {
      serveTickets([
        { ...mockTicket, id: 1, kind: "jira", title: "A JIRA", account: 1, account_name: "Acme Corp" },
        { ...mockTicket, id: 2, kind: "product_gap", title: "A gap", account: 1, account_name: "Acme Corp" },
      ]);
      renderProfilePage();
      expect(await screen.findByDisplayValue("A JIRA")).toBeInTheDocument();
      expect(screen.getByDisplayValue("A gap")).toBeInTheDocument();
      expect(within(screen.getByTestId("profile-tickets-jira")).getByTestId("ticket-account").textContent).toBe("Acme Corp");
    });

    it("pins an email that matched no account to the front of its own kind, in the section", async () => {
      serveTickets([{ ...mockTicket, id: 3, kind: "zendesk", title: "Normal Zendesk" }], [stray]);
      renderProfilePage();
      const zendesk = await screen.findByTestId("profile-tickets-zendesk");
      const pinned = await within(zendesk).findByTestId(`review-row-${stray.id}`);
      expect(pinned.getAttribute("data-ticket-pinned")).toBe("true");
      expect(within(screen.getByTestId("profile-tickets-jira")).queryByTestId(`review-row-${stray.id}`)).toBeNull();
      // Not also shown in the stand-alone "Tickets to review" block.
      expect(screen.getAllByTestId(`review-row-${stray.id}`)).toHaveLength(1);
    });

    it("the stand-alone review block still covers a kind whose section was removed", async () => {
      localStorage.setItem("profileVisibleSections-v1", JSON.stringify(["skills", "accounts", "jira_tickets", "product_gaps"]));
      localStorage.setItem("profileTicketSectionsAdded-v1", "1");
      serveTickets([], [stray]);
      renderProfilePage();
      expect(await screen.findByText("Tickets to review")).toBeInTheDocument();
      expect(screen.getAllByTestId(`review-row-${stray.id}`)).toHaveLength(1);
    });

    it("full screen lists the records as cards, the unmatched one first", async () => {
      serveTickets([{ ...mockTicket, id: 3, kind: "zendesk", title: "Normal Zendesk", account: 1, account_name: "Acme Corp" }], [stray]);
      renderProfilePage();
      await screen.findByTestId("profile-tickets-zendesk");
      fireEvent.click(await screen.findByRole("button", { name: "Open Zendesk / Support Tickets in full screen" }));
      const panel = screen.getByRole("dialog", { name: /Zendesk.*full screen/ });
      const cards = await within(panel).findAllByTestId("full-card");
      expect(cards).toHaveLength(2);
      expect(cards[0].textContent).toMatch(/Stray Zendesk/);
      expect(cards[0].textContent).toMatch(/needs an account/);
      expect(cards[1].textContent).toMatch(/Normal Zendesk/);
    });
  });

  describe("My Skills — pick a skill, then act on it", () => {
    const skill = (id: number, name: string) => mockAgentSkill({ id, name, status: "approved", pinned_by_me: true } as never);
    const serveSkills = (list: unknown[]) => server.use(
      http.get("*/api/v1/skills/agent-skills/", () => Response.json({ count: list.length, next: null, previous: null, results: list })),
    );
    const bar = () => screen.getByTestId("run-skill-bar");

    it("a saved skill has no Use in Chat / Use in Voice Session buttons of its own", async () => {
      serveSkills([skill(1, "meeting-prep"), skill(2, "weekly-recap")]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Meeting Prep" });
      // Exactly one pair, in the Run Skill bar - not one pair per skill.
      expect(screen.getAllByRole("button", { name: "Use in Chat" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Use in Voice Session" })).toHaveLength(1);
      expect(within(bar()).getByRole("button", { name: "Use in Chat" })).toBeInTheDocument();
    });

    it("the Run Skill bar is at the bottom of the section, after every skill", async () => {
      serveSkills([skill(1, "meeting-prep")]);
      renderProfilePage();
      const chip = await screen.findByRole("button", { name: "Meeting Prep" });
      expect(chip.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(bar()).getByRole("button", { name: "Run Skill" })).toBeInTheDocument();
    });

    it("Run Skill is a real button next to the other two, disabled until a skill is picked", async () => {
      serveSkills([skill(1, "meeting-prep")]);
      renderProfilePage();
      const chip = await screen.findByRole("button", { name: "Meeting Prep" });
      const run = within(bar()).getByRole("button", { name: "Run Skill" });
      expect(run.tagName).toBe("BUTTON");
      expect(run).toBeDisabled();
      const names = within(bar()).getAllByRole("button").map(b => b.textContent?.trim());
      expect(names).toEqual(["Run Skill", "Use in Chat", "Use in Voice Session"]);
      fireEvent.click(chip);
      expect(run).toBeEnabled();
    });

    it("Run Skill opens the skill's run dialog, and running it sends the skill to chat", async () => {
      let ran: { id?: string; body?: Record<string, unknown> } = {};
      serveSkills([skill(1, "meeting-prep")]);
      server.use(http.post("*/api/v1/skills/agent-skills/:id/run/", async ({ params, request }) => {
        ran = { id: String(params.id), body: await request.json() as Record<string, unknown> };
        return Response.json({ prompt: "RUN IT", script: "", warnings: [] });
      }));
      const injected = vi.fn();
      window.addEventListener("chat-inject", injected as EventListener);
      try {
        renderProfilePage();
        fireEvent.click(await screen.findByRole("button", { name: "Meeting Prep" }));
        expect(screen.queryByRole("dialog", { name: /Run meeting-prep/ })).toBeNull();
        fireEvent.click(within(bar()).getByRole("button", { name: "Run Skill" }));
        const dialog = await screen.findByRole("dialog", { name: /Run meeting-prep/ });
        fireEvent.click(within(dialog).getByRole("button", { name: "Send to chat" }));
        await waitFor(() => expect(injected).toHaveBeenCalled());
        expect(ran.id).toBe("1");
        expect((injected.mock.calls[0][0] as CustomEvent).detail.text).toBe("RUN IT");
      } finally { window.removeEventListener("chat-inject", injected as EventListener); }
    });

    it("the actions are disabled until a skill is picked", async () => {
      serveSkills([skill(1, "meeting-prep")]);
      renderProfilePage();
      await screen.findByRole("button", { name: "Meeting Prep" });
      expect(within(bar()).getByRole("button", { name: "Use in Chat" })).toBeDisabled();
      expect(within(bar()).getByRole("button", { name: "Use in Voice Session" })).toBeDisabled();
      expect(screen.getByTestId("run-skill-selected").textContent).toBe("Select a skill above");
    });

    it("click the skill, then click an action: it runs that skill", async () => {
      let ran = "";
      serveSkills([skill(1, "meeting-prep"), skill(2, "weekly-recap")]);
      server.use(http.post("*/api/v1/skills/agent-skills/:id/run/", ({ params }) => { ran = String(params.id); return Response.json({ prompt: "DO THE THING", script: "", warnings: [] }); }));
      const injected = vi.fn();
      window.addEventListener("chat-inject", injected as EventListener);
      try {
        renderProfilePage();
        const chip = await screen.findByRole("button", { name: "Weekly Recap" });
        fireEvent.click(chip);
        expect(chip.getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByTestId("run-skill-selected").textContent).toBe("Weekly Recap");
        fireEvent.click(within(bar()).getByRole("button", { name: "Use in Chat" }));
        await waitFor(() => expect(injected).toHaveBeenCalled());
        expect(ran).toBe("2");
        expect((injected.mock.calls[0][0] as CustomEvent).detail.text).toBe("DO THE THING");
      } finally { window.removeEventListener("chat-inject", injected as EventListener); }
    });

    it("picking a different skill moves the selection; clicking the picked one again clears it", async () => {
      serveSkills([skill(1, "meeting-prep"), skill(2, "weekly-recap")]);
      renderProfilePage();
      const a = await screen.findByRole("button", { name: "Meeting Prep" });
      const b = screen.getByRole("button", { name: "Weekly Recap" });
      fireEvent.click(a);
      fireEvent.click(b);
      expect(a.getAttribute("aria-pressed")).toBe("false");
      expect(b.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(b);
      expect(within(bar()).getByRole("button", { name: "Use in Chat" })).toBeDisabled();
    });

    it("no bar when there are no saved skills to run", async () => {
      serveSkills([]);
      renderProfilePage();
      await settle();
      expect(screen.queryByTestId("run-skill-bar")).toBeNull();
    });
  });

  describe("Page Sections panel — add, remove, reorder, jump", () => {
    const sectionTitles = () => Array.from(document.querySelectorAll("[data-section-id]")).map(e => e.getAttribute("data-section-id"));
    const openPanel = async () => {
      renderProfilePage();
      await settle();
      fireEvent.click(await screen.findByRole("button", { name: "Sections" }));
      return screen.findByTestId("sections-status");
    };

    it("lists the sections currently on the page with − , and the others with +", async () => {
      await openPanel();
      expect(screen.getByRole("button", { name: "Remove My Skills from your page" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Notepad to your page" })).toBeInTheDocument();
    });

    it("the side-column cards (Action Items, Reminders, Comments, Layouts, Quick links) are in the panel too", async () => {
      await openPanel();
      for (const name of ["Action Items", "Reminders", "Comments", "Layouts", "Quick create & links"]) {
        expect(screen.getByRole("button", { name: `Remove ${name} from your page` }), name).toBeInTheDocument();
      }
    });

    it("− removes a section from the page, + brings it back", async () => {
      await openPanel();
      expect(sectionTitles()).toContain("skills");
      fireEvent.click(screen.getByRole("button", { name: "Remove My Skills from your page" }));
      await waitFor(() => expect(sectionTitles()).not.toContain("skills"));
      expect(screen.getByRole("button", { name: "Add My Skills to your page" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add My Skills to your page" }));
      await waitFor(() => expect(sectionTitles()).toContain("skills"));
    });

    it("adding a section appends it, scrolls to it and glows it for three seconds", async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      await openPanel();
      fireEvent.click(screen.getByRole("button", { name: "Add Notepad to your page" }));
      await waitFor(() => expect(sectionTitles().at(-1)).toBe("notepad"));
      const el = document.querySelector('[data-section-id="notepad"]') as HTMLElement;
      await waitFor(() => expect(el.getAttribute("data-glow")).toBe("true"));
      expect(scroll).toHaveBeenCalled();
      expect(screen.getByTestId("sections-status").textContent).toBe("Added Notepad to your page");
    });

    it("clicking a section's name in the panel scrolls to it and glows it", async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      await openPanel();
      fireEvent.click(screen.getByRole("button", { name: "Go to My Accounts" }));
      const el = document.querySelector('[data-section-id="accounts"]') as HTMLElement;
      expect(el.getAttribute("data-glow")).toBe("true");
      expect(scroll).toHaveBeenCalled();
    });

    it("the glow ends after three seconds", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      await openPanel();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        fireEvent.click(screen.getByRole("button", { name: "Go to My Accounts" }));
        const el = document.querySelector('[data-section-id="accounts"]') as HTMLElement;
        act(() => { vi.advanceTimersByTime(2900); });
        expect(el.getAttribute("data-glow")).toBe("true");
        act(() => { vi.advanceTimersByTime(200); });
        expect(el.hasAttribute("data-glow")).toBe(false);
      } finally { vi.useRealTimers(); }
    });

    it("reordering in the panel reorders the page, and the order is remembered", async () => {
      await openPanel();
      const before = sectionTitles().filter(id => id?.match(/^(skills|accounts)$/));
      expect(before).toEqual(["skills", "accounts"]);
      fireEvent.click(screen.getByRole("button", { name: "Move My Accounts up" }));
      await waitFor(() => expect(sectionTitles().filter(id => id?.match(/^(skills|accounts)$/))).toEqual(["accounts", "skills"]));
      expect(JSON.parse(localStorage.getItem("profileVisibleSections-v1") as string).slice(0, 2)).toEqual(["accounts", "skills"]);
    });

    it("the side column reorders and remembers its own order", async () => {
      await openPanel();
      const side = () => Array.from(document.querySelectorAll('[data-section-id^="side_"]')).map(e => e.getAttribute("data-section-id"));
      expect(side()[0]).toBe("side_action_items");
      fireEvent.click(screen.getByRole("button", { name: "Move Reminders up" }));
      await waitFor(() => expect(side().slice(0, 2)).toEqual(["side_reminders", "side_action_items"]));
      expect(JSON.parse(localStorage.getItem("profileSideSections-v1") as string).slice(0, 2)).toEqual(["side_reminders", "side_action_items"]);
    });

    it("removing a side-column card removes it, and removing all of them hides the column", async () => {
      await openPanel();
      for (const name of ["Action Items", "Reminders", "Comments", "Layouts", "Quick create & links"]) {
        fireEvent.click(screen.getByRole("button", { name: `Remove ${name} from your page` }));
      }
      await waitFor(() => expect(document.querySelector('[data-section-id^="side_"]')).toBeNull());
      expect(JSON.parse(localStorage.getItem("profileSideSections-v1") as string)).toEqual([]);
    });

    it("a saved side-column layout is restored", async () => {
      localStorage.setItem("profileSideSections-v1", JSON.stringify(["side_comments", "side_action_items"]));
      renderProfilePage();
      await settle();
      const side = Array.from(document.querySelectorAll('[data-section-id^="side_"]')).map(e => e.getAttribute("data-section-id"));
      expect(side).toEqual(["side_comments", "side_action_items"]);
    });
  });

  describe("Notifications section", () => {
    it("lists the user's notifications across channels", async () => {
      server.use(http.get("*/api/v1/team/notifications/", () => Response.json({
        count: 2, next: null, previous: null,
        results: [
          mockNotification({ id: 1, title: "⏰ Call Acme", channel: "push" }),
          mockNotification({ id: 2, title: "Bob left you a note", channel: "in_app", kind: "note_for_you" }),
        ],
      })));
      renderProfilePage();
      expect(await screen.findByText("⏰ Call Acme")).toBeInTheDocument();
      expect(screen.getByText("Bob left you a note")).toBeInTheDocument();
    });

    it("shows an empty state", async () => {
      server.use(http.get("*/api/v1/team/notifications/", () =>
        Response.json({ count: 0, next: null, previous: null, results: [] })));
      renderProfilePage();
      expect(await screen.findByText(/No notifications/i)).toBeInTheDocument();
    });

    it("filters by channel", async () => {
      let last = "";
      server.use(http.get("*/api/v1/team/notifications/", ({ request }) => {
        last = new URL(request.url).search;
        return Response.json({ count: 0, next: null, previous: null, results: [] });
      }));
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: "Slack" }));
      await waitFor(() => expect(last).toContain("channel=slack"));
    });

    it("marks everything read", async () => {
      let marked = false;
      server.use(http.post("*/api/v1/team/notifications/mark-read/", () => {
        marked = true;
        return Response.json({ updated: 1 });
      }));
      renderProfilePage();
      fireEvent.click(await screen.findByText(/Mark 1 as read/i));
      await waitFor(() => expect(marked).toBe(true));
    });
  });

  describe("horizontal rows", () => {
    it("lays notifications out as one sideways-scrolling row of cards", async () => {
      server.use(http.get("*/api/v1/team/notifications/", () => Response.json({
        count: 3, next: null, previous: null,
        results: [1, 2, 3].map(i => mockNotification({ id: i, title: `Notification ${i}` })),
      })));
      renderProfilePage();
      const row = await screen.findByRole("region", { name: "Notifications" });
      expect(row.style.display).toBe("flex");
      expect(row.style.overflowX).toBe("auto");
      expect(row.querySelectorAll("a, div[style*='width: 260px']").length).toBeGreaterThanOrEqual(3);
      expect(screen.getByText("Notification 3")).toBeInTheDocument();
    });

    it("lays public items out the same way", async () => {
      server.use(http.get("*/api/v1/team/public-items/", () => Response.json([
        mockPublicItem({ id: 1, title: "One" }), mockPublicItem({ id: 2, title: "Two" }),
      ])));
      renderProfilePage();
      const row = await screen.findByRole("region", { name: "Public items" });
      expect(row.style.overflowX).toBe("auto");
      expect(row).toHaveTextContent("One");
      expect(row).toHaveTextContent("Two");
    });

    it("renders no scroll region when there is nothing to show", async () => {
      server.use(
        http.get("*/api/v1/team/notifications/", () => Response.json({ count: 0, next: null, previous: null, results: [] })),
        http.get("*/api/v1/team/public-items/", () => Response.json([])),
      );
      renderProfilePage();
      await screen.findByText(/No notifications/i);
      expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Public items" })).toBeNull();
    });
  });

  describe("action items and reminders stay current", () => {
    // Real (Airtable) action items, assigned to the signed-in user by collaborator id.
    const item = (task: string, over: Record<string, unknown> = {}) =>
      ({ ...mockActionItem, task, status: "In Progress", assignee_airtable_id: "usrME", ...over });
    const remind = (title: string) => ({ ...mockReminders[0], id: 99, title });
    let items = [item("Old item")];
    let reminders = [mockReminders[0]];
    let itemGets = 0;
    let reminderGets = 0;
    beforeEach(() => {
      items = [item("Old item")];
      reminders = [mockReminders[0]];
      itemGets = 0;
      reminderGets = 0;
      server.use(
        http.get("*/api/v1/team/profiles/me/", () => Response.json({ ...mockUserProfile, airtable_collaborator_id: "usrME" })),
        http.get("*/api/v1/airtable/action-items/", () => {
          itemGets++;
          return Response.json(items);
        }),
        http.get("*/api/v1/scheduler/reminders/", () => {
          reminderGets++;
          return Response.json({ count: reminders.length, next: null, previous: null, results: reminders });
        }),
      );
    });

    it("re-reads both lists when an action item is changed anywhere (the broadcast)", async () => {
      renderProfilePage();
      await screen.findByRole("button", { name: "Old item" });
      items = [item("New item")];
      reminders = [remind("⏰ Fresh reminder")];
      const { resetRequestCache } = await import("../../lib/requestCache");
      resetRequestCache();
      act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated" })); });
      expect(await screen.findByRole("button", { name: "New item" })).toBeInTheDocument();
      expect(await screen.findByText(/Fresh reminder/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Old item" })).toBeNull();
    });

    it("shows a reminder that already fired today (status sent), not only pending ones", async () => {
      const soon = new Date(Date.now() - 60_000).toISOString();
      reminders = [{ ...mockReminders[0], id: 10, title: "⏰ Already fired", status: "sent", due_at: soon }];
      renderProfilePage();
      expect(await screen.findByText(/Already fired/)).toBeInTheDocument();
    });

    it("hides dismissed reminders and asks the server only for the window ending tomorrow night", async () => {
      let search = "";
      reminders = [
        { ...mockReminders[0], id: 11, title: "⏰ Dismissed one", status: "dismissed", due_at: new Date().toISOString() },
        { ...mockReminders[0], id: 12, title: "⏰ Live one", status: "pending", due_at: new Date().toISOString() },
      ];
      server.use(http.get("*/api/v1/scheduler/reminders/", ({ request }) => {
        search = new URL(request.url).search;
        return Response.json({ count: reminders.length, next: null, previous: null, results: reminders });
      }));
      renderProfilePage();
      expect(await screen.findByText(/Live one/)).toBeInTheDocument();
      expect(screen.queryByText(/Dismissed one/)).toBeNull();
      const due = new URLSearchParams(search).get("due_before") as string;
      const end = new Date(due);
      const now = new Date();
      expect(end.getDate()).toBe(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getDate());
      expect(end.getHours()).toBe(23);
    });

    it("ignores unrelated storage events", async () => {
      renderProfilePage();
      await screen.findByRole("button", { name: "Old item" });
      const before = itemGets;
      act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "somethingElse" })); });
      await new Promise(r => setTimeout(r, 100));
      expect(itemGets).toBe(before);
    });

    it("re-reads when the tab regains focus", async () => {
      renderProfilePage();
      await screen.findByRole("button", { name: "Old item" });
      items = [item("After focus")];
      const { resetRequestCache } = await import("../../lib/requestCache");
      resetRequestCache();
      act(() => { window.dispatchEvent(new Event("focus")); });
      expect(await screen.findByRole("button", { name: "After focus" })).toBeInTheDocument();
    });

    it("re-reads on a timer while the tab is open", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      try {
        renderProfilePage();
        await screen.findByRole("button", { name: "Old item" });
        items = [item("After tick")];
        reminders = [remind("⏰ Tick reminder")];
        const { resetRequestCache } = await import("../../lib/requestCache");
        resetRequestCache();
        act(() => { vi.advanceTimersByTime(30_000); });
        expect(await screen.findByRole("button", { name: "After tick" })).toBeInTheDocument();
        expect(await screen.findByText(/Tick reminder/)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops listening when the page unmounts", async () => {
      const { unmount } = renderProfilePage();
      await screen.findByRole("button", { name: "Old item" });
      unmount();
      await requestCacheIdle();
      const before = itemGets;
      act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new StorageEvent("storage", { key: "actionItemsUpdated" }));
      });
      await new Promise(r => setTimeout(r, 100));
      expect(itemGets).toBe(before);
    });
  });

  describe("left column", () => {
    const mine = (over: Record<string, unknown> = {}) =>
      ({ ...mockActionItem, task: "Fix billing", status: "In Progress", assignee_airtable_id: "usrME", ...over });
    const serveItems = (items: unknown[]) => server.use(
      http.get("*/api/v1/team/profiles/me/", () => Response.json({ ...mockUserProfile, airtable_collaborator_id: "usrME" })),
      http.get("*/api/v1/airtable/action-items/", () => Response.json(items)),
    );

    it("opens the action item modal when an action item is clicked", async () => {
      serveItems([mine()]);
      server.use(http.get("*/api/v1/airtable/action-items/:id/attachments/", () => Response.json([])));
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: "Fix billing" }));
      // "Attachments" is a section of ActionItemModal, so it proves the modal rendered, not just the row.
      expect(await screen.findByText(/^Attachments/)).toBeInTheDocument();
    });

    it("lists every In Progress item the app shows, not only the ones assigned to me", async () => {
      let search = "";
      serveItems([]);
      server.use(http.get("*/api/v1/airtable/action-items/", ({ request }) => {
        search = new URL(request.url).search;
        return Response.json([
          mine({ id: 1, airtable_id: "rec1", task: "Mine" }),
          mine({ id: 2, airtable_id: "rec2", task: "Someone else's", assignee_airtable_id: "usrOTHER" }),
          mine({ id: 3, airtable_id: "rec3", task: "Nobody's", assignee_airtable_id: "" }),
        ]);
      }));
      renderProfilePage();
      for (const t of ["Mine", "Someone else's", "Nobody's"]) expect(await screen.findByRole("button", { name: t })).toBeInTheDocument();
      expect(search).toContain("status=In+Progress");
    });

    it("shows all 21 In Progress items: they scroll in the section, and all 21 are cards in full screen", async () => {
      serveItems(Array.from({ length: 21 }, (_, i) => mine({ id: i + 1, airtable_id: `rec${i + 1}`, task: `Item ${i + 1}`, assignee_airtable_id: i % 2 ? "usrOTHER" : "usrME" })));
      renderProfilePage();
      await screen.findByRole("button", { name: "Item 21" });
      expect(within(screen.getByTestId("action-items-scroll")).getAllByRole("button")).toHaveLength(21);
      fireEvent.click(await screen.findByRole("button", { name: "Open Action Items (In Progress) in full screen" }));
      expect(within(screen.getByRole("dialog")).getAllByTestId("full-card")).toHaveLength(21);
    });

    it("does not cap the reminders list: eight reminders are all there, in a scrolling box", async () => {
      server.use(http.get("*/api/v1/scheduler/reminders/", () => Response.json({
        count: 8, next: null, previous: null,
        results: Array.from({ length: 8 }, (_, i) => ({ ...mockReminders[0], id: 60 + i, title: `Reminder ${i + 1}`, status: "sent", due_at: new Date().toISOString(), occurrences: [] })),
      })));
      renderProfilePage();
      await screen.findAllByText("Reminder 8");
      const box = screen.getAllByTestId("reminders-scroll")[0];
      expect(within(box).getAllByText(/^Reminder \d$/)).toHaveLength(8);
      expect(box.style.overflowY).toBe("auto");
    });

    it("shows a reminder that is on today's calendar even though it was due weeks ago", async () => {
      const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const inAnHour = new Date(Date.now() + 3_600_000);
      server.use(http.get("*/api/v1/scheduler/reminders/", () => Response.json({
        count: 3, next: null, previous: null,
        results: [
          { ...mockReminders[0], id: 41, title: "Due today", status: "sent", due_at: new Date().toISOString(), occurrences: [] },
          { ...mockReminders[0], id: 42, title: "Old but on today's calendar", status: "sent", due_at: longAgo,
            occurrences: [{ id: 1, start: inAnHour.toISOString(), end: inAnHour.toISOString() }] },
          { ...mockReminders[0], id: 43, title: "Old and finished", status: "sent", due_at: longAgo, occurrences: [] },
        ],
      })));
      renderProfilePage();
      expect(await screen.findByText("Due today")).toBeInTheDocument();
      expect(screen.getByText("Old but on today's calendar")).toBeInTheDocument();
      expect(screen.queryByText("Old and finished")).toBeNull();
    });

    it("opens the conversation when a comment is clicked", async () => {
      server.use(http.get("*/api/v1/comments/comments/", () =>
        Response.json({ count: 1, next: null, previous: null, results: [mockComment] })));
      renderProfilePage();
      fireEvent.click(await screen.findByTitle(/Open the conversation on Fix billing issue/i));
      // The comment panel is portalled in and names the record it belongs to.
      expect(await screen.findByText("Fix billing issue", { selector: "span, p, div, h3, h4" })).toBeInTheDocument();
    });

    it("shows the same icons the Artifacts panel uses for the quick-create rows", async () => {
      renderProfilePage();
      const docs = await screen.findByAltText("Google Docs");
      const sheets = screen.getByAltText("Google Sheets");
      const slides = screen.getByAltText("Google Slides");
      // Official product icons, one per product — the favicon service returns the same generic
      // "G" for every Google subdomain, which is what these rows used to look like.
      for (const img of [docs, sheets, slides]) expect(img.getAttribute("src")).toContain("gstatic.com");
      expect(new Set([docs, sheets, slides].map(i => i.getAttribute("src"))).size).toBe(3);
      expect(screen.getByAltText("Jira").getAttribute("src")).toContain("jira.atlassian.com");
      expect(screen.getByAltText("Figma").getAttribute("src")).toContain("figma.com");
      expect(screen.getByAltText("Notion").getAttribute("src")).toContain("notion.so");
    });

    it("keeps the quick-link input at the bottom of the same box, below the built-in rows", async () => {
      renderProfilePage();
      const lucid = await screen.findByText("+ Lucidchart");
      const input = await screen.findByLabelText("Add a quick link");
      const box = lucid.closest("div[style*='padding: 10px 4px']") as HTMLElement;
      expect(box).toBeTruthy();
      expect(box.contains(input)).toBe(true);
      expect(lucid.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("lists a user's quick link between the built-in rows and the input", async () => {
      renderProfilePage();
      const input = await screen.findByLabelText("Add a quick link");
      fireEvent.change(input, { target: { value: "example.org/docs" } });
      fireEvent.keyDown(input, { key: "Enter" });
      const mine = screen.getByRole("link", { name: /example\.org/ });
      expect(screen.getByText("+ Lucidchart").compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(mine.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("includes a Lucidchart quick-create row with its real icon", async () => {
      renderProfilePage();
      const row = (await screen.findByText("+ Lucidchart")).closest("a") as HTMLAnchorElement;
      expect(row.getAttribute("href")).toContain("lucid.app");
      expect(row.getAttribute("target")).toBe("_blank");
      expect(row.getAttribute("rel")).toContain("noopener");
      // The same catalog entry the Artifacts panel uses for a Lucidchart link.
      expect(screen.getByAltText("Lucidchart").getAttribute("src")).toContain("lucidchart.com");
    });
  });

  describe("working sessions layout", () => {
    it("gives the Notepad / Components row and Working Sessions the full width, under both columns", async () => {
      renderProfilePage();
      const heading = await screen.findByText("Working Sessions");
      const leftColumn = (await screen.findByText(/^ACTION ITEMS/)).closest("div[style*='width: 260px']") as HTMLElement;
      expect(leftColumn).toBeTruthy();
      const twoColumns = leftColumn.parentElement as HTMLElement; // the flex row holding left + right columns
      expect(twoColumns.style.display).toBe("flex");
      // Neither wide row lives inside the two-column row, so neither is limited to the right column.
      expect(twoColumns.contains(heading)).toBe(false);
      expect(twoColumns.contains(screen.getByText(/Drag components or export-tray records here/i))).toBe(false);
      // …but they still share the page's content container, in the same order.
      const page = twoColumns.parentElement as HTMLElement;
      expect(page.contains(heading)).toBe(true);
      expect(page.contains(screen.getByText(/Drag components or export-tray records here/i))).toBe(true);
    });

    it("puts the section rows above the full-width rows", async () => {
      renderProfilePage();
      const heading = await screen.findByText("Working Sessions");
      const mySkills = await screen.findByText("My Skills");
      expect(mySkills.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("starts the session canvas tall enough to work in", async () => {
      renderProfilePage();
      await screen.findByText("Working Sessions");
      const canvas = document.querySelector("[data-session-canvas]") as HTMLElement;
      expect(parseInt(canvas.style.height, 10)).toBeGreaterThanOrEqual(420);
    });

    it("has a Search button that opens the global search modal", async () => {
      let opened = 0;
      const onOpen = () => { opened += 1; };
      window.addEventListener("open-global-search", onOpen);
      try {
        renderProfilePage();
        fireEvent.click(await screen.findByRole("button", { name: /Search/ }));
        expect(opened).toBe(1);
      } finally {
        window.removeEventListener("open-global-search", onOpen);
      }
    });

    it("tells the user how to get records onto the canvas", async () => {
      renderProfilePage();
      expect(await screen.findByText(/add them to the export tray, then drop them on the canvas/i)).toBeInTheDocument();
    });
  });

  describe("React warnings", () => {
    /** Anything React reports about invalid markup or conflicting inline styles. */
    const markupWarnings = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls
        .map(args => args.map(String).join(" "))
        .filter(m => /validateDOMNesting|conflicting property|cannot appear as a descendant/.test(m));

    it("renders and re-renders without nested buttons or shorthand/longhand style conflicts", async () => {
      server.use(
        http.get("*/api/v1/layouts/working-sessions/", () => layoutsPage([
          mockWorkingSession({ id: 1, name: "First" }), mockWorkingSession({ id: 2, name: "Second" }),
        ])),
        http.get("*/api/v1/layouts/page-notes/", () => layoutsPage([
          mockUserPageNote({ id: 1, content: "alpha note" }), mockUserPageNote({ id: 2, content: "beta note" }),
        ])),
      );
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        renderProfilePage();
        await screen.findByText("First");
        await settle();

        // Section headers: collapse and expand .
        fireEvent.click(screen.getByRole("button", { name: /Collapse My Skills/ }));
        fireEvent.click(screen.getByRole("button", { name: /Expand My Skills/ }));

        // Session tabs and note tabs change their borders when selected.
        fireEvent.click(screen.getByRole("button", { name: "Second" }));
        fireEvent.click(screen.getByRole("button", { name: "First" }));
        const noteTabs = screen.getAllByRole("button", { name: /note$/ });
        fireEvent.click(noteTabs[1]);
        fireEvent.click(noteTabs[0]);

        // Both dotted-grid canvases change their background while something is dragged over them.
        for (const canvas of Array.from(document.querySelectorAll("[data-session-canvas]"))) {
          fireEvent.dragOver(canvas, { dataTransfer: trayDataTransfer() });
          fireEvent.dragLeave(canvas);
        }
        const mini = (await screen.findByText(/Drag components or export-tray records here/i)).parentElement?.parentElement as HTMLElement;
        fireEvent.dragOver(mini, { dataTransfer: trayDataTransfer() });
        fireEvent.dragLeave(mini);

        expect(markupWarnings(spy)).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it("no section header puts a button inside a button", async () => {
      renderProfilePage();
      await screen.findByText("My Skills");
      for (const inner of Array.from(document.querySelectorAll("button button"))) {
        throw new Error(`nested button: ${(inner as HTMLElement).outerHTML.slice(0, 120)}`);
      }
    });

    it("section headers still toggle from the title and the chevron, and expose their state", async () => {
      renderProfilePage();
      const title = (await screen.findByText("My Accounts")).closest("button") as HTMLElement;
      expect(title.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(title);
      expect(title.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: /Expand My Accounts/ }));
      expect(title.getAttribute("aria-expanded")).toBe("true");
    });

  });

  describe("data on mini-canvas components", () => {
    // jsdom has neither PointerEvent (dnd-kit's sensor needs it) nor layout (its collision
    // detection needs rectangles). Supply both for the duration of these tests only.
    class FakePointerEvent extends MouseEvent {
      pointerId: number; isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.isPrimary = init.isPrimary ?? true;
      }
    }
    const realRect = Element.prototype.getBoundingClientRect;
    const hadPointerEvent = "PointerEvent" in window;
    beforeEach(() => {
      (window as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;
      Element.prototype.getBoundingClientRect = function () {
        return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => "" } as DOMRect;
      };
      sessionStorage.clear();
    });
    afterEach(() => {
      Element.prototype.getBoundingClientRect = realRect;
      if (!hadPointerEvent) delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
    });

    /** Drag a component from the palette onto the mini canvas, the way a user does. */
    async function dropComponent(label: string) {
      const before = document.querySelectorAll("[data-mini-node-id]").length;
      // Scoped to the palette: a node already on the canvas also prints its own type name.
      const palette = (await screen.findByText("Components")).parentElement as HTMLElement;
      let handle: HTMLElement | null = (await within(palette).findByText(label, { selector: "span, div, p" })) as HTMLElement;
      while (handle && handle.getAttribute("aria-roledescription") !== "draggable") handle = handle.parentElement;
      if (!handle) throw new Error(`no draggable palette item for ${label}`);
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(document, { pointerId: 1, isPrimary: true, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(document, { pointerId: 1, isPrimary: true, clientX: 260, clientY: 260 });
      fireEvent.pointerUp(document, { pointerId: 1, isPrimary: true, clientX: 260, clientY: 260 });
      await waitFor(() => expect(document.querySelectorAll("[data-mini-node-id]").length).toBe(before + 1));
      // dnd-kit swallows the first click for ~50ms after a drag ends so a drag is not mistaken for a
      // click. A person cannot click that fast; the test has to wait it out like one.
      await new Promise(r => setTimeout(r, 80));
      const nodes = document.querySelectorAll("[data-mini-node-id]");
      return nodes[nodes.length - 1] as HTMLElement;
    }

    /** The open field picker. Other parts of the page also have "Add" buttons, so look inside it. */
    const picker = () => {
      const dialog = screen.getByText("Add fields to this component").closest("div[style*='position: fixed']") as HTMLElement;
      if (!dialog) throw new Error("field picker is not open");
      return within(dialog);
    };
    /** One field's row in the picker (the bordered box holding its label and button). */
    const fieldRow = (label: string) => {
      const row = picker().getAllByText(label, { selector: "span" })
        .map(el => el.closest("div[style*='border-radius: 8px']") as HTMLElement | null)
        .find(r => r && within(r).queryByRole("button", { name: /^(\+ Add|Remove)$/ }));
      if (!row) throw new Error(`no field row for ${label}`);
      return within(row);
    };

    /** In the open field picker: add a field and type its value. */
    function fillField(label: string, value: string) {
      const row = fieldRow(label);
      const add = row.queryByRole("button", { name: "+ Add" });
      if (add) fireEvent.click(add);
      fireEvent.change(fieldRow(label).getByPlaceholderText(new RegExp(`Enter ${label.toLowerCase()}`, "i")), { target: { value } });
    }

    const save = () => fireEvent.click(picker().getByRole("button", { name: "Save" }));
    /** Text components edit in place on double-click, so their field picker is behind a Fields button. */
    const openPickerVia = (node: HTMLElement) => {
      fireEvent.click(node);
      fireEvent.click(within(node.parentElement as HTMLElement).getByRole("button", { name: "Fields" }));
    };
    const handoff = () => JSON.parse(sessionStorage.getItem("mini_canvas_handoff") ?? "[]");
    const openBuilder = async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open full builder/i }));
      await screen.findByText("full builder");
      return handoff();
    };

    it("Rich Text: a title and description entered in the picker appear on the component (the reported case)", async () => {
      renderProfilePage();
      const node = await dropComponent("Rich Text");
      expect(node.textContent).toContain("Rich text content");

      openPickerVia(node);
      fillField("Title", "Test Rich text title");
      fillField("Description", "test rich text description");
      save();

      await waitFor(() => expect(node.textContent).toContain("Test Rich text title"));
      expect(node.textContent).toContain("test rich text description");
      expect(node.textContent).toContain("Rich text content"); // its own content is still there
      expect(node.querySelector("[data-mini-field=g_title]")?.textContent).toContain("Title");
    });

    it("…and all of it is handed to the full builder", async () => {
      renderProfilePage();
      const node = await dropComponent("Rich Text");
      openPickerVia(node);
      fillField("Title", "Test Rich text title");
      fillField("Description", "test rich text description");
      save();
      await waitFor(() => expect(node.textContent).toContain("Test Rich text title"));

      const nodes = await openBuilder();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("RichText");
      expect(nodes[0].props.html).toContain("Rich text content");
      expect(nodes[0].props.html).toContain("<strong>Title</strong><br>Test Rich text title");
      expect(nodes[0].props.html).toContain("<strong>Description</strong><br>test rich text description");
    });

    it("a Card shows its fields inside it, and the builder gets them as a child", async () => {
      renderProfilePage();
      const node = await dropComponent("Card");
      fireEvent.doubleClick(node);
      fillField("Notes", "card notes here");
      save();
      await waitFor(() => expect(node.textContent).toContain("card notes here"));

      const nodes = await openBuilder();
      expect(nodes[0].type).toBe("Card");
      expect(JSON.stringify(nodes[0].children)).toContain("card notes here");
    });

    it("a Heading is reachable through its Fields button, shows the data, and the builder gets it too", async () => {
      renderProfilePage();
      const node = await dropComponent("Heading");
      fireEvent.click(node);                                   // select it
      fireEvent.click(within(node.parentElement as HTMLElement).getByRole("button", { name: "Fields" }));
      fillField("Title", "Heading data");
      save();
      await waitFor(() => expect(node.textContent).toContain("Heading data"));

      const nodes = await openBuilder();
      expect(nodes.map((n: { type: string }) => n.type)).toEqual(["Heading", "RichText"]);
      expect(nodes[1].props.html).toContain("Heading data");
    });

    it("editing a value updates the canvas, and removing a field removes it", async () => {
      renderProfilePage();
      const node = await dropComponent("Rich Text");
      openPickerVia(node);
      fillField("Title", "first");
      save();
      await waitFor(() => expect(node.textContent).toContain("first"));

      openPickerVia(node);
      fillField("Title", "second");
      save();
      await waitFor(() => expect(node.textContent).toContain("second"));
      expect(node.textContent).not.toContain("first");

      openPickerVia(node);
      fireEvent.click(fieldRow("Title").getByRole("button", { name: "Remove" }));
      save();
      await waitFor(() => expect(node.textContent).not.toContain("second"));
    });

    it("a field that was picked but left blank shows nothing and is not handed over", async () => {
      renderProfilePage();
      const node = await dropComponent("Card");
      fireEvent.doubleClick(node);
      fireEvent.click(fieldRow("Notes").getByRole("button", { name: "+ Add" }));
      save();
      expect(node.querySelector("[data-mini-fields]")).toBeNull();
      expect((await openBuilder())[0].children).toEqual([]);
    });

    it("Cancel leaves the component as it was", async () => {
      renderProfilePage();
      const node = await dropComponent("Rich Text");
      openPickerVia(node);
      fillField("Title", "discarded");
      fireEvent.click(picker().getByRole("button", { name: "Cancel" }));
      expect(node.textContent).not.toContain("discarded");
    });

    // ── Rich Text edits in place, with formatting ───────────────────────────
    const richEditor = () => document.querySelector("[data-mini-rich-editor]") as HTMLElement | null;
    const pm = () => document.querySelector("[data-mini-rich-editor] .ProseMirror") as HTMLElement;
    const selectAllInEditor = () => fireEvent.keyDown(pm(), { key: "a", ctrlKey: true });
    const tool = (title: string) => within(richEditor() as HTMLElement).getByTitle(title);

    it("Text and Rich Text both edit in place on double-click — neither opens the field picker", async () => {
      renderProfilePage();
      const text = await dropComponent("Text");
      fireEvent.doubleClick(text);
      expect(text.querySelector("textarea")).toBeTruthy();
      expect(screen.queryByText("Add fields to this component")).toBeNull();

      const rich = await dropComponent("Rich Text");
      fireEvent.doubleClick(rich);
      expect(richEditor()).toBeTruthy();
      expect(screen.queryByText("Add fields to this component")).toBeNull();
    });

    it("Rich Text offers bold, italic, underline, strikethrough, lists and links", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      fireEvent.doubleClick(rich);
      for (const title of ["Bold", "Italic", "Underline", "Strikethrough", "Bullet list", "Numbered list", "Checklist"]) {
        expect(tool(title), title).toBeInTheDocument();
      }
      expect(within(richEditor() as HTMLElement).getByText("Link")).toBeInTheDocument();
    });

    it("formatting shows on the canvas straight away, and reaches the full builder", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      fireEvent.doubleClick(rich);
      selectAllInEditor();
      fireEvent.mouseDown(tool("Bold"));
      fireEvent.mouseDown(tool("Underline"));
      fireEvent.click(within(richEditor() as HTMLElement).getByRole("button", { name: "Done" }));

      await waitFor(() => expect(richEditor()).toBeNull());
      // Not just text: the canvas now renders the formatting.
      expect(rich.querySelector("strong u, u strong")).toBeTruthy();

      const nodes = await openBuilder();
      expect(nodes[0].props.html).toMatch(/<strong><u>|<u><strong>/);
    });

    it("typing in the editor is saved as you go, with no separate Save step", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      fireEvent.doubleClick(rich);
      selectAllInEditor();
      fireEvent.mouseDown(tool("Italic"));
      await waitFor(() => expect(rich.querySelector("em")).toBeTruthy());
    });

    it("Escape and selecting something else both end editing, and the content stays", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      fireEvent.doubleClick(rich);
      selectAllInEditor();
      fireEvent.mouseDown(tool("Bold"));
      fireEvent.keyDown(richEditor() as HTMLElement, { key: "Escape" });
      await waitFor(() => expect(richEditor()).toBeNull());
      expect(rich.querySelector("strong")).toBeTruthy();

      fireEvent.doubleClick(rich);
      expect(richEditor()).toBeTruthy();
      const other = await dropComponent("Card");
      fireEvent.click(other);                      // selecting another node ends the edit
      await waitFor(() => expect(richEditor()).toBeNull());
    });

    it("a Rich Text component's field picker is behind its Fields button", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      fireEvent.click(rich);
      fireEvent.click(within(rich.parentElement as HTMLElement).getByRole("button", { name: "Fields" }));
      expect(screen.getByText("Add fields to this component")).toBeInTheDocument();
    });

    // ── The canvas persists across page loads ───────────────────────────────
    const MINI_KEY = "profileMiniCanvas-v1:1";
    const SAVED_KEY = "profileMiniCanvasSaved-v1:1";
    const nodeEls = () => Array.from(document.querySelectorAll("[data-mini-node-id]")) as HTMLElement[];
    const reload = async () => { cleanup(); await requestCacheIdle(); renderProfilePage(); };

    it("keeps its components when the page is loaded again", async () => {
      renderProfilePage();
      await dropComponent("Rich Text");
      await dropComponent("Card");
      expect(nodeEls()).toHaveLength(2);

      await reload();
      await waitFor(() => expect(nodeEls()).toHaveLength(2));
      expect(JSON.parse(localStorage.getItem(MINI_KEY) ?? "[]").map((n: { type: string }) => n.type)).toEqual(["RichText", "Card"]);
    });

    it("keeps edits and field data too", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      openPickerVia(rich);
      fillField("Title", "persisted title");
      save();
      await waitFor(() => expect(rich.textContent).toContain("persisted title"));

      await reload();
      await waitFor(() => expect(nodeEls()).toHaveLength(1));
      expect(nodeEls()[0].textContent).toContain("persisted title");
    });

    it("components added after a reload get ids that cannot clash with restored ones", async () => {
      renderProfilePage();
      await dropComponent("Card");
      await reload();
      await waitFor(() => expect(nodeEls()).toHaveLength(1));
      await dropComponent("Card");
      const ids = nodeEls().map(n => n.getAttribute("data-mini-node-id"));
      expect(new Set(ids).size).toBe(2);
    });

    it("is stored per user: another user's canvas is not shown", async () => {
      localStorage.setItem("profileMiniCanvas-v1:2", JSON.stringify([
        { id: "theirs", type: "Card", icon: "", label: "Card", x: 1, y: 1, w: 100, h: 60 },
      ]));
      renderProfilePage();
      await screen.findByText(/Drag components or export-tray records here/i);
      await new Promise(r => setTimeout(r, 120));
      expect(nodeEls()).toHaveLength(0);
    });

    it("starts empty, without crashing, when storage holds garbage", async () => {
      localStorage.setItem(MINI_KEY, "{not json");
      renderProfilePage();
      expect(await screen.findByText(/Drag components or export-tray records here/i)).toBeInTheDocument();
      localStorage.setItem(MINI_KEY, JSON.stringify([{ nonsense: true }, null, 7]));
      await reload();
      expect(await screen.findByText(/Drag components or export-tray records here/i)).toBeInTheDocument();
    });

    it("does not erase a stored canvas before it has been restored", async () => {
      localStorage.setItem(MINI_KEY, JSON.stringify([
        { id: "kept", type: "Card", icon: "", label: "Card", x: 5, y: 5, w: 100, h: 60 },
      ]));
      renderProfilePage();
      await waitFor(() => expect(nodeEls()).toHaveLength(1));
      expect(JSON.parse(localStorage.getItem(MINI_KEY) ?? "[]")).toHaveLength(1);
    });

    // ── Clear ───────────────────────────────────────────────────────────────
    it("Clear is always visible, disabled while the canvas is empty", async () => {
      renderProfilePage();
      const clear = await screen.findByRole("button", { name: "Clear" });
      expect((clear as HTMLButtonElement).disabled).toBe(true);
      await dropComponent("Card");
      expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("Clear asks first, keeps everything if you say no, and removes it from storage if you say yes", async () => {
      renderProfilePage();
      await dropComponent("Card");
      await dropComponent("Rich Text");
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("2 components"));
      expect(nodeEls()).toHaveLength(2);

      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      await waitFor(() => expect(nodeEls()).toHaveLength(0));
      await waitFor(() => expect(localStorage.getItem(MINI_KEY)).toBeNull());

      await reload();
      expect(await screen.findByText(/Drag components or export-tray records here/i)).toBeInTheDocument();
      confirm.mockRestore();
    });

    // ── Save: the canvas becomes a button that can be dragged into a working session ──
    const savedBox = () => screen.queryByTestId("saved-canvases");
    const chips = () => Array.from(document.querySelectorAll("[data-testid=saved-canvases] [draggable=true]")) as HTMLElement[];
    function fakeDataTransfer() {
      const store: Record<string, string> = {};
      return {
        store,
        setData: (k: string, v: string) => { store[k] = v; },
        getData: (k: string) => store[k] ?? "",
        get types() { return Object.keys(store); },
        effectAllowed: "", dropEffect: "",
      };
    }

    it("explains what Save does, right on the canvas", async () => {
      renderProfilePage();
      const note = await screen.findByTestId("mini-canvas-note");
      expect(note).toHaveTextContent(/Save turns this canvas into a button/i);
      expect(note).toHaveTextContent(/Drag that button into a working session/i);
    });

    it("Save is disabled until there is something to save", async () => {
      renderProfilePage();
      const btn = await screen.findByRole("button", { name: "Save" });
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      await dropComponent("Card");
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("Save adds a draggable button for the canvas and leaves the canvas as it is", async () => {
      renderProfilePage();
      await dropComponent("Card");
      await dropComponent("Heading");
      expect(savedBox()).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(chips()).toHaveLength(1));
      expect(chips()[0]).toHaveTextContent(/Canvas · .*\(2\)/);
      expect(nodeEls()).toHaveLength(2);
      await waitFor(() => expect(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")).toHaveLength(1));
    });

    it("the saved button is a snapshot: changing the canvas afterwards does not change it", async () => {
      renderProfilePage();
      await dropComponent("Card");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(chips()).toHaveLength(1));
      await dropComponent("Heading");                         // the canvas moves on

      const dt = fakeDataTransfer();
      fireEvent.dragStart(chips()[0], { dataTransfer: dt });
      const payload = JSON.parse(dt.store["application/x-export-item"]);
      expect(payload.summary).toContain("1 component");
      expect(JSON.parse(payload.content).nodes).toHaveLength(1);
    });

    it("saved buttons survive a reload, and can be removed", async () => {
      renderProfilePage();
      await dropComponent("Card");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(chips()).toHaveLength(1));

      await reload();
      await waitFor(() => expect(chips()).toHaveLength(1));

      fireEvent.click(within(chips()[0]).getByRole("button", { name: /Remove saved canvas/ }));
      await waitFor(() => expect(savedBox()).toBeNull());
      await waitFor(() => expect(localStorage.getItem(SAVED_KEY)).toBeNull());
    });

    it("dragging the saved button into a working session adds it there as a card", async () => {
      renderProfilePage();
      await dropComponent("Rich Text");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(chips()).toHaveLength(1));

      const dt = fakeDataTransfer();
      fireEvent.dragStart(chips()[0], { dataTransfer: dt });
      const session = document.querySelector("[data-session-canvas]") as HTMLElement;
      fireEvent.dragOver(session, { dataTransfer: dt });
      fireEvent.drop(session, { dataTransfer: dt });

      // Adding the first card creates a session, which remounts the canvas — so look again each time.
      const inSession = () => within(document.querySelector("[data-session-canvas]") as HTMLElement);
      await waitFor(() => expect(inSession().getAllByText(/Canvas · /)).toHaveLength(1));
      expect(inSession().getByText(/1 component/)).toBeInTheDocument();
      expect(inSession().getByText(/Rich Text: Rich text content/)).toBeInTheDocument();
    });

    it("the session card reopens the saved canvas in the full builder", async () => {
      renderProfilePage();
      const rich = await dropComponent("Rich Text");
      openPickerVia(rich);
      fillField("Title", "saved field");
      save();
      await waitFor(() => expect(rich.textContent).toContain("saved field"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(chips()).toHaveLength(1));

      const dt = fakeDataTransfer();
      fireEvent.dragStart(chips()[0], { dataTransfer: dt });
      const session = document.querySelector("[data-session-canvas]") as HTMLElement;
      fireEvent.drop(session, { dataTransfer: dt });

      // By the button's own text: dnd-kit gives each draggable card role="button", so the card's
      // accessible name also contains "Open in builder" and a role query would match both.
      const inSession = () => within(document.querySelector("[data-session-canvas]") as HTMLElement);
      await waitFor(() => expect(inSession().getAllByText(/Open in builder/)).toHaveLength(1));
      fireEvent.click(inSession().getByText(/Open in builder/));
      expect(await screen.findByText("full builder")).toBeInTheDocument();
      const nodes = handoff();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("RichText");
      expect(nodes[0].props.html).toContain("saved field");
    });

    it("other session cards (records) do not get an Open in builder button", async () => {
      renderProfilePage();
      await screen.findByText(/Drag components or export-tray records here/i);
      const session = document.querySelector("[data-session-canvas]") as HTMLElement;
      fireEvent.drop(session, { dataTransfer: trayDataTransfer() });
      await within(session).findByText(trayItem.label);
      expect(within(session).queryByText(/Open in builder/)).toBeNull();
    });

    it("the mini-canvas itself refuses a saved canvas, so it can never nest in itself", async () => {
      renderProfilePage();
      const card = await dropComponent("Card");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(chips()).toHaveLength(1));

      const dt = fakeDataTransfer();
      fireEvent.dragStart(chips()[0], { dataTransfer: dt });
      const miniCanvas = card.parentElement as HTMLElement;
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      Object.assign(over, { dataTransfer: dt });
      miniCanvas.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(false);               // not a drop target for this drag

      fireEvent.drop(miniCanvas, { dataTransfer: dt });
      expect(nodeEls()).toHaveLength(1);                       // nothing was added
    });

  });

  describe("Public section (own page)", () => {
    it("shows the user's public items and can add a link", async () => {
      let posted: Record<string, unknown> | null = null;
      server.use(http.post("*/api/v1/team/public-items/", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return Response.json(mockPublicItem({ id: 9 }), { status: 201 });
      }));
      renderProfilePage();
      expect(await screen.findByText("Team handbook")).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "+ Link" }));
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Runbook" } });
      fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://x.test/rb" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(posted).toMatchObject({ item_type: "artifact_link", title: "Runbook", url: "https://x.test/rb" }));
    });

    it("offers no schedule / email / note actions on your own page", async () => {
      renderProfilePage();
      await screen.findByText("Team handbook");
      expect(screen.queryByRole("button", { name: /Schedule call with/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Leave a note for/i })).toBeNull();
    });
  });

  describe("Viewing another member (/profile/:memberId)", () => {
    it("shows their header and public items, read-only, with the three actions", async () => {
      renderProfilePage("/profile/2");
      expect(await screen.findByText("Bob Jones")).toBeInTheDocument();
      expect(await screen.findByText("Team handbook")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Schedule call with Bob" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Leave a note for Bob" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ Link" })).toBeNull();
      expect(screen.queryByLabelText(/Remove Team handbook/)).toBeNull();
    });

    it("does not render the private sections", async () => {
      renderProfilePage("/profile/2");
      await screen.findByText("Bob Jones");
      expect(screen.queryByText(/Notifications/i)).toBeNull();
      expect(screen.queryByText("Working Sessions")).toBeNull();
    });

    it("opens Gmail compose in a new tab with their address", async () => {
      renderProfilePage("/profile/2");
      const link = await screen.findByRole("link", { name: "Email Bob" });
      expect(link.getAttribute("href")).toContain("mail.google.com/mail/?view=cm");
      expect(link.getAttribute("href")).toContain("to=bob%40example.com");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    });

    it("leaves a private note on Enter", async () => {
      let body: unknown = null;
      server.use(http.post("*/api/v1/team/members/2/leave-note/", async ({ request }) => {
        body = await request.json();
        return Response.json({ id: 1, author: 1, author_name: "A", body: "hi", created_at: "" }, { status: 201 });
      }));
      renderProfilePage("/profile/2");
      fireEvent.click(await screen.findByRole("button", { name: "Leave a note for Bob" }));
      const box = await screen.findByLabelText("Note");
      fireEvent.change(box, { target: { value: "Call me" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(body).toEqual({ body: "Call me" }));
      expect(await screen.findByText(/has been notified/i)).toBeInTheDocument();
    });

    function scheduleHandler(sync: unknown, seen: { payload?: Record<string, unknown> }) {
      server.use(http.post("*/api/v1/scheduler/events/", async ({ request }) => {
        seen.payload = (await request.json()) as Record<string, unknown>;
        return Response.json({ id: 5, google_sync: sync }, { status: 201 });
      }));
    }

    async function openScheduleModal() {
      renderProfilePage("/profile/2");
      fireEvent.click(await screen.findByRole("button", { name: "Schedule call with Bob" }));
      return screen.findByLabelText("Other invitees (emails)");
    }

    it("schedules a call with them plus extra invitees, and emails nobody by default", async () => {
      const seen: { payload?: Record<string, unknown> } = {};
      scheduleHandler({ status: "ok", invites_sent: false }, seen);
      fireEvent.change(await openScheduleModal(), { target: { value: "cara@example.com" } });
      expect((screen.getByLabelText(/Email the invitation/i) as HTMLInputElement).checked).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
      expect(await screen.findByText(/No email was sent/i)).toBeInTheDocument();
      expect(seen.payload).toMatchObject({ send_invites: false, event_category: "meeting" });
      const emails = (seen.payload as unknown as { attendees: { email: string }[] }).attendees.map(a => a.email);
      expect(emails).toEqual(["bob@example.com", "cara@example.com"]);
    });

    it("emails the invitations only after the user ticks the approval box", async () => {
      const seen: { payload?: Record<string, unknown> } = {};
      scheduleHandler({ status: "ok", invites_sent: true }, seen);
      fireEvent.change(await openScheduleModal(), { target: { value: "cara@example.com" } });
      fireEvent.click(screen.getByLabelText(/Email the invitation/i));
      fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
      expect(await screen.findByText(/Invitation emails were sent to 2 people/i)).toBeInTheDocument();
      expect(seen.payload).toMatchObject({ send_invites: true });
    });

    it("does not claim emails were sent when the server says none were", async () => {
      // The invite gate can refuse an approved send (switch off, past event, hourly budget).
      const seen: { payload?: Record<string, unknown> } = {};
      scheduleHandler({ status: "ok", invites_sent: false }, seen);
      await openScheduleModal();
      fireEvent.click(screen.getByLabelText(/Email the invitation/i));
      fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
      expect(await screen.findByText(/none were sent/i)).toBeInTheDocument();
      expect(screen.queryByText(/Invitation emails were sent/i)).toBeNull();
    });

    it.each([
      ["not_connected", /Google Calendar isn't connected, so nobody was invited/i],
      ["failed", /couldn't be updated, so nobody was invited/i],
    ])("says nobody was invited when Google is %s", async (status, message) => {
      scheduleHandler({ status, invites_sent: false }, {});
      await openScheduleModal();
      fireEvent.click(screen.getByLabelText(/Email the invitation/i));
      fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it("rejects an invalid invitee email", async () => {
      renderProfilePage("/profile/2");
      fireEvent.click(await screen.findByRole("button", { name: "Schedule call with Bob" }));
      fireEvent.change(await screen.findByLabelText("Other invitees (emails)"), { target: { value: "nope" } });
      expect(screen.getByText(/not a valid email/i)).toBeInTheDocument();
      expect((screen.getByRole("button", { name: "Schedule" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("redirects to /profile when the member is the viewer", async () => {
      server.use(http.get("*/api/v1/team/members/:id/profile/", () =>
        Response.json(mockMemberProfile({ id: 1, is_self: true }))));
      renderProfilePage("/profile/1");
      expect(await screen.findByText("Team handbook")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Leave a note for/ })).toBeNull();
    });

    it("shows a not-found message when the profile fails to load", async () => {
      server.use(http.get("*/api/v1/team/members/:id/profile/", () => new Response(null, { status: 404 })));
      renderProfilePage("/profile/99");
      expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
    });

    it("sends a non-numeric id back to the team page", async () => {
      renderProfilePage("/profile/abc");
      expect(await screen.findByText("team page")).toBeInTheDocument();
    });
  });
});


describe("profile list helpers", () => {
  it("reminderWindow runs from local midnight today to 23:59:59.999 tomorrow", () => {
    const { from, to } = reminderWindow(new Date(2026, 10, 30, 15, 20));
    expect(from).toEqual(new Date(2026, 10, 30, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 11, 1, 23, 59, 59, 999)); // crosses a month boundary
  });

  it("visibleReminder: today's fired ones show, overdue waiting ones show, old sent and dismissed do not", () => {
    const from = new Date(2026, 10, 10);
    const to = new Date(2026, 10, 11, 23, 59);
    const day = (d: number) => new Date(2026, 10, d, 9).toISOString();
    const r = (status: string, d: number, occ: number[] = []) =>
      ({ status, due_at: day(d), occurrences: occ.map((o, i) => ({ id: i, start: day(o), end: day(o) })) }) as never;
    expect(visibleReminder(r("sent", 10), from, to)).toBe(true);
    expect(visibleReminder(r("pending", 2), from, to)).toBe(true);
    expect(visibleReminder(r("snoozed", 2), from, to)).toBe(true);
    expect(visibleReminder(r("sent", 2), from, to)).toBe(false);
    expect(visibleReminder(r("dismissed", 10), from, to)).toBe(false);
    expect(visibleReminder(r("sent", 20), from, to)).toBe(false); // due after the window
  });

  it("visibleReminder: a reminder due long ago but on today's/tomorrow's calendar is shown", () => {
    const from = new Date(2026, 10, 10);
    const to = new Date(2026, 10, 11, 23, 59);
    const day = (d: number) => new Date(2026, 9, d, 9).toISOString();
    const onCalendarToday = { status: "sent", due_at: day(14), occurrences: [{ id: 1, start: new Date(2026, 10, 10, 14).toISOString(), end: "" }] } as never;
    const onCalendarLater = { status: "sent", due_at: day(14), occurrences: [{ id: 1, start: new Date(2026, 10, 20, 14).toISOString(), end: "" }] } as never;
    const dismissedButOnCalendar = { status: "dismissed", due_at: day(14), occurrences: [{ id: 1, start: new Date(2026, 10, 10, 14).toISOString(), end: "" }] } as never;
    expect(visibleReminder(onCalendarToday, from, to)).toBe(true);
    expect(visibleReminder(onCalendarLater, from, to)).toBe(false);
    expect(visibleReminder(dismissedButOnCalendar, from, to)).toBe(false);
  });
});
