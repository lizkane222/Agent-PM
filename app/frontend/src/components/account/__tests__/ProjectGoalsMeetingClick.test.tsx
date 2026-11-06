import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectGoals } from "../ProjectGoals";
import { truncateWords } from "../../../lib/truncateWords";
import type { AirtableMeeting, GoalSection } from "../../../types";

vi.mock("../../../hooks/useExportTray", () => ({
  useExportTray: () => ({ addToTray: vi.fn(), isSelected: vi.fn(() => false), exportMode: false }),
}));
vi.mock("../ActionItemModal", () => ({ ActionItemModal: () => null }));

const meeting = {
  id: 1, airtable_id: "recM", account: 1, account_name: "Acme",
  name: "a b c d e f g h i j k l", date: null, duration: 0, expected_topics: "", gong_notes: "",
  gong_url: "", zoom_notes: "", zoom_url: "", customer_slack: "", account_team_slack: "", last_synced: "",
} as AirtableMeeting;

const project: GoalSection = {
  id: "1", name: "Rollout", kind: "project", url: "", actionIds: [], meetingIds: ["recM"],
  goalIds: [], resources: [], sfData: {}, sfProjectId: "",
};

describe("ProjectGoals meetings", () => {
  it("truncateWords keeps up to N words", () => {
    expect(truncateWords("a b c", 10)).toBe("a b c");
    expect(truncateWords("a b c d", 3)).toBe("a b c…");
  });

  it("lists the full name (10 words max) and opens the panel on click", () => {
    const onSelectMeeting = vi.fn();
    render(
      <ProjectGoals goals={[project]} actionItems={[]} meetings={[meeting]} onChange={vi.fn()} onSelectMeeting={onSelectMeeting} />,
    );
    const row = screen.getByTestId("goal-meeting-row");
    expect(row.textContent).toContain("a b c d e f g h i j…");
    expect(row.textContent).not.toContain("k l");
    fireEvent.click(row);
    expect(onSelectMeeting).toHaveBeenCalledWith(meeting);
  });

  it("removing a meeting does not open the panel", () => {
    const onSelectMeeting = vi.fn();
    const onChange = vi.fn();
    render(
      <ProjectGoals goals={[project]} actionItems={[]} meetings={[meeting]} onChange={onChange} onSelectMeeting={onSelectMeeting} />,
    );
    fireEvent.click(screen.getByTestId("goal-meeting-row").querySelector("button")!);
    expect(onSelectMeeting).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });
});
