import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useStatusArrivalOrder,
  reloadStatusArrivalOrder,
  STATUS_ARRIVAL_ORDER_KEY,
  type StatusOrderableItem,
} from "../useStatusArrivalOrder";

function item(
  id: string,
  status: string,
  created_at: string,
  marked_done_at: string | null = null,
): StatusOrderableItem {
  return { airtable_id: id, status, created_at, marked_done_at };
}

/** Just the ids, so assertions read as the column would. */
const ids = (list: StatusOrderableItem[]) => list.map((i) => i.airtable_id);

describe("useStatusArrivalOrder", () => {
  beforeEach(() => {
    localStorage.clear();
    // localStorage.clear() fires no storage event, so the module-level store keeps the
    // previous test's value until told to re-read.
    reloadStatusArrivalOrder();
  });

  // ── Open: chronological ───────────────────────────────────────────────────────

  it("orders Open by created_at ascending, newest at the bottom", () => {
    const items = [
      item("c", "Open", "2026-03-01T00:00:00Z"),
      item("a", "Open", "2026-01-01T00:00:00Z"),
      item("b", "Open", "2026-02-01T00:00:00Z"),
    ];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    expect(ids(result.current.orderForStatus(items, "Open"))).toEqual(["a", "b", "c"]);
  });

  it("ignores arrival records for Open", () => {
    // Dragging something back out of In Progress must not park it at the bottom of the
    // backlog — Open is an inbox, so it stays chronological.
    localStorage.setItem(STATUS_ARRIVAL_ORDER_KEY, JSON.stringify({ Open: ["a"] }));
    reloadStatusArrivalOrder();
    const items = [item("a", "Open", "2026-01-01T00:00:00Z"), item("b", "Open", "2026-02-01T00:00:00Z")];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    expect(ids(result.current.orderForStatus(items, "Open"))).toEqual(["a", "b"]);
  });

  it("does not mutate the array it is given", () => {
    const items = [item("b", "Open", "2026-02-01T00:00:00Z"), item("a", "Open", "2026-01-01T00:00:00Z")];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    result.current.orderForStatus(items, "Open");
    expect(ids(items)).toEqual(["b", "a"]);
  });

  // ── Other statuses: arrival order ─────────────────────────────────────────────

  it("appends a newly arrived item to the bottom of its column", () => {
    const open = item("a", "Open", "2026-01-01T00:00:00Z");
    const settled = item("b", "In Progress", "2026-02-01T00:00:00Z");
    let items = [open, settled];
    const { result, rerender } = renderHook(({ list }) => useStatusArrivalOrder(list), {
      initialProps: { list: items },
    });

    // "a" moves to In Progress. It was seen in Open first, so this is a real transition.
    items = [{ ...open, status: "In Progress" }, settled];
    act(() => rerender({ list: items }));

    // "b" was never watched arriving, so it keeps the chronological fallback and sits above.
    expect(ids(result.current.orderForStatus(items, "In Progress"))).toEqual(["b", "a"]);
  });

  it("keeps successive arrivals in the order they were moved", () => {
    const a = item("a", "Open", "2026-01-01T00:00:00Z");
    const b = item("b", "Open", "2026-02-01T00:00:00Z");
    let items = [a, b];
    const { result, rerender } = renderHook(({ list }) => useStatusArrivalOrder(list), {
      initialProps: { list: items },
    });

    // Move "b" first, then "a" — so the column must read b, a, not creation order a, b.
    items = [a, { ...b, status: "Blocked" }];
    act(() => rerender({ list: items }));
    items = [{ ...a, status: "Blocked" }, { ...b, status: "Blocked" }];
    act(() => rerender({ list: items }));

    expect(ids(result.current.orderForStatus(items, "Blocked"))).toEqual(["b", "a"]);
  });

  it("moves an item to the bottom again when it re-enters a column", () => {
    const a = item("a", "Open", "2026-01-01T00:00:00Z");
    const b = item("b", "Open", "2026-02-01T00:00:00Z");
    let items = [a, b];
    const { result, rerender } = renderHook(({ list }) => useStatusArrivalOrder(list), {
      initialProps: { list: items },
    });

    items = [{ ...a, status: "Done" }, b];
    act(() => rerender({ list: items }));
    items = [{ ...a, status: "Done" }, { ...b, status: "Done" }];
    act(() => rerender({ list: items }));
    expect(ids(result.current.orderForStatus(items, "Done"))).toEqual(["a", "b"]);

    // "a" leaves and comes back — it is now the most recent arrival.
    items = [{ ...a, status: "Open" }, { ...b, status: "Done" }];
    act(() => rerender({ list: items }));
    items = [{ ...a, status: "Done" }, { ...b, status: "Done" }];
    act(() => rerender({ list: items }));
    expect(ids(result.current.orderForStatus(items, "Done"))).toEqual(["b", "a"]);
  });

  it("drops the stale record under the status an item left", () => {
    const a = item("a", "Open", "2026-01-01T00:00:00Z");
    let items = [a];
    const { rerender } = renderHook(({ list }) => useStatusArrivalOrder(list), {
      initialProps: { list: items },
    });

    items = [{ ...a, status: "Blocked" }];
    act(() => rerender({ list: items }));
    items = [{ ...a, status: "Done" }];
    act(() => rerender({ list: items }));

    // A leftover entry under Blocked would make it sort as though it had never left.
    const stored = JSON.parse(localStorage.getItem(STATUS_ARRIVAL_ORDER_KEY) ?? "{}");
    expect(stored["Done"]).toEqual(["a"]);
    expect(stored["Blocked"]).toBeUndefined();
  });

  // ── First sighting and fallbacks ──────────────────────────────────────────────

  it("treats a first sighting as no arrival, so mounting does not reorder a column", () => {
    const items = [
      item("late", "Blocked", "2026-03-01T00:00:00Z"),
      item("early", "Blocked", "2026-01-01T00:00:00Z"),
    ];
    const { result } = renderHook(() => useStatusArrivalOrder(items));

    expect(localStorage.getItem(STATUS_ARRIVAL_ORDER_KEY)).toBeNull();
    expect(ids(result.current.orderForStatus(items, "Blocked"))).toEqual(["early", "late"]);
  });

  it("falls back to marked_done_at for Done, not created_at", () => {
    // Done is the one status the server timestamps. Most items in this column were completed
    // long before any arrival was recorded, and creation order says nothing about that.
    const items = [
      item("madeFirstDoneLast", "Done", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"),
      item("madeLastDoneFirst", "Done", "2026-05-01T00:00:00Z", "2026-02-01T00:00:00Z"),
    ];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    expect(ids(result.current.orderForStatus(items, "Done"))).toEqual([
      "madeLastDoneFirst",
      "madeFirstDoneLast",
    ]);
  });

  it("sorts a recorded arrival below every unrecorded item", () => {
    localStorage.setItem(STATUS_ARRIVAL_ORDER_KEY, JSON.stringify({ Blocked: ["moved"] }));
    reloadStatusArrivalOrder();
    const items = [
      item("moved", "Blocked", "2020-01-01T00:00:00Z"),
      item("untouchedNew", "Blocked", "2026-05-01T00:00:00Z"),
      item("untouchedOld", "Blocked", "2026-01-01T00:00:00Z"),
    ];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    // Even though "moved" is by far the oldest by creation, we watched it arrive.
    expect(ids(result.current.orderForStatus(items, "Blocked"))).toEqual([
      "untouchedOld",
      "untouchedNew",
      "moved",
    ]);
  });

  it("tolerates a missing or unparseable created_at", () => {
    const items = [
      item("good", "Backlogged", "2026-01-01T00:00:00Z"),
      item("bad", "Backlogged", "not-a-date"),
    ];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    expect(ids(result.current.orderForStatus(items, "Backlogged"))).toEqual(["bad", "good"]);
  });

  it("records nothing for a local-* blank", () => {
    const blank = item("local-1", "Open", "2026-01-01T00:00:00Z");
    let items = [blank];
    const { rerender } = renderHook(({ list }) => useStatusArrivalOrder(list), {
      initialProps: { list: items },
    });
    items = [{ ...blank, status: "In Progress" }];
    act(() => rerender({ list: items }));

    // promoteBlankItem throws the local-* id away, so a record against it would orphan.
    expect(localStorage.getItem(STATUS_ARRIVAL_ORDER_KEY)).toBeNull();
  });

  // ── Storage shape ─────────────────────────────────────────────────────────────

  it("survives a corrupt or wrongly-shaped stored value", () => {
    for (const raw of ["not json", "[]", '{"Done": "nope"}', "null"]) {
      localStorage.setItem(STATUS_ARRIVAL_ORDER_KEY, raw);
      reloadStatusArrivalOrder();
      const items = [item("a", "Done", "2026-01-01T00:00:00Z")];
      const { result, unmount } = renderHook(() => useStatusArrivalOrder(items));
      expect(ids(result.current.orderForStatus(items, "Done"))).toEqual(["a"]);
      unmount();
    }
  });
});
