import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useScheduledCalendarItems } from "../useScheduledCalendarItems";
import type { ScheduledItem, ScheduledReminder } from "../../types/calendar";

const ITEM_A: ScheduledItem = {
  airtableId: "recAAA001",
  task: "Fix billing",
  accountName: "Acme Corp",
  start: "2026-08-01T09:00:00",
  end: "2026-08-01T10:00:00",
  uid: "sched-recAAA001-fixed",
};

const REMINDER_A: ScheduledReminder = {
  reminderId: 1,
  title: "Follow up",
  start: "2026-08-01T09:00:00",
  end: "2026-08-01T09:15:00",
};

describe("useScheduledCalendarItems", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes from localStorage on mount", () => {
    localStorage.setItem("scheduledActionItems", JSON.stringify([ITEM_A]));
    localStorage.setItem("scheduledReminders", JSON.stringify([REMINDER_A]));
    const { result } = renderHook(() => useScheduledCalendarItems());
    expect(result.current.scheduledItems).toEqual([ITEM_A]);
    expect(result.current.scheduledReminders).toEqual([REMINDER_A]);
  });

  it("addScheduledItem writes to localStorage and updates state", () => {
    const { result } = renderHook(() => useScheduledCalendarItems());
    act(() => { result.current.addScheduledItem(ITEM_A); });
    expect(result.current.scheduledItems).toHaveLength(1);
    expect(result.current.scheduledItems[0].airtableId).toBe("recAAA001");
    const stored = JSON.parse(localStorage.getItem("scheduledActionItems") ?? "[]");
    expect(stored).toHaveLength(1);
  });

  it("addScheduledItem blocks duplicate (same airtableId + start minute)", () => {
    const { result } = renderHook(() => useScheduledCalendarItems());
    act(() => { result.current.addScheduledItem(ITEM_A); });
    act(() => { result.current.addScheduledItem({ ...ITEM_A, uid: "different-uid" }); });
    expect(result.current.scheduledItems).toHaveLength(1);
  });

  it("removeScheduledItem updates both state and localStorage", () => {
    localStorage.setItem("scheduledActionItems", JSON.stringify([ITEM_A]));
    const { result } = renderHook(() => useScheduledCalendarItems());
    act(() => { result.current.removeScheduledItem("recAAA001"); });
    expect(result.current.scheduledItems).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("scheduledActionItems") ?? "[]")).toHaveLength(0);
  });

  it("StorageEvent on SCHEDULED_ITEMS_KEY syncs state from another tab", async () => {
    const { result } = renderHook(() => useScheduledCalendarItems());
    expect(result.current.scheduledItems).toHaveLength(0);

    const payload = JSON.stringify([ITEM_A]);
    localStorage.setItem("scheduledActionItems", payload);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "scheduledActionItems", newValue: payload })
      );
    });

    await waitFor(() =>
      expect(result.current.scheduledItems).toHaveLength(1)
    );
  });

  it("addScheduledReminder writes to localStorage and blocks duplicates", () => {
    const { result } = renderHook(() => useScheduledCalendarItems());
    act(() => { result.current.addScheduledReminder(REMINDER_A); });
    expect(result.current.scheduledReminders).toHaveLength(1);
    act(() => { result.current.addScheduledReminder(REMINDER_A); });
    expect(result.current.scheduledReminders).toHaveLength(1);
  });

  it("removeScheduledReminder updates state and localStorage", () => {
    localStorage.setItem("scheduledReminders", JSON.stringify([REMINDER_A]));
    const { result } = renderHook(() => useScheduledCalendarItems());
    act(() => { result.current.removeScheduledReminder(1); });
    expect(result.current.scheduledReminders).toHaveLength(0);
  });
});
