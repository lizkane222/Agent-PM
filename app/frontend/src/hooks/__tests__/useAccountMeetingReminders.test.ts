import { act, renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockReminders } from "../../test/handlers/scheduler";
import { useAccountMeetingReminders } from "../useAccountMeetingReminders";

const CALENDAR_EVENT_ID = 42;

describe("useAccountMeetingReminders", () => {
  it("starts with empty meetingReminders", () => {
    const { result } = renderHook(() => useAccountMeetingReminders());
    expect(result.current.meetingReminders).toEqual({});
  });

  it("handleAddMeetingReminder creates a reminder and appends it to the correct key", async () => {
    server.use(
      http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        const body = await request.json() as { title: string; due_at: string };
        return HttpResponse.json(
          { ...mockReminders[0], id: 77, title: body.title, due_at: body.due_at },
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useAccountMeetingReminders());
    const addFn = result.current.handleAddMeetingReminder(CALENDAR_EVENT_ID, 1, "Q3 Meeting");

    await act(async () => {
      await addFn("2026-08-01T09:00:00Z", "Prep notes");
    });

    expect(result.current.meetingReminders[CALENDAR_EVENT_ID]).toHaveLength(1);
    expect(result.current.meetingReminders[CALENDAR_EVENT_ID][0].id).toBe(77);
    expect(result.current.meetingReminders[CALENDAR_EVENT_ID][0].title).toBe("Prep notes");
  });

  it("handleDismissMeetingReminder marks reminder as dismissed", async () => {
    const { result } = renderHook(() => useAccountMeetingReminders());

    // Seed an existing reminder via setMeetingReminders
    act(() => {
      result.current.setMeetingReminders({
        [CALENDAR_EVENT_ID]: [{ ...mockReminders[0], id: 10, status: "pending" }],
      });
    });

    await act(async () => {
      await result.current.handleDismissMeetingReminder(CALENDAR_EVENT_ID, 10);
    });

    expect(result.current.meetingReminders[CALENDAR_EVENT_ID][0].status).toBe("dismissed");
  });

  it("accumulates multiple reminders on the same calendar event", async () => {
    server.use(
      http.post("/api/v1/scheduler/reminders/", async ({ request }) => {
        const body = await request.json() as { title: string };
        return HttpResponse.json(
          { ...mockReminders[0], id: Math.floor(Math.random() * 9000) + 1000, title: body.title },
          { status: 201 }
        );
      })
    );

    const { result } = renderHook(() => useAccountMeetingReminders());
    const addFn = result.current.handleAddMeetingReminder(CALENDAR_EVENT_ID, 1, "Q3 Meeting");

    await act(async () => { await addFn("2026-08-01T09:00:00Z", "First"); });
    await act(async () => { await addFn("2026-08-02T09:00:00Z", "Second"); });

    expect(result.current.meetingReminders[CALENDAR_EVENT_ID]).toHaveLength(2);
  });
});
