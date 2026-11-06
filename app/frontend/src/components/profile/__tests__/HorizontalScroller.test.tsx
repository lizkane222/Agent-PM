import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HorizontalScroller, { scrollEdges } from "../HorizontalScroller";

describe("scrollEdges", () => {
  it("shows nothing when the content fits", () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({ left: false, right: false });
  });
  it("shows only the right edge at the start of an overflowing row", () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 900, clientWidth: 300 })).toEqual({ left: false, right: true });
  });
  it("shows both edges in the middle", () => {
    expect(scrollEdges({ scrollLeft: 200, scrollWidth: 900, clientWidth: 300 })).toEqual({ left: true, right: true });
  });
  it("shows only the left edge at the end", () => {
    expect(scrollEdges({ scrollLeft: 600, scrollWidth: 900, clientWidth: 300 })).toEqual({ left: true, right: false });
  });
  it("treats a sub-pixel gap at either end as reached", () => {
    expect(scrollEdges({ scrollLeft: 0.5, scrollWidth: 900, clientWidth: 300 }).left).toBe(false);
    expect(scrollEdges({ scrollLeft: 599.4, scrollWidth: 900, clientWidth: 300 }).right).toBe(false);
  });
});

// jsdom has no layout, so sizes are stubbed on the prototype and restored after each test.
const proto = HTMLElement.prototype;
const originals = {
  scrollWidth: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
  clientWidth: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
};
function stubSizes(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => clientWidth });
}
afterEach(() => {
  for (const [k, d] of Object.entries(originals)) {
    if (d) Object.defineProperty(proto, k, d);
    else delete (proto as unknown as Record<string, unknown>)[k];
  }
});

const cards = [1, 2, 3].map(i => <div key={i} style={{ width: 260 }}>card {i}</div>);

describe("HorizontalScroller", () => {
  it("lays its children out in one row that scrolls sideways", () => {
    render(<HorizontalScroller label="Things">{cards}</HorizontalScroller>);
    const region = screen.getByRole("region", { name: "Things" });
    expect(region.style.display).toBe("flex");
    expect(region.style.overflowX).toBe("auto");
    expect(region.style.flexWrap).toBe("");
  });

  it("shows a right shadow only, when there is more to the right", () => {
    stubSizes(900, 300);
    render(<HorizontalScroller label="Things">{cards}</HorizontalScroller>);
    expect(screen.getByTestId("scroll-shadow-right")).toBeInTheDocument();
    expect(screen.queryByTestId("scroll-shadow-left")).toBeNull();
  });

  it("shows no shadow at all when the row fits", () => {
    stubSizes(300, 300);
    render(<HorizontalScroller label="Things">{cards}</HorizontalScroller>);
    expect(screen.queryByTestId("scroll-shadow-right")).toBeNull();
    expect(screen.queryByTestId("scroll-shadow-left")).toBeNull();
  });

  it("moves the shadows as the user scrolls", () => {
    stubSizes(900, 300);
    render(<HorizontalScroller label="Things">{cards}</HorizontalScroller>);
    const region = screen.getByRole("region", { name: "Things" });

    region.scrollLeft = 200;
    fireEvent.scroll(region);
    expect(screen.getByTestId("scroll-shadow-left")).toBeInTheDocument();
    expect(screen.getByTestId("scroll-shadow-right")).toBeInTheDocument();

    region.scrollLeft = 600;
    fireEvent.scroll(region);
    expect(screen.getByTestId("scroll-shadow-left")).toBeInTheDocument();
    expect(screen.queryByTestId("scroll-shadow-right")).toBeNull();

    region.scrollLeft = 0;
    fireEvent.scroll(region);
    expect(screen.queryByTestId("scroll-shadow-left")).toBeNull();
    expect(screen.getByTestId("scroll-shadow-right")).toBeInTheDocument();
  });

  it("never intercepts clicks: the shadows are pointer-events none and hidden from screen readers", () => {
    stubSizes(900, 300);
    render(<HorizontalScroller label="Things">{cards}</HorizontalScroller>);
    const shadow = screen.getByTestId("scroll-shadow-right");
    expect(shadow.style.pointerEvents).toBe("none");
    expect(shadow.getAttribute("aria-hidden")).toBe("true");
  });

  it("is keyboard reachable so the row can be scrolled with the arrow keys", () => {
    render(<HorizontalScroller label="Things">{cards}</HorizontalScroller>);
    expect(screen.getByRole("region", { name: "Things" }).getAttribute("tabindex")).toBe("0");
  });
});
