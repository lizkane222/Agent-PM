import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PageBuilder, { marqueeHits, isInsideLockedPage } from "../PageBuilder";
import { ExportProvider } from "../../../context/ExportContext";
import { COMPONENT_REGISTRY } from "../registry";
import { CANVAS_DRAFT_KEY } from "../useCanvasState";
import { CANVAS_VIEW_KEY } from "../useCanvasViewport";
import type { CanvasNode } from "../types";

function node(id: string, type: string, props: Record<string, unknown> = {}, children: CanvasNode[] = []): CanvasNode {
  return { id, type, props, children };
}

const page = (id: string, locked: boolean, children: CanvasNode[] = []) =>
  node(id, "Page", { label: `Sheet ${id}`, locked, x: 0, y: 0, width: 816, height: 1056 }, children);

function seed(nodes: CanvasNode[]) {
  localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify(nodes));
  localStorage.setItem(CANVAS_VIEW_KEY, JSON.stringify({ zoom: 1, panX: 0, panY: 0 }));
}

function renderBuilder() {
  return render(<ExportProvider><PageBuilder /></ExportProvider>);
}

describe("Page registry entry", () => {
  const def = COMPONENT_REGISTRY.find((c) => c.type === "Page");

  it("exists and can contain other components", () => {
    expect(def).toBeDefined();
    expect(def!.canHaveChildren).toBe(true);
  });

  it("always carries explicit width and height", () => {
    // getNodeRect falls back to 120×40 for a node without them, which would make
    // every geometric comparison against a page wrong.
    expect(def!.defaultProps.width).toBe(816);
    expect(def!.defaultProps.height).toBe(1056);
  });

  it("starts unlocked", () => {
    expect(def!.defaultProps.locked).toBe(false);
  });
});

describe("isInsideLockedPage", () => {
  const tree = [
    page("locked", true, [node("inLocked", "Text", { text: "a" })]),
    page("open", false, [node("inOpen", "Text", { text: "b" })]),
    node("loose", "Text", { text: "c" }),
  ];

  it("is true for a child of a locked page", () => {
    expect(isInsideLockedPage(tree, "inLocked")).toBe(true);
  });

  it("is false for a child of an unlocked page", () => {
    expect(isInsideLockedPage(tree, "inOpen")).toBe(false);
  });

  it("is false for the locked page itself — a locked page still moves", () => {
    expect(isInsideLockedPage(tree, "locked")).toBe(false);
  });

  it("is false for a node outside any page", () => {
    expect(isInsideLockedPage(tree, "loose")).toBe(false);
  });
});

describe("marqueeHits", () => {
  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};

  function place(id: string, x: number, y: number, w = 100, h = 40) {
    const el = document.createElement("div");
    el.setAttribute("data-node-id", id);
    el.getBoundingClientRect = () => ({
      left: x, top: y, width: w, height: h, right: x + w, bottom: y + h,
      x, y, toJSON: () => "",
    }) as DOMRect;
    document.body.appendChild(el);
    rects[id] = { x, y, w, h };
  }

  beforeEach(() => { document.body.innerHTML = ""; });

  const viewport = { left: 0, top: 0 };
  const box = { x: 0, y: 0, w: 500, h: 500 };

  it("never selects a Page, even when the band covers it", () => {
    place("p1", 10, 10, 400, 400);
    const hits = marqueeHits([page("p1", false)], box, viewport);
    expect(hits).toEqual([]);
  });

  it("selects the components sitting on an unlocked page", () => {
    place("p1", 0, 0, 400, 400);
    place("a", 20, 20);
    place("b", 20, 80);
    const hits = marqueeHits(
      [page("p1", false, [node("a", "Text"), node("b", "Text")])],
      box, viewport,
    );
    expect(hits).toEqual(["a", "b"]);
  });

  it("selects nothing inside a locked page — page and contents are one object", () => {
    place("p1", 0, 0, 400, 400);
    place("a", 20, 20);
    const hits = marqueeHits([page("p1", true, [node("a", "Text")])], box, viewport);
    expect(hits).toEqual([]);
  });

  it("still selects loose root nodes alongside page contents", () => {
    place("p1", 0, 0, 300, 300);
    place("onPage", 20, 20);
    place("loose", 320, 20);
    const hits = marqueeHits(
      [page("p1", false, [node("onPage", "Text")]), node("loose", "Text")],
      box, viewport,
    );
    expect(hits.sort()).toEqual(["loose", "onPage"]);
  });

  it("excludes nodes outside the band", () => {
    place("in", 10, 10);
    place("out", 900, 900);
    const hits = marqueeHits([node("in", "Text"), node("out", "Text")], box, viewport);
    expect(hits).toEqual(["in"]);
  });

  it("offsets by the viewport origin so a scrolled/offset canvas still hits", () => {
    place("a", 210, 110); // 200,100 relative to a viewport at (10,10)
    const hits = marqueeHits([node("a", "Text")], { x: 150, y: 50, w: 200, h: 200 }, { left: 10, top: 10 });
    expect(hits).toEqual(["a"]);
  });

  it("ignores nodes with no layout rather than scoring them at the origin", () => {
    // jsdom reports all-zero rects for unlaid-out elements; treating that as a hit
    // at 0,0 would make every such node selectable by any band touching the corner.
    const el = document.createElement("div");
    el.setAttribute("data-node-id", "ghost");
    document.body.appendChild(el);
    expect(marqueeHits([node("ghost", "Text")], box, viewport)).toEqual([]);
  });
});

describe("Page on the canvas", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("renders its title bar with the page name", () => {
    seed([page("p1", false)]);
    renderBuilder();
    expect(screen.getByText("Sheet p1")).toBeInTheDocument();
  });

  it("is pointer-transparent when unlocked so a marquee can sweep across it", () => {
    seed([page("p1", false)]);
    renderBuilder();
    const surface = document.querySelector('[data-page-surface="p1"]') as HTMLElement;
    expect(surface.style.pointerEvents).toBe("none");
  });

  it("captures pointer events when locked so the whole page is the click target", () => {
    seed([page("p1", true)]);
    renderBuilder();
    const surface = document.querySelector('[data-page-surface="p1"]') as HTMLElement;
    expect(surface.style.pointerEvents).toBe("auto");
  });

  it("toggles lock from the title bar", () => {
    seed([page("p1", false)]);
    renderBuilder();

    const btn = screen.getByRole("button", { name: /lock page/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(btn);

    expect(screen.getByRole("button", { name: /unlock page/i })).toHaveAttribute("aria-pressed", "true");
    const surface = document.querySelector('[data-page-surface="p1"]') as HTMLElement;
    expect(surface.style.pointerEvents).toBe("auto");
  });

  it("makes a locked page's contents inert", () => {
    seed([page("p1", true, [node("c1", "Text", { text: "on the sheet", x: 10, y: 10 })])]);
    renderBuilder();

    const child = document.querySelector('[data-node-id="c1"]');
    expect(child).toBeTruthy();
    // The children container, not the child itself, carries the inertness.
    const dropZone = child!.parentElement as HTMLElement;
    expect(dropZone.style.pointerEvents).toBe("none");
  });

  /**
   * End-to-end version of the marqueeHits rules: the helper is unit-tested above,
   * this proves it is actually wired into the drag.
   */
  it("sweeping across a page selects the components on it, not the page", () => {
    seed([page("p1", false, [
      node("c1", "Text", { text: "one", x: 20, y: 20, width: 100, height: 40 }),
      node("c2", "Text", { text: "two", x: 20, y: 80, width: 100, height: 40 }),
    ])]);
    renderBuilder();

    const viewport = document.querySelector("[data-canvas-viewport]") as HTMLElement;
    viewport.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 900, height: 900, right: 900, bottom: 900, x: 0, y: 0, toJSON: () => "",
    }) as DOMRect;
    // jsdom lays nothing out, so give the page and its children real rects.
    for (const [id, r] of [
      ["p1", { x: 0, y: 0, w: 816, h: 1056 }],
      ["c1", { x: 20, y: 20, w: 100, h: 40 }],
      ["c2", { x: 20, y: 80, w: 100, h: 40 }],
    ] as const) {
      const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
      el.getBoundingClientRect = () => ({
        left: r.x, top: r.y, width: r.w, height: r.h,
        right: r.x + r.w, bottom: r.y + r.h, x: r.x, y: r.y, toJSON: () => "",
      }) as DOMRect;
    }

    fireEvent.mouseDown(viewport, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 });
    fireEvent.mouseUp(window);

    const c1 = document.querySelector('[data-node-id="c1"]') as HTMLElement;
    const c2 = document.querySelector('[data-node-id="c2"]') as HTMLElement;
    const pageEl = document.querySelector('[data-node-id="p1"]') as HTMLElement;
    expect(c1.style.outline).toContain("#818CF8");
    expect(c2.style.outline).toContain("#818CF8");
    // The page sits underneath and is never grabbed by the band.
    expect(pageEl.style.outline).toBe("");
  });

  it("keeps a page below other components, selected or not", () => {
    seed([page("p1", false), node("card", "Text", { text: "hi", x: 10, y: 10 })]);
    renderBuilder();

    const pageEl = document.querySelector('[data-node-id="p1"]') as HTMLElement;
    const cardEl = document.querySelector('[data-node-id="card"]') as HTMLElement;
    expect(Number(pageEl.style.zIndex)).toBe(0);
    expect(Number(cardEl.style.zIndex)).toBeGreaterThan(0);

    // Selecting the page must not lift it over the card — the default
    // `selected ? 10 : 1` would have.
    fireEvent.click(screen.getByText("Sheet p1"));
    expect(Number((document.querySelector('[data-node-id="p1"]') as HTMLElement).style.zIndex)).toBe(0);
  });
});
