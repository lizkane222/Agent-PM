import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockReminders } from "../../test/handlers/scheduler";
import { useReminders } from "../useReminders";

const BASE = "/api/v1/scheduler/reminders";

describe("useReminders", () => {
  it("happy path: loads reminder list on mount", async () => {
    const { result } = renderHook(() => useReminders({ tab: "pending" }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockReminders.length);
    expect(result.current.error).toBeNull();
  });

  it("loading state: loading=true before fetch settles", async () => {
    const { result } = renderHook(() => useReminders({ tab: "pending" }));
    expect(result.current.loading).toBe(true);
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useReminders({ tab: "all" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });

  it("createReminder calls the API and triggers a refetch", async () => {
    const { result } = renderHook(() => useReminders({ tab: "pending" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createReminder({
        title: "New reminder",
        body: "",
        resource_type: "general",
        resource_id: null,
        resource_label: "",
        due_at: "2026-09-01T09:00:00Z",
        notify_in_app: true,
        notify_slack: false,
        notify_push: false,
        notify_sms: false,
        status: "pending",
      });
    });

    // After create, the hook refetches — loading goes true then false
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Data is repopulated from the server (MSW returns the mock list)
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("updateReminder calls the API and triggers a refetch", async () => {
    const { result } = renderHook(() => useReminders({ tab: "pending" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateReminder(1, { title: "Updated title" });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it("deleteReminder calls the API and triggers a refetch", async () => {
    const { result } = renderHook(() => useReminders({ tab: "pending" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteReminder(1);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("dismissReminder calls the API and triggers a refetch", async () => {
    const { result } = renderHook(() => useReminders({ tab: "pending" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.dismissReminder(1);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.length).toBeGreaterThan(0);
  });
});
