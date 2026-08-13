import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { server } from "../../../test/msw-server";
import { http, HttpResponse } from "msw";
import EventDetailPanel from "../EventDetailPanel";
import type { CalendarEvent } from "../../../types";

const mockEvent: CalendarEvent = {
  id: 42,
  owner: 1,
  owner_username: "alice",
  title: "Solo Standup",
  description: "Daily standup",
  location: "",
  start_datetime: "2026-08-05T09:00:00Z",
  end_datetime: "2026-08-05T09:30:00Z",
  all_day: false,
  status: "confirmed",
  account: null,
  account_name: null,
  google_event_id: "",
  meet_link: "",
  calendar_id: "",
  event_category: "meeting",
  is_synced: false,
  agentpm_airtable_id: "",
  attendees: [],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const mockEventMultiAttendee: CalendarEvent = {
  ...mockEvent,
  id: 43,
  title: "Team All Hands",
  attendees: [
    { email: "alice@twilio.com", displayName: "Alice", responseStatus: "accepted" },
    { email: "bob@twilio.com", displayName: "Bob", responseStatus: "needsAction" },
  ],
};

const defaultProps = {
  event: mockEvent,
  onClose: vi.fn(),
  onCollapse: vi.fn(),
};

describe("EventDetailPanel — meeting edit mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows event details in read mode by default", () => {
    render(<EventDetailPanel {...defaultProps} />);
    expect(screen.getByText("Solo Standup")).toBeInTheDocument();
    expect(screen.getByText("When")).toBeInTheDocument();
  });

  it("shows Edit meeting button for solo meetings when onSaveMeeting is provided", () => {
    render(<EventDetailPanel {...defaultProps} onSaveMeeting={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Edit meeting" })).toBeInTheDocument();
  });

  it("hides Edit meeting button when onSaveMeeting is not provided", () => {
    render(<EventDetailPanel {...defaultProps} />);
    expect(screen.queryByRole("button", { name: "Edit meeting" })).not.toBeInTheDocument();
  });

  it("hides Edit meeting button for meetings with multiple attendees", () => {
    render(
      <EventDetailPanel
        {...defaultProps}
        event={mockEventMultiAttendee}
        onSaveMeeting={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Edit meeting" })).not.toBeInTheDocument();
  });

  it("clicking Edit meeting switches to the edit form", () => {
    render(<EventDetailPanel {...defaultProps} onSaveMeeting={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit meeting" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Meeting")).toBeInTheDocument();
  });

  it("Cancel exits edit mode without saving", () => {
    render(<EventDetailPanel {...defaultProps} onSaveMeeting={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit meeting" })).toBeInTheDocument();
  });

  it("Save calls the API and invokes onSaveMeeting with the updated event", async () => {
    const onSaveMeeting = vi.fn();
    server.use(
      http.patch("/api/v1/scheduler/events/42/", async ({ request }) => {
        const body = await request.json() as Partial<CalendarEvent>;
        return HttpResponse.json({ ...mockEvent, ...body });
      })
    );
    render(<EventDetailPanel {...defaultProps} onSaveMeeting={onSaveMeeting} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit meeting" }));

    const titleInput = screen.getByDisplayValue("Solo Standup");
    fireEvent.change(titleInput, { target: { value: "Updated Standup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSaveMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Updated Standup" })
      );
    });
  });

  it("Save is disabled when title is empty", () => {
    render(<EventDetailPanel {...defaultProps} onSaveMeeting={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit meeting" }));
    const titleInput = screen.getByDisplayValue("Solo Standup");
    fireEvent.change(titleInput, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("clicking a type button changes the category selection", () => {
    render(<EventDetailPanel {...defaultProps} onSaveMeeting={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit meeting" }));
    fireEvent.click(screen.getByRole("button", { name: /Focus Time/ }));
    // Focus Time button should now be active (amber background per EDIT_CATEGORY_META)
    const focusBtn = screen.getByRole("button", { name: /Focus Time/ });
    expect(focusBtn.className).toContain("bg-amber-500");
  });
});
