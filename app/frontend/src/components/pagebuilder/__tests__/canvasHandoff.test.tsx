import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, screen, fireEvent, act } from "@testing-library/react";
import PageBuilder from "../PageBuilder";
import { ExportProvider } from "../../../context/ExportContext";
import {
  useCanvasState, MINI_CANVAS_HANDOFF_KEY, CANVAS_DRAFT_KEY, SET_ASIDE_KEY,
} from "../useCanvasState";
import type { CanvasNode } from "../types";
import { miniNodesToCanvasNodes, type MiniNode } from "../../profile/miniCanvas";

const n = (id: string, props: Record<string, unknown> = {}): CanvasNode => ({ id, type: "Card", props, children: [] });
const handoff = (...nodes: CanvasNode[]) => sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, JSON.stringify(nodes));
const draft = (...nodes: CanvasNode[]) => localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify(nodes));
const stored = () => JSON.parse(localStorage.getItem(SET_ASIDE_KEY) ?? "null");
const ids = (nodes: CanvasNode[]) => nodes.map(x => x.id);

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe("mini-canvas handoff into the full builder (hook)", () => {
  it("opens the handed-over nodes as the canvas", () => {
    handoff(n("a", { x: 10, y: 20 }));
    expect(ids(renderHook(() => useCanvasState()).result.current.nodes)).toEqual(["a"]);
  });

  // The first bug: the initializer read AND deleted the key; StrictMode renders twice in development,
  // so the first pass consumed it and the pass React kept found nothing.
  it("still loads them under React StrictMode (double-invoked initializers)", () => {
    handoff(n("a"), n("b"));
    const { result } = renderHook(() => useCanvasState(), { wrapper: StrictMode });
    expect(ids(result.current.nodes)).toEqual(["a", "b"]);
  });

  it("is single-use: cleared once the builder has mounted", () => {
    handoff(n("a"));
    renderHook(() => useCanvasState());
    expect(sessionStorage.getItem(MINI_CANVAS_HANDOFF_KEY)).toBeNull();
    expect(renderHook(() => useCanvasState()).result.current.nodes).toEqual([]);
  });

  // The second bug: with a saved draft the new nodes were appended BELOW it, off-screen, so it looked
  // as if nothing had come over. The handoff is its own canvas.
  it("opens as a NEW canvas — only the mini-canvas — even when a draft is saved", () => {
    draft(n("old1"), n("old2"));
    handoff(n("new"));
    const { result } = renderHook(() => useCanvasState(), { wrapper: StrictMode });
    expect(ids(result.current.nodes)).toEqual(["new"]);
  });

  it("sets the earlier draft aside instead of destroying it, and persists it separately", () => {
    draft(n("old"));
    handoff(n("new"));
    const { result } = renderHook(() => useCanvasState(), { wrapper: StrictMode });
    expect(ids(result.current.setAside?.nodes ?? [])).toEqual(["old"]);
    expect(result.current.setAside?.shown).toBe("mini");
    expect(ids(stored().nodes)).toEqual(["old"]);
  });

  it("keeps the set-aside canvas even after the builder's autosave overwrites the draft key", () => {
    draft(n("old"));
    handoff(n("new"));
    renderHook(() => useCanvasState());
    localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify([n("new")]));  // what autosave does
    expect(ids(stored().nodes)).toEqual(["old"]);
  });

  it("no set-aside when there was no earlier draft", () => {
    handoff(n("new"));
    expect(renderHook(() => useCanvasState()).result.current.setAside).toBeNull();
    expect(localStorage.getItem(SET_ASIDE_KEY)).toBeNull();
  });

  it("an empty earlier draft is not worth keeping", () => {
    localStorage.setItem(CANVAS_DRAFT_KEY, "[]");
    handoff(n("new"));
    expect(renderHook(() => useCanvasState()).result.current.setAside).toBeNull();
  });

  it("swapping shows the earlier canvas and keeps the mini-canvas one, and swaps back", () => {
    draft(n("old"));
    handoff(n("new"));
    const { result } = renderHook(() => useCanvasState());

    act(() => result.current.swapSetAside());
    expect(ids(result.current.nodes)).toEqual(["old"]);
    expect(result.current.setAside?.shown).toBe("earlier");
    expect(ids(result.current.setAside?.nodes ?? [])).toEqual(["new"]);
    expect(ids(stored().nodes)).toEqual(["new"]);

    act(() => result.current.swapSetAside());
    expect(ids(result.current.nodes)).toEqual(["new"]);
    expect(result.current.setAside?.shown).toBe("mini");
    expect(ids(result.current.setAside?.nodes ?? [])).toEqual(["old"]);
  });

  it("swapping from an empty canvas leaves nothing to swap back to", () => {
    draft(n("old"));
    handoff(n("new"));
    const { result } = renderHook(() => useCanvasState());
    act(() => result.current.clearCanvas());
    act(() => result.current.swapSetAside());
    expect(ids(result.current.nodes)).toEqual(["old"]);
    expect(result.current.setAside).toBeNull();
  });

  it("discarding removes it for good", () => {
    draft(n("old"));
    handoff(n("new"));
    const { result } = renderHook(() => useCanvasState());
    act(() => result.current.discardSetAside());
    expect(result.current.setAside).toBeNull();
    expect(localStorage.getItem(SET_ASIDE_KEY)).toBeNull();
  });

  it("the banner survives a reload: a set-aside canvas is restored from storage with no handoff", () => {
    draft(n("new"));
    localStorage.setItem(SET_ASIDE_KEY, JSON.stringify({ nodes: [n("old")], shown: "mini" }));
    const { result } = renderHook(() => useCanvasState());
    expect(ids(result.current.nodes)).toEqual(["new"]);
    expect(ids(result.current.setAside?.nodes ?? [])).toEqual(["old"]);
  });

  it("falls back to the saved draft with no handoff, and to empty with neither", () => {
    draft(n("draft"));
    expect(ids(renderHook(() => useCanvasState()).result.current.nodes)).toEqual(["draft"]);
    localStorage.clear();
    expect(renderHook(() => useCanvasState()).result.current.nodes).toEqual([]);
  });

  it("ignores corrupt storage rather than crashing", () => {
    sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, "{not json");
    localStorage.setItem(SET_ASIDE_KEY, "{also not json");
    const { result } = renderHook(() => useCanvasState());
    expect(result.current.nodes).toEqual([]);
    expect(result.current.setAside).toBeNull();
    sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, JSON.stringify({ a: 1 }));
    expect(renderHook(() => useCanvasState()).result.current.nodes).toEqual([]);
  });
});

describe("the real PageBuilder, mounted as the app mounts it (StrictMode)", () => {
  const mini: MiniNode[] = [
    { id: "mini-1", type: "Heading", icon: "H", label: "Heading", x: 30, y: 40, w: 200, h: 40, props: { text: "MINI HEADING", level: 1 } },
    { id: "mini-2", type: "record", icon: "🔖", label: "MINI RECORD", x: 40, y: 120, w: 200, h: 72,
      record: { id: "action_item:recABC", type: "action_item", label: "MINI RECORD", summary: "s", content: "c" } },
  ];
  const earlier: CanvasNode = { id: "old", type: "Heading", props: { text: "EARLIER DRAFT", x: 16, y: 16, level: 1, height: 300 }, children: [] };
  const mount = () => render(<StrictMode><ExportProvider><PageBuilder /></ExportProvider></StrictMode>);
  const handOverMini = () => sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, JSON.stringify(miniNodesToCanvasNodes(mini)));

  afterEach(() => vi.restoreAllMocks());

  it("shows the mini-canvas content on a clean slate", () => {
    handOverMini();
    mount();
    expect(screen.getByText("MINI HEADING")).toBeInTheDocument();
    expect(screen.getAllByText("MINI RECORD").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("set-aside-banner")).toBeNull();
  });

  it("with a saved draft, shows the mini-canvas in a new canvas and NOT the old draft", () => {
    draft(earlier);
    handOverMini();
    mount();
    expect(screen.getByText("MINI HEADING")).toBeInTheDocument();
    expect(screen.queryByText("EARLIER DRAFT")).toBeNull();
    expect(screen.getByTestId("set-aside-banner")).toHaveTextContent(/Opened a new canvas from your profile mini-canvas/i);
  });

  it("the banner switches to the earlier canvas and back, losing neither", () => {
    draft(earlier);
    handOverMini();
    mount();

    fireEvent.click(screen.getByRole("button", { name: /Switch to my earlier canvas/i }));
    expect(screen.getByText("EARLIER DRAFT")).toBeInTheDocument();
    expect(screen.queryByText("MINI HEADING")).toBeNull();
    expect(screen.getByTestId("set-aside-banner")).toHaveTextContent(/Showing your earlier canvas/i);

    fireEvent.click(screen.getByRole("button", { name: /Switch to the mini-canvas/i }));
    expect(screen.getByText("MINI HEADING")).toBeInTheDocument();
    expect(screen.queryByText("EARLIER DRAFT")).toBeNull();
  });

  it("deleting the other canvas asks first, and only deletes when confirmed", () => {
    draft(earlier);
    handOverMini();
    mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: /Delete earlier canvas/i }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByTestId("set-aside-banner")).toBeInTheDocument();
    expect(localStorage.getItem(SET_ASIDE_KEY)).not.toBeNull();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /Delete earlier canvas/i }));
    expect(screen.queryByTestId("set-aside-banner")).toBeNull();
    expect(localStorage.getItem(SET_ASIDE_KEY)).toBeNull();
  });

  it("opening the builder with no handoff behaves as before (no banner, saved draft shown)", () => {
    draft(earlier);
    mount();
    expect(screen.getByText("EARLIER DRAFT")).toBeInTheDocument();
    expect(screen.queryByTestId("set-aside-banner")).toBeNull();
  });
});
