import { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { DEFAULT_CATEGORY_COLORS } from "../../../lib/eventColors";
import CreateEventModal from "../CreateEventModal";
import type { NewEventDraft } from "../../../types/calendar";
import { mockArtifact, mockCodeArtifact } from "../../../test/handlers/accounts";

function blankDraft(overrides: Partial<NewEventDraft> = {}): NewEventDraft {
  return {
    start: "2026-08-20T10:00:00",
    end: "2026-08-20T11:00:00",
    allDay: false,
    title: "",
    type: "meeting",
    category: "meeting",
    accountQuery: "",
    selectedAccount: null,
    accountResults: [],
    guests: [],
    description: "",
    linkedActionItemIds: [],
    linkedArtifactIds: [],
    videoConference: "none",
    videoConferenceUrl: "",
    notificationMinutes: null,
    repeatFrequency: "none",
    ...overrides,
  };
}

// Thin wrapper so the component gets a real, stable MutableRefObject like it would from CalendarPage.
function Harness({ draft, onSaveSpy, zoomConnected = false }: {
  draft: NewEventDraft;
  onSaveSpy: (payload: unknown) => Promise<void>;
  zoomConnected?: boolean;
}) {
  const allAccountsRef = useRef<{ id: number; name: string }[]>([{ id: 1, name: "Acme Corp" }]);
  return (
    <CreateEventModal
      draft={draft}
      onChange={() => {}}
      onSave={onSaveSpy}
      onCancel={vi.fn()}
      saving={false}
      zoomConnected={zoomConnected}
      allAccountsRef={allAccountsRef}
    />
  );
}

// Stateful wrapper: keeps draft in real React state so onChange actually mutates what's rendered,
// matching how CalendarPage wires onChange={(updater) => setNewEventDraft((d) => d ? updater(d) : d)}.
function StatefulHarness({ initial, onSaveSpy, onCancelSpy, zoomConnected = false }: {
  initial: NewEventDraft;
  onSaveSpy: (payload: unknown) => Promise<void>;
  onCancelSpy?: () => void;
  zoomConnected?: boolean;
}) {
  const allAccountsRef = useRef<{ id: number; name: string }[]>([{ id: 1, name: "Acme Corp" }]);
  const [draft, setDraft] = useState(initial);
  return (
    <CreateEventModal
      draft={draft}
      onChange={(updater: (d: NewEventDraft) => NewEventDraft) => setDraft(updater)}
      onSave={onSaveSpy}
      onCancel={onCancelSpy ?? vi.fn()}
      saving={false}
      zoomConnected={zoomConnected}
      allAccountsRef={allAccountsRef}
    />
  );
}

describe("CreateEventModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the expanded category picker beyond meeting/action item", async () => {
    render(<Harness draft={blankDraft()} onSaveSpy={vi.fn()} />);
    await waitFor(() => screen.getByRole("button", { name: /Meeting/ }));
    expect(screen.getByRole("button", { name: /Task/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Out of Office/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Focus Time/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Working Location/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Appointment/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Action Item/ })).toBeInTheDocument();
  });

  it("Create button is disabled until a title is entered", async () => {
    render(<Harness draft={blankDraft()} onSaveSpy={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("hides guests, video conferencing, and repeat sections in action-item mode", async () => {
    render(<Harness draft={blankDraft({ type: "action-item", title: "Follow up" })} onSaveSpy={vi.fn()} />);
    expect(screen.queryByText("👥 Guests")).not.toBeInTheDocument();
    expect(screen.queryByText("🎥 Video conferencing")).not.toBeInTheDocument();
    expect(screen.queryByText("🔁 Repeat")).not.toBeInTheDocument();
  });

  it("saves immediately (no invite prompt) when there are no guests", async () => {
    const onSaveSpy = vi.fn().mockResolvedValue(undefined);
    render(<Harness draft={blankDraft({ title: "Q3 Planning" })} onSaveSpy={onSaveSpy} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sendInvites: false, effectiveCategory: "task" })
    ));
  });

  it("auto-downgrades an empty meeting (no guests, no video) to effectiveCategory 'task'", async () => {
    const onSaveSpy = vi.fn().mockResolvedValue(undefined);
    render(<Harness draft={blankDraft({ title: "Solo prep", category: "meeting" })} onSaveSpy={onSaveSpy} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveCategory: "task" })
    ));
  });

  it("shows the send-invitations prompt when guests are present, and Don't send saves without inviting", async () => {
    const onSaveSpy = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        draft={blankDraft({ title: "Team Sync", guests: [{ email: "bob@example.com", name: "Bob", source: "manual" }] })}
        onSaveSpy={onSaveSpy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Would you like to send invitation emails to guests?");
    fireEvent.click(screen.getByRole("button", { name: "Don't send" }));
    await waitFor(() => expect(onSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sendInvites: false })
    ));
  });

  it("Send in the invite prompt saves with sendInvites: true", async () => {
    const onSaveSpy = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        draft={blankDraft({ title: "Team Sync", guests: [{ email: "bob@example.com", name: "Bob", source: "manual" }] })}
        onSaveSpy={onSaveSpy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Would you like to send invitation emails to guests?");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sendInvites: true })
    ));
  });

  it("Zoom video option shows a Settings link when zoomConnected is false", async () => {
    render(<Harness draft={blankDraft({ title: "Vendor call", videoConference: "zoom" })} onSaveSpy={vi.fn()} zoomConnected={false} />);
    expect(screen.getByRole("link", { name: "connect Zoom in Settings" })).toBeInTheDocument();
  });

  it("Zoom video option shows a connected message when zoomConnected is true", async () => {
    render(<Harness draft={blankDraft({ title: "Vendor call", videoConference: "zoom" })} onSaveSpy={vi.fn()} zoomConnected />);
    expect(screen.getByText(/Zoom is connected/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "connect Zoom in Settings" })).not.toBeInTheDocument();
  });

  it("selecting a category updates the active pill", async () => {
    render(
      <StatefulHarness
        initial={blankDraft({ title: "Deep work" })}
        onSaveSpy={vi.fn()}
      />
    );
    const focusBtn = screen.getByRole("button", { name: /Focus Time/ });
    fireEvent.click(focusBtn);
    // The active pill takes the user's chosen color for that type (lib/eventColors.ts),
    // so it matches the event the calendar will draw.
    await waitFor(() => expect(focusBtn).toHaveAttribute("data-active", "true"));
    expect(focusBtn).toHaveAttribute("data-color", DEFAULT_CATEGORY_COLORS.focus_time);
  });

  it("typing a new email and pressing Enter adds it as a guest", async () => {
    render(<StatefulHarness initial={blankDraft({ title: "Kickoff" })} onSaveSpy={vi.fn()} />);
    const guestInput = screen.getByPlaceholderText("Search by name or paste an email…");
    fireEvent.change(guestInput, { target: { value: "newperson@twilio.com" } });
    fireEvent.keyDown(guestInput, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("newperson@twilio.com")).toBeInTheDocument());
  });

  it("Cancel button calls onCancel", async () => {
    const onCancelSpy = vi.fn();
    render(<StatefulHarness initial={blankDraft({ title: "X" })} onSaveSpy={vi.fn()} onCancelSpy={onCancelSpy} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancelSpy).toHaveBeenCalled();
  });
});

// ── Account picker: duplicate/blank account names must not produce duplicate React keys ──

/**
 * The reported bug: a React "two children with the same key, ``" warning on the account
 * autocomplete <ul>. The list was keyed on `a.name` — a business-name string that this
 * codebase's own history (the 2026-08-17 "Duplicate Admin/ADMIN account merge" entry) shows
 * is not guaranteed unique or non-empty. Keyed on `a.id` (a guaranteed-unique number) instead.
 */
function HarnessWithAccounts({
  draft,
  accounts,
  onSaveSpy,
}: {
  draft: NewEventDraft;
  accounts: { id: number; name: string }[];
  onSaveSpy: (payload: unknown) => Promise<void>;
}) {
  const allAccountsRef = useRef<{ id: number; name: string }[]>(accounts);
  return (
    <CreateEventModal
      draft={draft}
      onChange={() => {}}
      onSave={onSaveSpy}
      onCancel={vi.fn()}
      saving={false}
      zoomConnected={false}
      allAccountsRef={allAccountsRef}
    />
  );
}

describe("CreateEventModal — account picker keys", () => {
  it("does not warn about duplicate/empty keys when two accounts share a blank name", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <HarnessWithAccounts
        draft={blankDraft({ accountResults: [{ id: 1, name: "" }, { id: 2, name: "" }] })}
        accounts={[{ id: 1, name: "" }, { id: 2, name: "" }]}
        onSaveSpy={vi.fn()}
      />
    );

    const duplicateKeyWarning = errorSpy.mock.calls.some((call) =>
      String(call[0]).includes("Encountered two children with the same key")
    );
    expect(duplicateKeyWarning).toBe(false);
    errorSpy.mockRestore();
  });

  it("renders both entries distinctly when two accounts share the same name", async () => {
    render(
      <HarnessWithAccounts
        draft={blankDraft({ accountResults: [{ id: 1, name: "Acme Corp" }, { id: 2, name: "Acme Corp" }] })}
        accounts={[{ id: 1, name: "Acme Corp" }, { id: 2, name: "Acme Corp" }]}
        onSaveSpy={vi.fn()}
      />
    );

    const matches = await screen.findAllByRole("button", { name: "Acme Corp" });
    expect(matches).toHaveLength(2);
  });
});

// ── Account picker: the results list must not be artificially truncated ──

/**
 * The reported bug: the account-search dropdown capped itself at 8 results even though
 * the results <ul> is already a scrollable container (overflow-y-auto max-h-40). Unlike
 * HarnessWithAccounts above (whose onChange is a no-op and which seeds accountResults
 * directly), this harness keeps real React state so the component's own onFocus/onChange
 * handlers — where the cap used to live — actually run.
 */
function StatefulHarnessWithAccounts({
  accounts,
  onSaveSpy,
}: {
  accounts: { id: number; name: string }[];
  onSaveSpy: (payload: unknown) => Promise<void>;
}) {
  const allAccountsRef = useRef<{ id: number; name: string }[]>(accounts);
  const [draft, setDraft] = useState(blankDraft());
  return (
    <CreateEventModal
      draft={draft}
      onChange={(updater: (d: NewEventDraft) => NewEventDraft) => setDraft(updater)}
      onSave={onSaveSpy}
      onCancel={vi.fn()}
      saving={false}
      zoomConnected={false}
      allAccountsRef={allAccountsRef}
    />
  );
}

describe("CreateEventModal — account picker result list is not truncated", () => {
  it("shows all accounts on focus when the user has more than 8 accounts", async () => {
    const accounts = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Account ${i + 1}` }));
    render(<StatefulHarnessWithAccounts accounts={accounts} onSaveSpy={vi.fn()} />);

    fireEvent.focus(screen.getByPlaceholderText("Search accounts…"));

    const results = await screen.findAllByRole("button", { name: /^Account \d+$/ });
    expect(results).toHaveLength(12);
  });

  it("shows all matches when a query matches more than 8 accounts", async () => {
    const accounts = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Acme ${i + 1}` }));
    render(<StatefulHarnessWithAccounts accounts={accounts} onSaveSpy={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search accounts…"), { target: { value: "Acme" } });

    const results = await screen.findAllByRole("button", { name: /^Acme \d+$/ });
    expect(results).toHaveLength(10);
  });

  it("keeps the results list scrollable rather than clipped", async () => {
    const accounts = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Account ${i + 1}` }));
    render(<StatefulHarnessWithAccounts accounts={accounts} onSaveSpy={vi.fn()} />);

    fireEvent.focus(screen.getByPlaceholderText("Search accounts…"));
    await screen.findAllByRole("button", { name: /^Account \d+$/ });

    const list = screen.getByPlaceholderText("Search accounts…").parentElement?.querySelector("ul");
    expect(list?.className).toContain("overflow-y-auto");
    expect(list?.className).toContain("max-h-40");
  });
});

// ── Artifacts: gated on a linked account, pulled from the account's own artifacts ──

describe("CreateEventModal — link artifacts to the event", () => {
  it("shows no 'Link artifacts' control when no account is selected", async () => {
    render(<Harness draft={blankDraft({ title: "No account yet" })} onSaveSpy={vi.fn()} />);
    expect(screen.queryByText("Link artifacts")).not.toBeInTheDocument();
  });

  it("shows 'Link artifacts' and the account's existing artifacts once an account is selected", async () => {
    render(
      <StatefulHarness
        initial={blankDraft({ title: "Kickoff", selectedAccount: { id: 1, name: "Acme Corp" } })}
        onSaveSpy={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByText("Link artifacts"));
    expect(await screen.findByText(mockArtifact.name)).toBeInTheDocument();
    expect(await screen.findByText(mockCodeArtifact.name)).toBeInTheDocument();
  });

  it("still offers '+ New artifact' when the selected account has zero existing artifacts", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () => HttpResponse.json([]))
    );
    render(
      <StatefulHarness
        initial={blankDraft({ title: "Fresh account", selectedAccount: { id: 999, name: "Brand New Co" } })}
        onSaveSpy={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByText("Link artifacts"));
    // The gate under test is draft.selectedAccount, not availableArtifacts.length —
    // this account has zero existing artifacts and the control must still appear.
    expect(await screen.findByText("+ New artifact")).toBeInTheDocument();
    expect(screen.queryByText(mockArtifact.name)).not.toBeInTheDocument();
  });

  it("creating a new artifact adds it to the checkbox list, checked, and to draft.linkedArtifactIds", async () => {
    render(
      <StatefulHarness
        initial={blankDraft({ title: "Kickoff", selectedAccount: { id: 1, name: "Acme Corp" } })}
        onSaveSpy={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByText("Link artifacts"));
    await screen.findByText(mockArtifact.name);

    fireEvent.click(screen.getByText("+ New artifact"));
    fireEvent.change(screen.getByPlaceholderText("Artifact name"), { target: { value: "Runbook" } });
    fireEvent.change(screen.getByPlaceholderText("https://…"), { target: { value: "https://example.com/runbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const newCheckbox = (await screen.findByText("Runbook")).closest("label")?.querySelector("input[type=checkbox]");
    await waitFor(() => expect(newCheckbox).toBeChecked());
    // The new-artifact form collapses back to the "+ New artifact" prompt on success.
    expect(screen.getByText("+ New artifact")).toBeInTheDocument();
  });

  it("passes draft.linkedArtifactIds through to onSave when creating the event", async () => {
    const onSaveSpy = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        draft={blankDraft({
          title: "Kickoff",
          selectedAccount: { id: 1, name: "Acme Corp" },
          linkedArtifactIds: [mockArtifact.id, mockCodeArtifact.id],
        })}
        onSaveSpy={onSaveSpy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ linkedArtifactIds: [mockArtifact.id, mockCodeArtifact.id] }),
      })
    ));
  });
});
