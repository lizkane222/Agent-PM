import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockUserProfile } from "../../../test/handlers/team";
import { seedStatusLabels } from "../../../hooks/useStatusLabels";
import StatusNamesSection from "../StatusNamesSection";

const ME_URL = "/api/v1/team/profiles/me/";

describe("StatusNamesSection", () => {
  beforeEach(() => seedStatusLabels({}));

  it("shows a segmented choice per status with the defaults selected", () => {
    render(<StatusNamesSection />);
    const open = screen.getByRole("radiogroup", { name: "Name for Open" });
    expect(within(open).getByRole("radio", { name: "Open" })).toHaveAttribute("aria-checked", "true");
    expect(within(open).getByRole("radio", { name: "Not Started" })).toHaveAttribute("aria-checked", "false");
    // Blocked has a single choice.
    expect(within(screen.getByRole("radiogroup", { name: "Name for Blocked" })).getAllByRole("radio")).toHaveLength(1);
  });

  it("updates the live preview and PATCHes on choice", async () => {
    let body: unknown = null;
    server.use(http.patch(ME_URL, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ ...mockUserProfile, ...(body as object) });
    }));
    render(<StatusNamesSection />);
    fireEvent.click(screen.getByRole("radio", { name: "Not Going To Do" }));
    expect(screen.getByLabelText("Preview for Backlogged")).toHaveTextContent("Not Going To Do");
    await waitFor(() => expect(body).toEqual({ status_labels: { Backlogged: "Not Going To Do" } }));
  });

  it("reverts and shows an error when saving fails", async () => {
    server.use(http.patch(ME_URL, () => HttpResponse.json({}, { status: 500 })));
    render(<StatusNamesSection />);
    fireEvent.click(screen.getByRole("radio", { name: "Completed" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(screen.getByLabelText("Preview for Done")).toHaveTextContent("Done");
  });
});
