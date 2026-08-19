import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http } from "msw";
import { server } from "../../test/msw-server";
import ProfilePage from "../ProfilePage";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import {
  layoutsPage,
  mockUserPageNote,
  mockWorkingSession,
} from "../../test/handlers/layouts";

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

    await waitFor(() =>
      expect(screen.getByDisplayValue("my saved note")).toBeInTheDocument());
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
