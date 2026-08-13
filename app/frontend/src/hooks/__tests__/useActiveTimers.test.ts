import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useActiveTimers } from "../useActiveTimers";

const TIMER_A = {
  startedAt: 1000000,
  elapsed: 0,
  task: "Fix billing",
  accountName: "Acme Corp",
};

describe("useActiveTimers", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes activeTimers from localStorage", () => {
    localStorage.setItem("activeTimers", JSON.stringify({ recAAA: TIMER_A }));
    const { result } = renderHook(() => useActiveTimers());
    expect(result.current.activeTimers).toEqual({ recAAA: TIMER_A });
  });

  it("StorageEvent 'activeTimers' adds a new timer entry", async () => {
    const { result } = renderHook(() => useActiveTimers());
    expect(Object.keys(result.current.activeTimers)).toHaveLength(0);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "activeTimers",
          newValue: JSON.stringify({ recBBB: TIMER_A }),
        })
      );
    });

    await waitFor(() =>
      expect(Object.keys(result.current.activeTimers)).toHaveLength(1)
    );
    expect(result.current.activeTimers["recBBB"]).toEqual(TIMER_A);
  });

  it("StorageEvent 'activeTimers' removes a timer when its key is gone", async () => {
    localStorage.setItem("activeTimers", JSON.stringify({ recAAA: TIMER_A }));
    const { result } = renderHook(() => useActiveTimers());
    await waitFor(() =>
      expect(result.current.activeTimers["recAAA"]).toBeDefined()
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "activeTimers",
          newValue: "{}",
        })
      );
    });

    await waitFor(() =>
      expect(Object.keys(result.current.activeTimers)).toHaveLength(0)
    );
  });

  it("timerEvents synthesizes CalendarEvent[] from active timers", () => {
    localStorage.setItem("activeTimers", JSON.stringify({ recAAA: TIMER_A }));
    const { result } = renderHook(() => useActiveTimers());
    const ev = result.current.timerEvents[0];
    expect(ev).toBeDefined();
    expect(ev.google_event_id).toBe("active-timer-recAAA");
    expect(ev.title).toBe(`⏱ ${TIMER_A.task}`);
    expect(ev.calendar_id).toBe("work_tracking");
    expect(ev.agentpm_airtable_id).toBe("recAAA");
  });
});
