import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import PageSectionsPanel, { type SectionTile } from "../PageSectionsPanel";

const MAIN: SectionTile[] = [
  { id: "m1", label: "Alpha", icon: "A" }, { id: "m2", label: "Beta", icon: "B" }, { id: "m3", label: "Gamma", icon: "G" },
];
const SIDE: SectionTile[] = [{ id: "s1", label: "Side One", icon: "1" }, { id: "s2", label: "Side Two", icon: "2" }];

function Harness({ mainOrder = ["m1", "m2"], sideOrder = ["s1"], onReveal = vi.fn(), onAdded = vi.fn() }) {
  const [main, setMain] = useState<string[]>(mainOrder);
  const [side, setSide] = useState<string[]>(sideOrder);
  return (
    <>
      <PageSectionsPanel open onClose={() => {}} accent="#7c3aed" text="#4c1d95"
        main={{ tiles: MAIN, order: main, onChange: setMain }} side={{ tiles: SIDE, order: side, onChange: setSide }}
        onReveal={onReveal} onAdded={onAdded} />
      <output data-testid="main-order">{main.join(",")}</output>
      <output data-testid="side-order">{side.join(",")}</output>
    </>
  );
}
const order = (id: string) => screen.getByTestId(id).textContent;
const rows = (list: string) => within(screen.getByTestId(`sections-list-${list}`)).getAllByTestId(/section-row-/).map(r => r.getAttribute("data-testid")?.replace("section-row-", ""));

describe("PageSectionsPanel", () => {
  it("shows + for a section that is not on the page and − for one that is", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Add Gamma to your page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Gamma from your page" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Alpha from your page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Alpha to your page" })).toBeNull();
  });

  it("clicking + adds it to the end of the page order, tells the page, and says so", () => {
    const onAdded = vi.fn();
    render(<Harness onAdded={onAdded} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Gamma to your page" }));
    expect(order("main-order")).toBe("m1,m2,m3");
    expect(onAdded).toHaveBeenCalledWith("m3");
    expect(screen.getByTestId("sections-status").textContent).toBe("Added Gamma to your page");
    // The button has flipped to −.
    expect(screen.getByRole("button", { name: "Remove Gamma from your page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Gamma to your page" })).toBeNull();
  });

  it("the row flashes when added (a visible signal that the click did something)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add Gamma to your page" }));
    expect(screen.getByTestId("section-row-m3").style.background).toContain("rgba(124, 58, 237");
  });

  it("clicking − removes it and says so", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha from your page" }));
    expect(order("main-order")).toBe("m2");
    expect(screen.getByTestId("sections-status").textContent).toBe("Removed Alpha from your page");
    expect(screen.getByRole("button", { name: "Add Alpha to your page" })).toBeInTheDocument();
  });

  it("clicking a section's name jumps to it", () => {
    const onReveal = vi.fn();
    render(<Harness onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: "Go to Beta" }));
    expect(onReveal).toHaveBeenCalledWith("m2");
  });

  it("lists the sections in page order, then the rest", () => {
    render(<Harness mainOrder={["m3", "m1"]} />);
    expect(rows("main-column")).toEqual(["m3", "m1", "m2"]);
  });

  it("▲ ▼ reorder, and the first / last cannot move past the ends", () => {
    render(<Harness mainOrder={["m1", "m2", "m3"]} />);
    expect(screen.getByRole("button", { name: "Move Alpha up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Gamma down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Gamma up" }));
    expect(order("main-order")).toBe("m1,m3,m2");
    expect(rows("main-column")).toEqual(["m1", "m3", "m2"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
    expect(order("main-order")).toBe("m3,m1,m2");
  });

  it("dragging a row onto another reorders", () => {
    render(<Harness mainOrder={["m1", "m2", "m3"]} />);
    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(screen.getByTestId("section-row-m3"), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId("section-row-m1"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("section-row-m1"), { dataTransfer: dt });
    expect(order("main-order")).toBe("m3,m1,m2");
  });

  it("dropping a row on itself changes nothing", () => {
    render(<Harness mainOrder={["m1", "m2"]} />);
    const dt = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(screen.getByTestId("section-row-m1"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("section-row-m1"), { dataTransfer: dt });
    expect(order("main-order")).toBe("m1,m2");
  });

  it("the side column is its own ordered list, independent of the main one", () => {
    render(<Harness sideOrder={["s1"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Side Two to your page" }));
    expect(order("side-order")).toBe("s1,s2");
    expect(order("main-order")).toBe("m1,m2");
    fireEvent.click(screen.getByRole("button", { name: "Move Side Two up" }));
    expect(order("side-order")).toBe("s2,s1");
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <PageSectionsPanel open={false} onClose={() => {}} accent="#000" text="#000"
        main={{ tiles: MAIN, order: [], onChange: () => {} }} side={{ tiles: SIDE, order: [], onChange: () => {} }}
        onReveal={() => {}} onAdded={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
