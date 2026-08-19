import { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_CATEGORY_COLORS } from "../../../lib/eventColors";
import CreateEventModal from "../CreateEventModal";
import type { NewEventDraft } from "../../../types/calendar";

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
