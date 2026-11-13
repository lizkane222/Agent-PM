import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import OverlapPlanner from "../OverlapPlanner";

const people = [
  { id: "c:1", name: "Ann Lee", zone: "America/Chicago" },
  { id: "c:2", name: "Di Ames", zone: "Asia/Kolkata" },
];

describe("OverlapPlanner layout", () => {
  it("shows the overlapping times and Copy Times above the planner box", () => {
    render(<OverlapPlanner people={people} viewerZone="America/Los_Angeles" />);
    const root = screen.getByTestId("overlap-planner");
    const times = within(root).getByTestId("planner-times");
    const box = within(root).getByTestId("planner-box");
    expect(within(times).getByRole("button", { name: "Copy Times" })).toBeInTheDocument();
    expect(within(times).getByTestId("planner-summary")).toBeInTheDocument();
    // the times block precedes the planner box in the DOM, and the box doesn't contain it
    expect(times.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.contains(times)).toBe(false);
    expect(within(box).queryByRole("button", { name: "Copy Times" })).toBeNull();
  });
});
