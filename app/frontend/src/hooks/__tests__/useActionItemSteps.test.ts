import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockStep } from "../../test/handlers/steps";
import { useActionItemSteps } from "../useActionItemSteps";

const BASE = "/api/v1/airtable/steps";
const ACTION_ITEM_ID = 10;

describe("useActionItemSteps", () => {
  it("loading state: loading=true before fetch settles", () => {
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    expect(result.current.loading).toBe(true);
  });

  it("happy path: loads steps list on mount", async () => {
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.steps).toHaveLength(1);
    expect(result.current.steps[0]).toMatchObject(mockStep());
    expect(result.current.error).toBeNull();
  });

  it("null actionItemId: resolves immediately with empty array", async () => {
    const { result } = renderHook(() => useActionItemSteps(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.steps).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get(`${BASE}/`, () => HttpResponse.error()));
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.steps).toEqual([]);
  });

  it("addStep fires POST and triggers refetch", async () => {
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addStep("New step title");
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.steps.length).toBeGreaterThan(0);
  });

  it("setStatus fires PATCH with the new status and triggers refetch", async () => {
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setStatus(1, "Done");
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.steps.length).toBeGreaterThan(0);
  });

  it("deleteStep fires DELETE and triggers refetch", async () => {
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteStep(1);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("updateStep fires PATCH and triggers refetch", async () => {
    const { result } = renderHook(() => useActionItemSteps(ACTION_ITEM_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateStep(1, { title: "Updated title" });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.steps.length).toBeGreaterThan(0);
  });
});
