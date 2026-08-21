import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http } from "msw";
import { server } from "../../test/msw-server";
import RolePage, { nextFreeSlot } from "../RolePage";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import { EXPORT_ITEM_DRAG_KEY } from "../../components/ExportBar";
import { layoutsPage, mockWorkingSession } from "../../test/handlers/layouts";

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

function renderRolePage(slug = "sa") {
  return render(
    <MemoryRouter initialEntries={[`/role/${slug}`]}>
      <CurrentUserProvider>
        <Routes>
          <Route path="/role/:roleSlug" element={<RolePage />} />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  );
}

describe("RolePage", () => {
  /**
   * Unscoped, like the profile page: a role page covers the whole book of business.
   * It lives in the My Skills *header* rather than the body, which is gated on
   * skills.length and would hide it for a role with no Claude skills — as here.
   *
   * Queried by title, not role: CollapsibleSection's header is itself a <button>, so
   * its accessible name absorbs the nested button's text and getByRole finds two.
   */
  it("offers an unscoped GET Meeting Notes run even with no skills assigned", async () => {
    renderRolePage();
    expect(await screen.findByTitle(/all of your accounts/i)).toBeInTheDocument();
  });

  it("renders with no working sessions", async () => {
    renderRolePage();
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

    renderRolePage();

    await waitFor(() =>
      expect(screen.getByText("Enveloped session")).toBeInTheDocument());
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

    renderRolePage();

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

      renderRolePage();
      // Wait for the session list to land first: SessionCanvas is keyed on the
      // active session, so it remounts when the fetch resolves and any element
      // captured before then is detached.
      await screen.findByText("Renewals");
      const canvas = document.querySelector("[data-session-canvas]") as HTMLElement;
      expect(canvas).toBeTruthy();

      fireEvent.dragOver(canvas, { dataTransfer: trayDataTransfer() });
      fireEvent.drop(canvas, { dataTransfer: trayDataTransfer() });

      expect(await screen.findByText(trayItem.label)).toBeInTheDocument();
      // The summary was carried on every ref and never rendered before.
      expect(screen.getByText(trayItem.summary)).toBeInTheDocument();
    });

    it("shows the whole title instead of clipping it to one line", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals", record_refs: [trayItem] })])));

      renderRolePage();

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
      renderRolePage();
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

    it("ignores drags that aren't tray pills", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals" })])));

      renderRolePage();
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
});
