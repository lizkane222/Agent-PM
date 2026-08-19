import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http } from "msw";
import { server } from "../../test/msw-server";
import RolePage from "../RolePage";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import { layoutsPage, mockWorkingSession } from "../../test/handlers/layouts";

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
});
