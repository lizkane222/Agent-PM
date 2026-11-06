import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, configure, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http } from "msw";
import { server } from "../../test/msw-server";
import ProfilePage, { nextFreeSlot } from "../ProfilePage";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { CommentProvider } from "../../components/comments/CommentContext";
import { mockActionItem } from "../../test/handlers/action_items";
import { mockComment } from "../../test/handlers/comments";
import { EXPORT_ITEM_DRAG_KEY } from "../../components/ExportBar";
import { layoutsPage, mockWorkingSession, mockUserPageNote } from "../../test/handlers/layouts";
import { mockMemberProfile, mockPublicItem, mockNotification } from "../../test/handlers/profile";

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

  it("offers an unscoped GET Meeting Notes run even with no skills assigned", async () => {
    renderProfilePage();
    expect(await screen.findByTitle(/all of your accounts/i)).toBeInTheDocument();
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

  describe("left column", () => {
    const schedulerItem = (over: Record<string, unknown> = {}) => ({
      id: 5, assigned_to: 1, assigned_to_username: "alice", created_by: 1, title: "Fix billing",
      notes: "", priority: "high", status: "in_progress", due_date: null, source_event: null,
      account: 1, account_name: "Acme Corp", airtable_record_id: "recAAA001",
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
    });
    const serveItems = (items: unknown[]) => server.use(
      http.get("*/api/v1/scheduler/action-items/", () =>
        Response.json({ count: items.length, next: null, previous: null, results: items })),
    );

    it("opens the action item modal when an action item is clicked", async () => {
      let lookup = "";
      serveItems([schedulerItem()]);
      server.use(http.get("*/api/v1/airtable/action-items/", ({ request }) => {
        lookup = new URL(request.url).search;
        return Response.json([mockActionItem]);
      }));
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: "Fix billing" }));
      // "Attachments" is a section of ActionItemModal, so it proves the modal rendered, not just the row.
      expect(await screen.findByText(/^Attachments/)).toBeInTheDocument();
      expect(lookup).toContain("airtable_id=recAAA001");
    });

    it("explains why it cannot open an action item that is not linked to Airtable", async () => {
      serveItems([schedulerItem({ airtable_record_id: "" })]);
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: "Fix billing" }));
      expect(await screen.findByText(/isn't linked to Airtable yet/i)).toBeInTheDocument();
    });

    it("says so when the Airtable record cannot be found", async () => {
      serveItems([schedulerItem()]);
      server.use(http.get("*/api/v1/airtable/action-items/", () => Response.json([])));
      renderProfilePage();
      fireEvent.click(await screen.findByRole("button", { name: "Fix billing" }));
      expect(await screen.findByText(/Could not open that action item/i)).toBeInTheDocument();
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

        // Section headers: collapse and expand ("GET Meeting Notes" lives in one of them).
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

    it("keeps GET Meeting Notes reachable by role now that it is no longer inside the header button", async () => {
      renderProfilePage();
      expect(await screen.findByRole("button", { name: /GET Meeting Notes/i })).toBeInTheDocument();
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
