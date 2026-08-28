/**
 * ProjectGoals — the "New Project" modal (all Salesforce-style sections,
 * collapsible, SF fetch, per-project Team Members) plus the project/goal board.
 *
 * This component previously had zero tests: it was built but never wired into
 * AccountDetailPage, which rendered its own much simpler inline copy instead.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";

import { ProjectGoals } from "../ProjectGoals";
import type { AccountTeamMember, AirtableActionItem, GoalSection, ProjectMember } from "../../../types";

vi.mock("../../../hooks/useExportTray", () => ({
  useExportTray: () => ({
    addToTray: vi.fn(),
    isSelected: vi.fn(() => false),
    exportMode: false,
  }),
}));

function makeDataTransfer(data: Record<string, string>) {
  return { getData: (key: string) => data[key] ?? "", types: Object.keys(data) };
}

function makeActionItem(overrides: Partial<AirtableActionItem> = {}): AirtableActionItem {
  return {
    id: 1, airtable_id: "a1", account: 1, account_name: "Acme", task: "Ship it",
    task_details: "", status: "Open", priority: "High", due_date: null,
    estimated_time: 0, time_spent: 0, prep_time: 0, slack_thread_url: "",
    salesforce_task_id: "", assignee_airtable_id: "", assignee_name: "",
    reminder: null, reminder_id: null, reminder_due_at: null, reminder_status: null,
    linked_meeting: null, linked_meeting_name: null, created_at: "", updated_at: "",
    marked_done_at: null, last_synced: "",
    ...overrides,
  } as AirtableActionItem;
}

function baseGoal(overrides: Partial<GoalSection> = {}): GoalSection {
  return {
    id: "1",
    name: "Segment Data Deletion",
    kind: "project",
    url: "",
    actionIds: [],
    meetingIds: [],
    goalIds: [],
    resources: [],
    sfData: {},
    sfProjectId: "",
    ...overrides,
  };
}

const teamMember: AccountTeamMember = {
  id: 5,
  full_name: "Ashley Shadday",
  title: "PM",
  email: "ashley@example.com",
  avatar_url: "",
  slack_handle: "",
};

function renderBoard(props: Partial<React.ComponentProps<typeof ProjectGoals>> = {}) {
  const onChange = vi.fn();
  render(
    <ProjectGoals
      goals={props.goals ?? []}
      actionItems={props.actionItems ?? []}
      meetings={props.meetings ?? []}
      onChange={onChange}
      accountTeamMembers={props.accountTeamMembers}
      projectMembers={props.projectMembers}
      onAddProjectMember={props.onAddProjectMember}
      onRemoveProjectMember={props.onRemoveProjectMember}
    />
  );
  return { onChange };
}

describe("ProjectGoals — board", () => {
  it("offers New Project and New Goal actions", () => {
    renderBoard();
    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new goal/i })).toBeInTheDocument();
  });

  it("shows member avatars on a project card without opening the modal", () => {
    const goal = baseGoal();
    const members: ProjectMember[] = [
      { id: 1, project: 1, team_member: 5, team_member_name: "Ashley Shadday", team_member_email: "a@x.com", team_member_avatar_url: "", role: "", added_by: null, created_at: "2026-01-01T00:00:00Z" },
    ];
    renderBoard({ goals: [goal], projectMembers: members });
    expect(screen.getByTitle("Ashley Shadday")).toBeInTheDocument();
  });

  it("renders resources above meetings and action items within a goal", () => {
    const goal = baseGoal({
      kind: "goal",
      resources: [{ id: "artifact-1", label: "Spec Doc", url: "https://docs.example.com" }],
      meetingIds: ["m1"],
    });
    renderBoard({
      goals: [goal],
      meetings: [{ id: 1, airtable_id: "m1", account: 1, account_name: "Acme", name: "Kickoff", date: "2026-01-01", duration: 30, expected_topics: "", gong_notes: "", gong_url: "", zoom_notes: "", zoom_url: "", customer_slack: "", account_team_slack: "", last_synced: "" } as any],
    });
    const headings = screen.getAllByText(/Resources|Meetings/).map((el) => el.textContent);
    expect(headings.indexOf("Resources")).toBeLessThan(headings.indexOf("Meetings"));
  });
});

describe("ProjectGoals — single-owner move (project vs. nested goal)", () => {
  it("moving an action item onto a goal removes it from the project's own list", () => {
    const project = baseGoal({ id: "1", kind: "project", actionIds: ["a1"], goalIds: ["10"] });
    const goal = baseGoal({ id: "10", kind: "goal", name: "Milestone 1", actionIds: [] });
    const { onChange } = renderBoard({ goals: [project, goal], actionItems: [makeActionItem()] });

    fireEvent.drop(screen.getByTestId("goal-row-10"), { dataTransfer: makeDataTransfer({ goalActionId: "a1" }) });

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as GoalSection[];
    expect(updated.find((g) => g.id === "1")!.actionIds).toEqual([]);
    expect(updated.find((g) => g.id === "10")!.actionIds).toEqual(["a1"]);
  });

  it("moving an artifact from a goal back onto the project removes it from the goal", () => {
    const project = baseGoal({ id: "1", kind: "project", goalIds: ["10"] });
    const goal = baseGoal({
      id: "10", kind: "goal", name: "Milestone 1",
      resources: [{ id: "artifact-1", label: "Spec Doc", url: "https://docs.example.com" }],
    });
    const { onChange } = renderBoard({ goals: [project, goal] });

    fireEvent.drop(screen.getByTestId("project-row-1"), {
      dataTransfer: makeDataTransfer({ artifactDrop: JSON.stringify({ id: 1, name: "Spec Doc", url: "https://docs.example.com" }) }),
    });

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as GoalSection[];
    expect(updated.find((g) => g.id === "10")!.resources).toEqual([]);
    expect(updated.find((g) => g.id === "1")!.resources.map((r) => r.id)).toEqual(["artifact-1"]);
  });

  it("never renders an item under both a project and its goal, even with stale duplicate data", () => {
    const project = baseGoal({ id: "1", kind: "project", actionIds: ["a1"], goalIds: ["10"] });
    const goal = baseGoal({ id: "10", kind: "goal", name: "Milestone 1", actionIds: ["a1"] });
    renderBoard({ goals: [project, goal], actionItems: [makeActionItem()] });

    // Expand the goal so both possible render sites are visible at once.
    fireEvent.click(within(screen.getByTestId("goal-row-10")).getAllByRole("button")[0]);

    expect(screen.getAllByText("Ship it")).toHaveLength(1);
  });
});

describe("ProjectGoals — project aggregate views", () => {
  function setUpCluster() {
    const project = baseGoal({ id: "1", kind: "project", goalIds: ["10"], resources: [{ id: "artifact-p", label: "Project Doc", url: "" }] });
    const goal = baseGoal({
      id: "10", kind: "goal", name: "Milestone 1",
      actionIds: ["a-open", "a-progress", "a-done", "a-blocked", "a-backlog"],
      resources: [{ id: "artifact-g", label: "Goal Doc", url: "" }],
    });
    const actionItems = [
      makeActionItem({ airtable_id: "a-open", task: "Open task", status: "Open" }),
      makeActionItem({ airtable_id: "a-progress", task: "In progress task", status: "In Progress" }),
      makeActionItem({ airtable_id: "a-done", task: "Done task", status: "Done" }),
      makeActionItem({ airtable_id: "a-blocked", task: "Blocked task", status: "Blocked" }),
      makeActionItem({ airtable_id: "a-backlog", task: "Backlogged task", status: "Backlogged" }),
    ];
    renderBoard({ goals: [project, goal], actionItems });
  }

  it("defaults to the Goals tree view", () => {
    setUpCluster();
    expect(screen.getByText("Milestone 1")).toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });

  it("Open tab shows only Open-status items across the project and its goals", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Open task")).toBeInTheDocument();
    expect(screen.queryByText("In progress task")).not.toBeInTheDocument();
    expect(screen.queryByText("Done task")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocked task")).not.toBeInTheDocument();
  });

  it("Pending tab shows In Progress items", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Pending" }));
    expect(screen.getByText("In progress task")).toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });

  it("Closed tab shows Done items", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(screen.getByText("Done task")).toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });

  it("Blocked/Backlogged tab shows both Blocked and Backlogged items", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Blocked/Backlogged" }));
    expect(screen.getByText("Blocked task")).toBeInTheDocument();
    expect(screen.getByText("Backlogged task")).toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });

  it("Artifacts tab shows resources from both the project and its goals", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Artifacts" }));
    expect(screen.getByText("Project Doc")).toBeInTheDocument();
    expect(screen.getByText("Goal Doc")).toBeInTheDocument();
  });

  it("tags each aggregated item with its owning goal or \"Project\"", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Artifacts" }));
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Milestone 1")).toBeInTheDocument();
  });

  it("search filters the active tab by text", () => {
    setUpCluster();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.change(screen.getByPlaceholderText(/search this project's goals/i), { target: { value: "nomatch" } });
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it("searching from the default Goals view searches across every status and artifacts", () => {
    setUpCluster();
    fireEvent.change(screen.getByPlaceholderText(/search this project's goals/i), { target: { value: "blocked" } });
    expect(screen.getByText("Blocked task")).toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });
});

describe("ProjectGoals — ProjectDetailsModal", () => {
  async function openModal(goals: GoalSection[] = [], extraProps: Partial<React.ComponentProps<typeof ProjectGoals>> = {}) {
    const user = userEvent.setup();
    const utils = renderBoard({ goals, ...extraProps });
    if (goals.length === 0) {
      await user.click(screen.getByRole("button", { name: /new project/i }));
    } else {
      await user.click(screen.getByRole("button", { name: new RegExp(goals[0].name, "i") }));
    }
    return { user, ...utils };
  }

  it("all sections are collapsed by default and can be expanded independently", async () => {
    const { user } = await openModal();
    expect(screen.queryByText(/Project Status/i)).not.toBeInTheDocument();
    await user.click(screen.getByText("Overview"));
    expect(screen.getByText(/Project Status/i)).toBeInTheDocument();
    // A second section stays collapsed.
    expect(screen.queryByText(/Created By/i)).not.toBeInTheDocument();
  });

  it("includes the System Information section", async () => {
    const { user } = await openModal();
    await user.click(screen.getByText("System Information"));
    expect(screen.getByText("Created By")).toBeInTheDocument();
    expect(screen.getByText("Desired End Date")).toBeInTheDocument();
  });

  it("disables Fetch from Salesforce until a project id is entered", async () => {
    const { user } = await openModal();
    const fetchBtn = screen.getByRole("button", { name: /fetch from salesforce/i });
    expect(fetchBtn).toBeDisabled();
    await user.type(screen.getByPlaceholderText("a0B…"), "a0B123");
    expect(fetchBtn).not.toBeDisabled();
  });

  it("fetches and merges Salesforce data without clobbering manually-set fields", async () => {
    const { user } = await openModal();
    await user.click(screen.getByText("Overview"));
    // Manually set Project Status before fetching — the fetch response's "In Progress"
    // must not override it, since a human edit should always win over a re-fetch.
    const statusSelect = within(screen.getByText("Project Status").closest("div")!).getByRole("combobox");
    await user.selectOptions(statusSelect, "On Hold");

    await user.type(screen.getByPlaceholderText("a0B…"), "a0B123");
    await user.click(screen.getByRole("button", { name: /fetch from salesforce/i }));

    expect(await screen.findByText(/1 field not found on the connected org/i)).toBeInTheDocument();
    expect(statusSelect).toHaveValue("On Hold");
  });

  it("shows an error state when the fetch fails", async () => {
    server.use(
      http.post("/api/v1/accounts/projects/fetch-salesforce/", () =>
        HttpResponse.json({ detail: "Salesforce is not connected for this user." }, { status: 400 })
      )
    );
    const { user } = await openModal();
    await user.type(screen.getByPlaceholderText("a0B…"), "a0B123");
    await user.click(screen.getByRole("button", { name: /fetch from salesforce/i }));
    expect(await screen.findByText(/could not fetch from salesforce/i)).toBeInTheDocument();
  });

  it("prompts to save before team members can be added on a brand-new project", async () => {
    const { user } = await openModal();
    await user.click(screen.getByText(/team members/i));
    expect(screen.getByText(/save the project first/i)).toBeInTheDocument();
  });

  it("lists team members and lets the caller add another from the account roster", async () => {
    const goal = baseGoal({ id: "1" });
    const members: ProjectMember[] = [];
    const onAddProjectMember = vi.fn();
    const { user } = await openModal([goal], {
      accountTeamMembers: [teamMember],
      projectMembers: members,
      onAddProjectMember,
    });
    await user.click(screen.getByText(/team members/i));
    expect(screen.getByText(/no team members yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /\+ add team member/i }));
    await user.selectOptions(screen.getByRole("combobox"), ["5"]);
    expect(onAddProjectMember).toHaveBeenCalledWith(1, 5);
  });

  it("removes a team member via the modal", async () => {
    const goal = baseGoal({ id: "1" });
    const members: ProjectMember[] = [
      { id: 42, project: 1, team_member: 5, team_member_name: "Ashley Shadday", team_member_email: "a@x.com", team_member_avatar_url: "", role: "Lead", added_by: null, created_at: "2026-01-01T00:00:00Z" },
    ];
    const onRemoveProjectMember = vi.fn();
    const { user } = await openModal([goal], {
      accountTeamMembers: [teamMember],
      projectMembers: members,
      onRemoveProjectMember,
    });
    await user.click(screen.getByText(/team members/i));
    const row = screen.getByText(/Ashley Shadday — Lead/).closest("div")!;
    await user.click(within(row).getByRole("button"));
    expect(onRemoveProjectMember).toHaveBeenCalledWith(42);
  });

  it("saves the sf_project_id alongside the rest of the draft", async () => {
    const user = userEvent.setup();
    const { onChange } = renderBoard();
    await user.click(screen.getByRole("button", { name: /new project/i }));
    const nameInput = screen.getAllByRole("textbox")[0];
    await user.type(nameInput, "New Initiative");
    await user.type(screen.getByPlaceholderText("a0B…"), "a0B999");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onChange).toHaveBeenCalled();
    const saved = onChange.mock.calls[0][0][0];
    expect(saved.sfProjectId).toBe("a0B999");
    expect(saved.name).toBe("New Initiative");
  });
});
