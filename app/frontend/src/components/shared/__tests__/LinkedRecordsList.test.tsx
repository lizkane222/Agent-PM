import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LinkedRecordsList from "../LinkedRecordsList";
import type { CommentReference } from "../../../types";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const meeting: CommentReference = { resource_type: "calendar_event", resource_id: 7, label: "Kickoff call", url: "/calendar" };
const project: CommentReference = { resource_type: "project", resource_id: 3, label: "Segment rollout", url: "/accounts/4" };
const goal: CommentReference = { resource_type: "goal", resource_id: 5, label: "Ship CDP", url: "/accounts/4" };
const item: CommentReference = { resource_type: "action_item", resource_id: 9, label: "Send SOW", url: "/action-items" };

function renderList(references: CommentReference[], title = "Used in") {
  return render(
    <MemoryRouter>
      <LinkedRecordsList title={title} references={references} />
    </MemoryRouter>,
  );
}

beforeEach(() => navigate.mockClear());

describe("LinkedRecordsList", () => {
  it("renders nothing when there are no references", () => {
    const { container } = renderList([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the section title and every reference label", () => {
    renderList([meeting, item]);
    expect(screen.getByText("Used in")).toBeInTheDocument();
    expect(screen.getByText("Kickoff call")).toBeInTheDocument();
    expect(screen.getByText("Send SOW")).toBeInTheDocument();
  });

  it("groups references under a per-type heading", () => {
    renderList([meeting, project, item]);
    expect(screen.getByText("Meetings")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Action items")).toBeInTheDocument();
  });

  it("keeps goals and projects in separate groups", () => {
    renderList([goal, project]);
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("orders groups with meetings before action items", () => {
    renderList([item, meeting]);
    const headings = screen.getAllByText(/^(Meetings|Action items)$/).map((el) => el.textContent);
    expect(headings).toEqual(["Meetings", "Action items"]);
  });

  it("navigates to the reference's own url on click, with no per-type routing", () => {
    renderList([project]);
    fireEvent.click(screen.getByRole("button", { name: /Segment rollout/ }));
    expect(navigate).toHaveBeenCalledWith("/accounts/4");
  });

  it("treats `meeting` and `calendar_event` as one Meetings group", () => {
    renderList([meeting, { resource_type: "meeting", resource_id: 8, label: "Weekly sync", url: "/calendar" }]);
    expect(screen.getAllByText("Meetings")).toHaveLength(1);
    expect(screen.getByText("Weekly sync")).toBeInTheDocument();
  });
});
