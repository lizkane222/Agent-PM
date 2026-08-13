import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useExportTray } from "../useExportTray";
import type { AirtableActionItem } from "../../types";

const mockToggleItem = vi.fn();
const mockToggleMode = vi.fn();
const mockIsSelected = vi.fn(() => false);
let mockExportMode = false;

vi.mock("../../context/ExportContext", () => ({
  useExport: () => ({
    get exportMode() { return mockExportMode; },
    toggleItem: mockToggleItem,
    toggleMode: mockToggleMode,
    isSelected: mockIsSelected,
  }),
}));

const mockItem: AirtableActionItem = {
  id: 1,
  airtable_id: "recTRAY001",
  account: 1,
  account_name: "Test Corp",
  task: "Write tests",
  task_details: "All the tests",
  status: "Open",
  priority: "High",
  due_date: "2026-09-01",
  estimated_time: 0,
  time_spent: 0,
  prep_time: 0,
  slack_thread_url: "",
  salesforce_task_id: "",
  assignee_airtable_id: "",
  assignee_name: "Alice",
  reminder: null,
  reminder_id: null,
  reminder_due_at: null,
  reminder_status: null,
  linked_meeting: null,
  linked_meeting_name: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  marked_done_at: null,
  last_synced: "2026-01-01T00:00:00Z",
  attachments: [],
};

describe("useExportTray", () => {
  beforeEach(() => {
    mockExportMode = false;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls toggleItem with the correct ExportItem shape", () => {
    const { result } = renderHook(() => useExportTray());
    act(() => { result.current.addToTray(mockItem); });
    expect(mockToggleItem).toHaveBeenCalledOnce();
    const arg = mockToggleItem.mock.calls[0][0];
    expect(arg.id).toBe("action_item:recTRAY001");
    expect(arg.type).toBe("action_item");
    expect(arg.label).toBe("Write tests");
    expect(arg.accountName).toBe("Test Corp");
  });

  it("opens the tray (calls toggleMode) when tray was closed", () => {
    mockExportMode = false;
    const { result } = renderHook(() => useExportTray());
    act(() => { result.current.addToTray(mockItem); });
    expect(mockToggleMode).toHaveBeenCalledOnce();
  });

  it("auto-closes the tray after 5 seconds when it was closed before add", () => {
    mockExportMode = false;
    const { result, rerender } = renderHook(() => useExportTray());
    act(() => { result.current.addToTray(mockItem); });
    // Simulate tray now being open; rerender so the effect updates exportModeRef
    mockExportMode = true;
    rerender();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mockToggleMode).toHaveBeenCalledTimes(2);
  });

  it("does not open or auto-close tray when tray was already open", () => {
    mockExportMode = true;
    const { result } = renderHook(() => useExportTray());
    act(() => { result.current.addToTray(mockItem); });
    expect(mockToggleMode).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(mockToggleMode).not.toHaveBeenCalled();
  });

  it("clears previous timer when addToTray is called twice quickly", () => {
    mockExportMode = false;
    const { result, rerender } = renderHook(() => useExportTray());
    act(() => { result.current.addToTray(mockItem); });
    mockExportMode = true;
    rerender();
    act(() => { vi.advanceTimersByTime(2000); });
    // toggleMode was called once (open) — no close yet
    expect(mockToggleMode).toHaveBeenCalledTimes(1);
    // Second add resets timer; tray was open so wasOff=false, no new open/close
    // To test re-add when closed again:
    mockExportMode = false;
    rerender();
    act(() => { result.current.addToTray(mockItem); });
    mockExportMode = true;
    rerender();
    // Old timer should be cleared; advance 5s from the second add
    act(() => { vi.advanceTimersByTime(5000); });
    // toggleMode: 1 (first open) + 1 (second open) + 1 (close) = 3
    expect(mockToggleMode).toHaveBeenCalledTimes(3);
  });

  it("exposes isSelected from useExport", () => {
    const { result } = renderHook(() => useExportTray());
    expect(result.current.isSelected("action_item:recTRAY001")).toBe(false);
    expect(mockIsSelected).toHaveBeenCalledWith("action_item:recTRAY001");
  });
});
