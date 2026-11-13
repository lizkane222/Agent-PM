import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ArtifactBrowseBar } from "../ArtifactBrowseBar";
import { DEFAULT_ARTIFACT_BROWSE, type ArtifactBrowseState } from "../../../lib/artifactBrowse";
import { mockArtifact, mockCodeArtifact } from "../../../test/handlers/accounts";

let latest: ArtifactBrowseState = DEFAULT_ARTIFACT_BROWSE;
const pdf = { ...mockCodeArtifact, id: 99, artifact_type: "file" as const, mime_type: "application/pdf", name: "a.pdf", uploaded_by_username: "zed" };
const linked = { ...mockArtifact, used_in: [{ resource_type: "action_item" as const, resource_id: 1, label: "AI", url: "/a" }] };
function Harness() {
  const [state, setState] = useState(DEFAULT_ARTIFACT_BROWSE);
  latest = state;
  return <ArtifactBrowseBar artifacts={[linked, pdf]} state={state} onChange={setState} />;
}

describe("ArtifactBrowseBar", () => {
  it("highlights the search box only while it has a value", () => {
    render(<Harness />);
    const input = screen.getByTestId("artifact-search") as HTMLInputElement;
    expect(input.dataset.filtered).toBe("false");
    fireEvent.change(input, { target: { value: "x" } });
    expect(input.dataset.filtered).toBe("true");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.dataset.filtered).toBe("false");
  });

  it("uses no native selects and keeps option rows hidden until opened", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector("select")).toBeNull();
    expect(screen.queryByRole("group", { name: "Sort by" })).toBeNull();
    fireEvent.click(screen.getByTestId("artifact-filter-sort"));
    expect(screen.getByRole("group", { name: "Sort by" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("artifact-filter-sort"));
    expect(screen.queryByRole("group", { name: "Sort by" })).toBeNull();
  });

  it("sorts via inline chips and shows a removable sort chip", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("artifact-filter-sort"));
    fireEvent.click(screen.getByTestId("artifact-sort-name_asc"));
    expect(latest.sort).toBe("name_asc");
    fireEvent.click(screen.getByLabelText("Remove filter Sort: Name A-Z"));
    expect(latest.sort).toBe("created_desc");
  });

  it("filters by category and creator chips, and removes them from the active row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("artifact-filter-category"));
    fireEvent.click(screen.getByTestId("artifact-type-chip-file:PDF"));
    expect(latest.types).toEqual(["file:PDF"]);
    fireEvent.click(screen.getByTestId("artifact-filter-creator"));
    fireEvent.click(screen.getByTestId("artifact-creator-chip-zed"));
    expect(latest.creators).toEqual(["zed"]);
    // Category (the type), creator - and the "Sort: Category" chip that clicking Category adds.
    expect(screen.getAllByTestId("artifact-active-chip")).toHaveLength(3);
    fireEvent.click(screen.getByLabelText("Remove filter By zed"));
    expect(latest.creators).toEqual([]);
  });

  it("toggles the linked-to-action-item filter and Clear resets everything", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("artifact-filter-linked"));
    expect(latest.linkedActionItem).toBe(true);
    expect(screen.getByTestId("artifact-filter-linked")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByTestId("artifact-search"), { target: { value: "q" } });
    fireEvent.click(screen.getByText("Clear"));
    expect(latest).toEqual(DEFAULT_ARTIFACT_BROWSE);
  });

  it("clicking the Category button sorts the results by category", () => {
    render(<Harness />);
    expect(latest.sort).toBe("created_desc");
    fireEvent.click(screen.getByTestId("artifact-filter-category"));
    expect(latest.sort).toBe("category");
    expect(screen.getByText("Sort: Category")).toBeInTheDocument();
  });

  it("closing the Category chips again keeps the category sort, and Sort offers a Category option", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("artifact-filter-category"));
    fireEvent.click(screen.getByTestId("artifact-filter-category"));
    expect(latest.sort).toBe("category");
    fireEvent.click(screen.getByTestId("artifact-filter-sort"));
    expect(screen.getByTestId("artifact-sort-category")).toHaveAttribute("aria-pressed", "true");
  });

  it("the sort can be removed from the active row, back to newest first", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("artifact-filter-category"));
    fireEvent.click(screen.getByLabelText("Remove filter Sort: Category"));
    expect(latest.sort).toBe("created_desc");
  });

  it("another sort chosen afterwards is not overridden", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("artifact-filter-category"));
    fireEvent.click(screen.getByTestId("artifact-filter-sort"));
    fireEvent.click(screen.getByTestId("artifact-sort-name_asc"));
    expect(latest.sort).toBe("name_asc");
  });
});
