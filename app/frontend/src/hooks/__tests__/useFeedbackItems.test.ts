import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockFeedbackItems } from "../../test/handlers/feedback";
import { useFeedbackItems } from "../useFeedbackItems";

describe("useFeedbackItems", () => {
  it("happy path: loads feedback list on mount", async () => {
    const { result } = renderHook(() => useFeedbackItems());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(mockFeedbackItems.length);
    expect(result.current.error).toBeNull();
  });

  it("error state: sets error when API fails", async () => {
    server.use(http.get("/api/v1/feedback/feedback/", () => HttpResponse.error()));
    const { result } = renderHook(() => useFeedbackItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
    expect(result.current.data).toEqual([]);
  });
});
