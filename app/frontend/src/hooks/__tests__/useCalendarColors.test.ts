import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockUserProfile } from "../../test/handlers/team";
import { useCalendarColors } from "../useCalendarColors";
import { DEFAULT_CATEGORY_COLORS } from "../../lib/eventColors";

const ME_URL = "/api/v1/team/profiles/me/";

/** Serve a profile whose calendar_colors is `colors`. */
function serveColors(colors: unknown) {
  server.use(
    http.get(ME_URL, () => HttpResponse.json({ ...mockUserProfile, calendar_colors: colors })),
  );
}

/** Capture what the hook PATCHes back. */
function capturePatch(): { body: () => Record<string, unknown> | null } {
  let seen: Record<string, unknown> | null = null;
  server.use(
    http.patch(ME_URL, async ({ request }) => {
      seen = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...mockUserProfile, ...seen });
    }),
  );
  return { body: () => seen };
}

async function renderLoaded() {
  const view = renderHook(() => useCalendarColors());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useCalendarColors", () => {
  beforeEach(() => {
    serveColors({});
  });

  it("falls back to the shipped defaults when nothing is stored", async () => {
    const { result } = await renderLoaded();
    expect(result.current.colorFor("task")).toBe(DEFAULT_CATEGORY_COLORS.task);
    expect(result.current.colorFor("meeting")).toBe(DEFAULT_CATEGORY_COLORS.meeting);
  });

  it("prefers a stored color over the default", async () => {
    serveColors({ categories: { task: "#E5A836" } });
    const { result } = await renderLoaded();
    expect(result.current.colorFor("task")).toBe("#E5A836");
    // Untouched types keep their default.
    expect(result.current.colorFor("meeting")).toBe(DEFAULT_CATEGORY_COLORS.meeting);
  });

  it("ignores a stored value that is not a hex color", async () => {
    serveColors({ categories: { task: "chartreuse" } });
    const { result } = await renderLoaded();
    expect(result.current.colorFor("task")).toBe(DEFAULT_CATEGORY_COLORS.task);
  });

  it("still serves defaults when the profile request fails", async () => {
    server.use(http.get(ME_URL, () => new HttpResponse(null, { status: 500 })));
    const { result } = await renderLoaded();
    expect(result.current.colorFor("task")).toBe(DEFAULT_CATEGORY_COLORS.task);
    expect(result.current.error).toBeTruthy();
  });

  it("applies a chosen color immediately and PATCHes it", async () => {
    const patch = capturePatch();
    const { result } = await renderLoaded();

    act(() => result.current.setCategoryColor("focus_time", "#842D78"));
    expect(result.current.colorFor("focus_time")).toBe("#842D78");

    await waitFor(() => expect(patch.body()).not.toBeNull());
    expect(patch.body()).toEqual({ calendar_colors: { categories: { focus_time: "#842D78" } } });
  });

  it("preserves other types when one changes", async () => {
    serveColors({ categories: { meeting: "#18363E" } });
    const patch = capturePatch();
    const { result } = await renderLoaded();

    act(() => result.current.setCategoryColor("task", "#E5A836"));
    await waitFor(() => expect(patch.body()).not.toBeNull());
    expect(patch.body()).toEqual({
      calendar_colors: { categories: { meeting: "#18363E", task: "#E5A836" } },
    });
  });

  it("rolls back when the server rejects the change", async () => {
    server.use(http.patch(ME_URL, () => new HttpResponse(null, { status: 400 })));
    const { result } = await renderLoaded();

    act(() => result.current.setCategoryColor("task", "#842D78"));
    expect(result.current.colorFor("task")).toBe("#842D78");

    await waitFor(() => expect(result.current.colorFor("task")).toBe(DEFAULT_CATEGORY_COLORS.task));
    expect(result.current.error).toBeTruthy();
  });

  it("ignores a malformed color rather than persisting it", async () => {
    const patch = capturePatch();
    const { result } = await renderLoaded();
    act(() => result.current.setCategoryColor("task", "orange"));
    expect(patch.body()).toBeNull();
    expect(result.current.colorFor("task")).toBe(DEFAULT_CATEGORY_COLORS.task);
  });

  it("reports no important color by default", async () => {
    const { result } = await renderLoaded();
    expect(result.current.importantFor("gcal-1")).toBeNull();
  });

  it("stores and reads back an important color per event", async () => {
    const patch = capturePatch();
    const { result } = await renderLoaded();

    act(() => result.current.setImportant("gcal-1", "#B2336C"));
    expect(result.current.importantFor("gcal-1")).toBe("#B2336C");
    expect(result.current.importantFor("gcal-2")).toBeNull();

    await waitFor(() => expect(patch.body()).not.toBeNull());
    expect(patch.body()).toEqual({ calendar_colors: { important: { "gcal-1": "#B2336C" } } });
  });

  it("ignores an important color with no event uid", async () => {
    const patch = capturePatch();
    const { result } = await renderLoaded();
    act(() => result.current.setImportant("", "#B2336C"));
    expect(patch.body()).toBeNull();
  });

  it("clears an important color", async () => {
    serveColors({ important: { "gcal-1": "#842D78", "gcal-2": "#174DB1" } });
    const patch = capturePatch();
    const { result } = await renderLoaded();

    act(() => result.current.clearImportant("gcal-1"));
    expect(result.current.importantFor("gcal-1")).toBeNull();
    expect(result.current.importantFor("gcal-2")).toBe("#174DB1");

    await waitFor(() => expect(patch.body()).not.toBeNull());
    expect(patch.body()).toEqual({ calendar_colors: { important: { "gcal-2": "#174DB1" } } });
  });

  it("does not PATCH when clearing an event that was never marked", async () => {
    const patch = capturePatch();
    const { result } = await renderLoaded();
    act(() => result.current.clearImportant("never-marked"));
    expect(patch.body()).toBeNull();
  });

  it("resets category colors back to the defaults, leaving important intact", async () => {
    serveColors({ categories: { task: "#E5A836" }, important: { "gcal-1": "#842D78" } });
    const patch = capturePatch();
    const { result } = await renderLoaded();

    act(() => result.current.resetCategoryColors());
    expect(result.current.colorFor("task")).toBe(DEFAULT_CATEGORY_COLORS.task);
    expect(result.current.importantFor("gcal-1")).toBe("#842D78");

    await waitFor(() => expect(patch.body()).not.toBeNull());
    expect(patch.body()).toEqual({
      calendar_colors: { categories: {}, important: { "gcal-1": "#842D78" } },
    });
  });
});
