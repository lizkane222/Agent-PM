import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockProject } from "../../../test/handlers/accounts";
import { ProjectRecordLinks } from "../EventRecordLinks";

function renderLinks(id: string | null) {
  return render(<MemoryRouter><ProjectRecordLinks meetingAirtableId={id} /></MemoryRouter>);
}

describe("ProjectRecordLinks", () => {
  it("shows the project and goal a meeting is filed under, linking to the account", async () => {
    server.use(http.get("/api/v1/accounts/projects/", () => HttpResponse.json({
      results: [
        { ...mockProject, id: 1, account: 9, name: "Data Deletion", kind: "project", meeting_ids: ["recM1"] },
        { ...mockProject, id: 2, account: 9, name: "Milestone 1", kind: "goal", meeting_ids: ["recM1"] },
        { ...mockProject, id: 3, account: 9, name: "Unrelated", kind: "project", meeting_ids: ["recOther"] },
      ],
      count: 3,
    })));
    renderLinks("recM1");

    const link = await screen.findByText("Data Deletion");
    expect(link.closest("a")).toHaveAttribute("href", "/accounts/9");
    expect(screen.getByText("Milestone 1")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  });

  it("renders nothing for a meeting no project claims", async () => {
    renderLinks("recNone");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("panel-project-links")).not.toBeInTheDocument();
  });
});
