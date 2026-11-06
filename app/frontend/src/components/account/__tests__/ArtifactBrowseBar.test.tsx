import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ArtifactBrowseBar } from "../ArtifactBrowseBar";
import { DEFAULT_ARTIFACT_BROWSE, type ArtifactBrowseState } from "../../../lib/artifactBrowse";
import { mockArtifact, mockCodeArtifact } from "../../../test/handlers/accounts";

let latest: ArtifactBrowseState = DEFAULT_ARTIFACT_BROWSE;
function Harness() {
  const [state, setState] = useState(DEFAULT_ARTIFACT_BROWSE);
  latest = state;
  return <ArtifactBrowseBar artifacts={[mockArtifact, { ...mockCodeArtifact, artifact_type: "file", mime_type: "application/pdf", name: "a.pdf" }]} state={state} onChange={setState} />;
}

describe("ArtifactBrowseBar", () => {
  it("highlights the search box only while it has a value", () => {
    render(<Harness />);
    const input = screen.getByTestId("artifact-search") as HTMLInputElement;
    expect(input.dataset.filtered).toBe("false");
    fireEvent.change(input, { target: { value: "x" } });
    expect(input.dataset.filtered).toBe("true");
    expect(input.style.boxShadow).toContain("245,158,11");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.dataset.filtered).toBe("false");
  });

  it("changes sort, group-by and toggles type chips", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Sort artifacts"), { target: { value: "name_asc" } });
    fireEvent.change(screen.getByLabelText("Group artifacts"), { target: { value: "creator" } });
    expect(latest.sort).toBe("name_asc");
    expect(latest.groupBy).toBe("creator");
    const chip = screen.getByTestId("artifact-type-chip-file:PDF");
    fireEvent.click(chip);
    expect(latest.types).toEqual(["file:PDF"]);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("Clear filters"));
    expect(latest.types).toEqual([]);
  });
});
