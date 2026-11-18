import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DiscoverRedirect from "../DiscoverRedirect";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search + l.hash}</div>;
}

describe("/discover redirect", () => {
  it("goes to /discovery and keeps the query string and hash", () => {
    render(
      <MemoryRouter initialEntries={["/discover?tag=sms#top"]}>
        <Routes>
          <Route path="discover" element={<DiscoverRedirect />} />
          <Route path="discovery" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent).toBe("/discovery?tag=sms#top");
  });
});
