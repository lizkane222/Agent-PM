import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import { useStatusArrivalOrder, reloadColumnSort, COLUMN_SORT_KEY, type StatusOrderableItem } from "../useStatusArrivalOrder";
import ColumnSortButton from "../../components/account/ColumnSortButton";

const STATUSES = ["Open", "In Progress", "Done", "Blocked", "Backlogged"];

// Creation order and moved order deliberately disagree; updated_at is a decoy (bumped by an edit).
const mk = (id: string, status: string, created: string, moved: string | null, updated = "2030-01-01T00:00:00Z"): StatusOrderableItem => ({
  airtable_id: id, status, created_at: created, status_changed_at: moved, updated_at: updated,
});
const ids = (l: StatusOrderableItem[]) => l.map((i) => i.airtable_id);

function itemsFor(status: string) {
  return [
    mk(`${status}-b`, status, "2026-01-01T00:00:00Z", "2026-03-02T00:00:00Z"),
    mk(`${status}-a`, status, "2026-01-02T00:00:00Z", "2026-03-01T00:00:00Z"),
    mk(`${status}-c`, status, "2026-01-03T00:00:00Z", "2026-03-03T00:00:00Z"),
  ];
}

describe("column sort toggle", () => {
  beforeEach(() => { localStorage.clear(); reloadColumnSort(); });

  it("defaults to no explicit sort", () => {
    const { result } = renderHook(() => useStatusArrivalOrder([]));
    for (const s of STATUSES) expect(result.current.sortDirection(s)).toBeNull();
  });

  it.each(STATUSES)("%s: toggles newest first then oldest first by status_changed_at", (status) => {
    const items = itemsFor(status);
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    act(() => result.current.toggleSort(status));
    expect(result.current.sortDirection(status)).toBe("newest");
    expect(ids(result.current.orderForStatus(items, status))).toEqual([`${status}-c`, `${status}-b`, `${status}-a`]);
    act(() => result.current.toggleSort(status));
    expect(result.current.sortDirection(status)).toBe("oldest");
    expect(ids(result.current.orderForStatus(items, status))).toEqual([`${status}-a`, `${status}-b`, `${status}-c`]);
  });

  it("falls back to updated_at, then created_at, when status_changed_at is missing", () => {
    const items = [
      { airtable_id: "x", status: "Done", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
      { airtable_id: "y", status: "Done", created_at: "2026-05-01T00:00:00Z" },
    ];
    const { result } = renderHook(() => useStatusArrivalOrder(items));
    act(() => result.current.toggleSort("Done"));
    expect(ids(result.current.orderForStatus(items, "Done"))).toEqual(["y", "x"]);
  });

  it("only affects the toggled column", () => {
    const open = itemsFor("Open");
    const { result } = renderHook(() => useStatusArrivalOrder(open));
    const before = ids(result.current.orderForStatus(open, "Open"));
    act(() => result.current.toggleSort("Done"));
    expect(ids(result.current.orderForStatus(open, "Open"))).toEqual(before);
  });

  it("persists to localStorage and survives a reload of the store", () => {
    const { result } = renderHook(() => useStatusArrivalOrder([]));
    act(() => result.current.toggleSort("Blocked"));
    expect(JSON.parse(localStorage.getItem(COLUMN_SORT_KEY)!)).toEqual({ Blocked: "newest" });
    reloadColumnSort();
    const again = renderHook(() => useStatusArrivalOrder([]));
    expect(again.result.current.sortDirection("Blocked")).toBe("newest");
  });
});

describe("ColumnSortButton", () => {
  it("labels the action a click performs", () => {
    let dir: "newest" | "oldest" | null = null;
    const { rerender } = render(<ColumnSortButton status="Done" direction={dir} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Sort Done newest first" })).toBeTruthy();
    dir = "newest";
    rerender(<ColumnSortButton status="Done" direction={dir} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Sort Done oldest first" })).toBeTruthy();
  });

  it("calls onToggle with the status", () => {
    const calls: string[] = [];
    render(<ColumnSortButton status="Backlogged" direction={null} onToggle={(s) => calls.push(s)} />);
    fireEvent.click(screen.getByRole("button"));
    expect(calls).toEqual(["Backlogged"]);
  });
});
