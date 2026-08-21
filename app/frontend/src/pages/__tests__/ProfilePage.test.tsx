import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http } from "msw";
import { server } from "../../test/msw-server";
import ProfilePage from "../ProfilePage";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import { EXPORT_ITEM_DRAG_KEY } from "../../components/ExportBar";
import {
  layoutsPage,
  mockUserPageNote,
  mockWorkingSession,
} from "../../test/handlers/layouts";

const droppedItem = {
  id: "action_item:recABC",
  type: "action_item",
  label: "Follow up with the security team on SOC2 evidence for the renewal",
  summary: "In Progress · High · Acme Corp",
  content: "full content",
  accountName: "Acme Corp",
  accent: "#0263E0",
};

/** jsdom has no DataTransfer; RTL forwards whatever object we hand it. */
function trayDataTransfer(item: unknown = droppedItem) {
  return {
    types: [EXPORT_ITEM_DRAG_KEY],
    dropEffect: "none",
    getData: (key: string) => (key === EXPORT_ITEM_DRAG_KEY ? JSON.stringify(item) : ""),
  };
}

function renderProfilePage() {
  return render(
    <MemoryRouter initialEntries={["/profile"]}>
      <CurrentUserProvider>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </CurrentUserProvider>
    </MemoryRouter>,
  );
}

describe("ProfilePage", () => {
  /**
   * The profile page's run is deliberately unscoped: from a personal page the useful
   * scan covers every account the user is on, which is the whole reason the capability
   * is offered here as well as per-account.
   */
  it("offers an unscoped GET Meeting Notes run", async () => {
    renderProfilePage();
    expect(await screen.findByTitle(/all of your accounts/i)).toBeInTheDocument();
  });

  it("renders with no working sessions or notes", async () => {
    renderProfilePage();
    await waitFor(() =>
      expect(screen.getByText("Working Sessions")).toBeInTheDocument());
  });

  /**
   * Regression: /layouts/working-sessions/ is a plain ModelViewSet, so it answers
   * with the DRF `{count, next, previous, results}` envelope. workingSessionApi.list
   * was typed as a bare array, so the envelope object landed in state typed
   * WorkingSession[] and `sessions.map(...)` threw during render — which unmounts
   * the route and leaves a blank page.
   */
  it("renders working sessions returned inside a paginated envelope", async () => {
    server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
      layoutsPage([
        mockWorkingSession({ id: 1, name: "Enveloped session" }),
        mockWorkingSession({ id: 2, name: "Second session" }),
      ])));

    renderProfilePage();

    await waitFor(() =>
      expect(screen.getByText("Enveloped session")).toBeInTheDocument());
    expect(screen.getByText("Second session")).toBeInTheDocument();
  });

  it("loads an existing notepad note out of the envelope", async () => {
    server.use(http.get("*/api/v1/layouts/page-notes/", () =>
      layoutsPage([mockUserPageNote({ id: 1, content: "my saved note" })])));

    renderProfilePage();

    // The notepad is a contenteditable (RichTextMentionEditor), not a textarea,
    // so the saved note is rendered text rather than a form value.
    await waitFor(() =>
      expect(screen.getByText("my saved note")).toBeInTheDocument());
  });

  /**
   * The export tray drags with the HTML5 API. This drop zone only had a dnd-kit
   * `useDroppable` and an `onDrop` prop that the component threw away
   * (`void onDrop; // handled via local context`), so a tray pill could never
   * land here — the two drag protocols cannot see each other.
   */
  describe("export-tray drops", () => {
    it("adds the dropped record to the active session", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals" })])));

      renderProfilePage();
      await screen.findByText("Renewals");
      fireEvent.click(screen.getByText("Renewals"));

      const zone = await screen.findByText(/Drop export items here/i);
      const dropArea = zone.parentElement as HTMLElement;
      fireEvent.dragOver(dropArea, { dataTransfer: trayDataTransfer() });
      fireEvent.drop(dropArea, { dataTransfer: trayDataTransfer() });

      expect(await screen.findByText(droppedItem.label)).toBeInTheDocument();
    });

    it("shows the full title and summary rather than one clipped line", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals", record_refs: [droppedItem] })])));

      renderProfilePage();
      fireEvent.click(await screen.findByText("Renewals"));

      const title = await screen.findByText(droppedItem.label);
      const summary = screen.getByText(droppedItem.summary);
      // `nowrap` + ellipsis here meant the summary was reduced to its first clause
      // even though the container has unlimited vertical room.
      for (const el of [title, summary]) {
        expect(el.style.whiteSpace).not.toBe("nowrap");
        expect(el.style.textOverflow).not.toBe("ellipsis");
        expect(el.style.overflowWrap).toBe("anywhere");
      }
    });

    it("ignores a drag that isn't a tray pill", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 1, name: "Renewals" })])));

      renderProfilePage();
      fireEvent.click(await screen.findByText("Renewals"));
      const dropArea = (await screen.findByText(/Drop export items here/i)).parentElement as HTMLElement;

      fireEvent.drop(dropArea, {
        dataTransfer: { types: ["text/plain"], getData: () => "" },
      });

      expect(screen.getByText(/Drop export items here/i)).toBeInTheDocument();
    });
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
      expect(screen.getByText("Working Sessions")).toBeInTheDocument());
  });
});
