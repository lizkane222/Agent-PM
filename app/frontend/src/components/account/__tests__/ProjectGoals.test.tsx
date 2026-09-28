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

// ActionItemCard opens this modal internally on click; the real one renders
// SVG-icon imports that jsdom can't handle. Same stub ActionItemCard.test.tsx uses.
vi.mock("../ActionItemModal", () => ({
  ActionItemModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="action-item-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
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
      onSelectAction={props.onSelectAction}
      accountTeamMembers={props.accountTeamMembers}
      projectMembers={props.projectMembers}
      onAddProjectMember={props.onAddProjectMember}
      onRemoveProjectMember={props.onRemoveProjectMember}
      onCloudCoachSyncResult={props.onCloudCoachSyncResult}
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

describe("ProjectGoals — resource drag reassignment", () => {
  it("moving a resource from a goal onto its parent project removes it from the goal", () => {
    const project = baseGoal({ id: "1", kind: "project", goalIds: ["10"] });
    const goal = baseGoal({
      id: "10", kind: "goal", name: "Milestone 1",
      resources: [{ id: "res-1", label: "Spec Doc", url: "https://docs.example.com" }],
    });
    const { onChange } = renderBoard({ goals: [project, goal] });

    fireEvent.drop(screen.getByTestId("project-row-1"), {
      dataTransfer: makeDataTransfer({ goalResourceId: "res-1" }),
    });

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as GoalSection[];
    expect(updated.find((g) => g.id === "10")!.resources).toEqual([]);
    expect(updated.find((g) => g.id === "1")!.resources).toEqual([
      { id: "res-1", label: "Spec Doc", url: "https://docs.example.com" },
    ]);
  });

  it("moving a resource between goals under two different projects reassigns it", () => {
    const projectA = baseGoal({ id: "1", kind: "project", goalIds: ["10"] });
    const goalA = baseGoal({
      id: "10", kind: "goal", name: "Milestone 1",
      resources: [{ id: "res-1", label: "Spec Doc", url: "https://docs.example.com" }],
    });
    const projectB = baseGoal({ id: "2", kind: "project", name: "Other Project", goalIds: ["20"] });
    const goalB = baseGoal({ id: "20", kind: "goal", name: "Milestone 2" });
    const { onChange } = renderBoard({ goals: [projectA, goalA, projectB, goalB] });

    fireEvent.drop(screen.getByTestId("goal-row-20"), {
      dataTransfer: makeDataTransfer({ goalResourceId: "res-1" }),
    });

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as GoalSection[];
    expect(updated.find((g) => g.id === "10")!.resources).toEqual([]);
    expect(updated.find((g) => g.id === "20")!.resources.map((r) => r.id)).toEqual(["res-1"]);
  });

  it("keeps a resource row draggable with the goalResourceId dataTransfer key the drop handler expects", () => {
    const project = baseGoal({
      id: "1", kind: "project",
      resources: [{ id: "res-1", label: "Spec Doc", url: "https://docs.example.com" }],
    });
    renderBoard({ goals: [project] });

    const row = screen.getByText("Spec Doc").closest("[draggable]");
    expect(row).not.toBeNull();
    const setData = vi.fn();
    fireEvent.dragStart(row!, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("goalResourceId", "res-1");
  });
});

describe("ProjectGoals — collapsed action items", () => {
  function setUpGoalWithItem(overrides: Partial<AirtableActionItem> = {}) {
    const project = baseGoal({ id: "1", kind: "project", goalIds: ["10"] });
    const goal = baseGoal({ id: "10", kind: "goal", name: "Milestone 1", actionIds: ["a1"] });
    const item = makeActionItem({ task_details: "Some details about the task", priority: "Critical", ...overrides });
    return { project, goal, item };
  }

  it("renders an action item inside a goal collapsed by default", () => {
    const { project, goal, item } = setUpGoalWithItem();
    renderBoard({ goals: [project, goal], actionItems: [item] });

    // Expand the goal row so the collapsed action-item row is visible.
    fireEvent.click(within(screen.getByTestId("goal-row-10")).getAllByRole("button")[0]);

    expect(screen.getByText("Ship it")).toBeInTheDocument();
    // Full-card-only content must not be present while collapsed.
    expect(screen.queryByText("Some details about the task")).not.toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });

  it("expands a collapsed action item on click without opening the modal", () => {
    const { project, goal, item } = setUpGoalWithItem();
    const onSelectAction = vi.fn();
    renderBoard({ goals: [project, goal], actionItems: [item], onSelectAction });

    fireEvent.click(within(screen.getByTestId("goal-row-10")).getAllByRole("button")[0]);
    fireEvent.click(screen.getByText("Ship it"));

    expect(screen.getByText("Some details about the task")).toBeInTheDocument();
    expect(onSelectAction).not.toHaveBeenCalled();
  });

  it("opens the action item modal only when the already-expanded card is clicked", () => {
    const { project, goal, item } = setUpGoalWithItem();
    const onSelectAction = vi.fn();
    renderBoard({ goals: [project, goal], actionItems: [item], onSelectAction });

    fireEvent.click(within(screen.getByTestId("goal-row-10")).getAllByRole("button")[0]);
    // First click expands.
    fireEvent.click(screen.getByText("Ship it"));
    expect(onSelectAction).not.toHaveBeenCalled();

    // Second click, now on the expanded full card, opens the modal.
    fireEvent.click(screen.getByText("Ship it"));
    expect(onSelectAction).toHaveBeenCalledWith(item);
  });

  it("keeps a collapsed row draggable with the same dataTransfer keys the drop handler expects", () => {
    const { project, goal, item } = setUpGoalWithItem();
    renderBoard({ goals: [project, goal], actionItems: [item] });

    fireEvent.click(within(screen.getByTestId("goal-row-10")).getAllByRole("button")[0]);

    const row = screen.getByText("Ship it").closest("[draggable]");
    expect(row).not.toBeNull();
    const setData = vi.fn();
    fireEvent.dragStart(row!, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("goalActionId", "a1");
    expect(setData).toHaveBeenCalledWith("timelineActionId", "a1");
  });

  it("folds an expanded action item back down via its Collapse control", () => {
    const { project, goal, item } = setUpGoalWithItem();
    renderBoard({ goals: [project, goal], actionItems: [item] });

    fireEvent.click(within(screen.getByTestId("goal-row-10")).getAllByRole("button")[0]);
    fireEvent.click(screen.getByText("Ship it"));
    expect(screen.getByText("Some details about the task")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Collapse"));

    expect(screen.queryByText("Some details about the task")).not.toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
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

// ── Cloud Coach member backfill ────────────────────────────────────────────────
//
// Two-step by design: the first click previews (dry_run) so the plan can be read before
// anything is written to a shared Salesforce org. Request bodies are asserted at the MSW
// layer rather than by mocking lib/api, because "the first call must be a dry run" is the
// whole safety property.

describe("ProjectGoals — sync members to Cloud Coach", () => {
  const SAVED_PROJECT: GoalSection = {
    id: "7",
    name: "Acme Rollout",
    description: "",
    url: "",
    kind: "project",
    sfProjectId: "a0B000000000001",
    actionIds: [],
    meetingIds: [],
    goalIds: [],
    resources: [],
    sfData: {},
  };

  const MEMBER: ProjectMember = {
    id: 11,
    project: 7,
    team_member: 5,
    team_member_name: "Ashley Shadday",
    team_member_email: "ashley@example.com",
    team_member_avatar_url: "",
    role: "",
    added_by: null,
    created_at: "2026-08-31T00:00:00Z",
  };

  async function openMembers(overrides: Partial<React.ComponentProps<typeof ProjectGoals>> = {}) {
    const user = userEvent.setup();
    const props = {
      goals: [SAVED_PROJECT],
      projectMembers: [MEMBER],
      accountTeamMembers: [teamMember],
      ...overrides,
    };
    render(
      <ProjectGoals
        goals={props.goals}
        actionItems={[]}
        meetings={[]}
        onChange={vi.fn()}
        projectMembers={props.projectMembers}
        accountTeamMembers={props.accountTeamMembers}
        onCloudCoachSyncResult={props.onCloudCoachSyncResult}
      />
    );
    await user.click(screen.getByRole("button", { name: /Acme Rollout/i }));
    await user.click(screen.getByText(/Team Members/i));
    return { user };
  }

  it("previews first, then pushes on a second click", async () => {
    const bodies: Array<{ dry_run?: boolean }> = [];
    server.use(
      http.post("/api/v1/accounts/projects/:id/sync-members-to-salesforce/", async ({ request }) => {
        const body = (await request.json()) as { dry_run?: boolean };
        bodies.push(body);
        return HttpResponse.json({
          status: "ok",
          dry_run: !!body.dry_run,
          counts: { pushed: 1 },
          results: [{ status: "pushed", member_name: "Ashley Shadday", project_name: "Acme Rollout" }],
        });
      }),
    );

    const { user } = await openMembers();
    const button = screen.getByTestId("sync-members-to-cloud-coach");

    await user.click(button);
    expect(bodies).toEqual([{ dry_run: true }]);
    expect(await screen.findByTestId("sync-members-message")).toHaveTextContent("Would sync: 1 added");
    // The label changes so the second click is unambiguously a confirmation.
    expect(screen.getByTestId("sync-members-to-cloud-coach")).toHaveTextContent(/Confirm/);

    await user.click(screen.getByTestId("sync-members-to-cloud-coach"));
    expect(bodies).toEqual([{ dry_run: true }, { dry_run: false }]);
    expect(screen.getByTestId("sync-members-message")).toHaveTextContent("Synced: 1 added");
  });

  it("hands the real push results up for the toast, but not the dry run", async () => {
    const onCloudCoachSyncResult = vi.fn();
    server.use(
      http.post("/api/v1/accounts/projects/:id/sync-members-to-salesforce/", async ({ request }) => {
        const body = (await request.json()) as { dry_run?: boolean };
        return HttpResponse.json({
          status: "ok",
          dry_run: !!body.dry_run,
          counts: { pushed: 1 },
          results: [{ status: "pushed", member_name: "Ashley Shadday" }],
        });
      }),
    );

    const { user } = await openMembers({ onCloudCoachSyncResult });

    await user.click(screen.getByTestId("sync-members-to-cloud-coach"));
    expect(onCloudCoachSyncResult).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("sync-members-to-cloud-coach"));
    expect(onCloudCoachSyncResult).toHaveBeenCalledWith([
      { status: "pushed", member_name: "Ashley Shadday" },
    ]);
  });

  it("needs no confirmation when the dry run would change nothing", async () => {
    // Everyone is already on the project, so there is nothing to confirm.
    const bodies: Array<{ dry_run?: boolean }> = [];
    server.use(
      http.post("/api/v1/accounts/projects/:id/sync-members-to-salesforce/", async ({ request }) => {
        bodies.push((await request.json()) as { dry_run?: boolean });
        return HttpResponse.json({
          status: "ok", dry_run: true, counts: { already_member: 1 },
          results: [{ status: "already_member", member_name: "Ashley Shadday" }],
        });
      }),
    );

    const { user } = await openMembers();
    await user.click(screen.getByTestId("sync-members-to-cloud-coach"));

    expect(await screen.findByTestId("sync-members-message")).toHaveTextContent("1 already on it");
    expect(screen.getByTestId("sync-members-to-cloud-coach")).not.toHaveTextContent(/Confirm/);
    expect(bodies).toHaveLength(1);
  });

  it("reports a failure and resets to a preview", async () => {
    server.use(
      http.post("/api/v1/accounts/projects/:id/sync-members-to-salesforce/", () =>
        HttpResponse.json({ detail: "Could not reach Salesforce." }, { status: 502 })
      ),
    );

    const { user } = await openMembers();
    await user.click(screen.getByTestId("sync-members-to-cloud-coach"));

    expect(await screen.findByTestId("sync-members-message")).toHaveTextContent("Could not reach Salesforce.");
    expect(screen.getByTestId("sync-members-to-cloud-coach")).not.toHaveTextContent(/Confirm/);
  });

  it("is not offered on a project with no Salesforce id", async () => {
    await openMembers({ goals: [{ ...SAVED_PROJECT, sfProjectId: "" }] });

    expect(screen.queryByTestId("sync-members-to-cloud-coach")).not.toBeInTheDocument();
  });

  it("is not offered when the project has no members", async () => {
    await openMembers({ projectMembers: [] });

    expect(screen.queryByTestId("sync-members-to-cloud-coach")).not.toBeInTheDocument();
  });
});
