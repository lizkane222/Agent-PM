import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ExpandableSection, CardList, fieldsOf, fmtSeconds, humanize, type FullCard } from "../fullscreen";

const renderSection = (extra: React.ReactNode = null) => render(
  <ExpandableSection title="Things" accent="#123456" renderFull={() => <p>FULL CONTENT</p>}>
    <p data-testid="body">Body text</p>
    {extra}
  </ExpandableSection>,
);

describe("ExpandableSection — opening and closing", () => {
  it("is closed until asked", () => {
    renderSection();
    expect(screen.queryByTestId("fullscreen-panel")).toBeNull();
  });

  it("the icon at the bottom-right opens the full-screen panel", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Open Things in full screen" }));
    const panel = screen.getByRole("dialog", { name: "Things — full screen" });
    expect(within(panel).getByText("FULL CONTENT")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Things" })).toBeInTheDocument();
  });

  it("the icon sits after the content, right-aligned", () => {
    renderSection();
    const btn = screen.getByRole("button", { name: /full screen/ });
    expect(btn.parentElement?.style.justifyContent).toBe("flex-end");
    expect(screen.getByTestId("body").compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a double-click on the section opens it", () => {
    renderSection();
    fireEvent.doubleClick(screen.getByTestId("body"));
    expect(screen.getByTestId("fullscreen-panel")).toBeInTheDocument();
  });

  it("a double-click on a control inside the section is left to that control", () => {
    const onEdit = vi.fn();
    renderSection(<>
      <button onDoubleClick={onEdit}>Edit</button>
      <input aria-label="field" />
      <a href="#x">link</a>
      <div contentEditable suppressContentEditableWarning data-testid="editable">typing</div>
      <div data-no-fullscreen><span data-testid="canvas">canvas</span></div>
    </>);
    for (const el of [screen.getByRole("button", { name: "Edit" }), screen.getByLabelText("field"), screen.getByText("link"), screen.getByTestId("editable"), screen.getByTestId("canvas")]) {
      fireEvent.doubleClick(el);
    }
    expect(screen.queryByTestId("fullscreen-panel")).toBeNull();
    expect(onEdit).toHaveBeenCalled();
  });

  it("Escape closes it", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /full screen/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("fullscreen-panel")).toBeNull();
  });

  it("the X in the top-right closes it", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /full screen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close full screen" }));
    expect(screen.queryByTestId("fullscreen-panel")).toBeNull();
  });

  it("an Escape that something else already handled does not also close it", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /full screen/ }));
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(screen.getByTestId("fullscreen-panel")).toBeInTheDocument();
  });

  it("other keys do not close it", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /full screen/ }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByTestId("fullscreen-panel")).toBeInTheDocument();
  });

  it("is rendered outside the section so it covers the whole page", () => {
    const { container } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: /full screen/ }));
    expect(container.contains(screen.getByTestId("fullscreen-panel"))).toBe(false);
    expect(screen.getByTestId("fullscreen-panel").style.position).toBe("fixed");
  });

  it("stops listening for Escape once closed", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /full screen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close full screen" }));
    fireEvent.keyDown(document, { key: "Escape" }); // must not throw or reopen
    expect(screen.queryByTestId("fullscreen-panel")).toBeNull();
  });
});

describe("CardList", () => {
  const cards: FullCard[] = [
    { id: 1, title: "First", subtitle: "one", fields: [{ label: "Colour", value: "red" }, { label: "Size", value: "L" }] },
    { id: 2, title: "Second", fields: [{ label: "Colour", value: "blue" }] },
    { id: 3, title: "Third", fields: [{ label: "Colour", value: "green" }], actions: <button>Do it</button> },
  ];
  const renderCards = () => render(<CardList cards={cards} accent="#123456" empty="Nothing." />);

  it("shows every card closed, with its title and a one-line summary", () => {
    renderCards();
    expect(screen.getAllByTestId("full-card")).toHaveLength(3);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.queryByText("red")).toBeNull();
  });

  it("clicking a card shows all of its data", () => {
    renderCards();
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    expect(screen.getByText("Colour")).toBeInTheDocument();
    expect(screen.getByText("red")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("blue")).toBeNull();
  });

  it("several cards can be open at the same time", () => {
    renderCards();
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    fireEvent.click(screen.getByRole("button", { name: /Third/ }));
    expect(screen.getByText("red")).toBeInTheDocument();
    expect(screen.getByText("green")).toBeInTheDocument();
    expect(screen.getAllByTestId("full-card").filter(c => c.getAttribute("data-open") === "true")).toHaveLength(2);
  });

  it("clicking an open card closes just that one", () => {
    renderCards();
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    fireEvent.click(screen.getByRole("button", { name: /Third/ }));
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    expect(screen.queryByText("red")).toBeNull();
    expect(screen.getByText("green")).toBeInTheDocument();
  });

  it("an open card shows its actions; a closed one does not", () => {
    renderCards();
    expect(screen.queryByRole("button", { name: "Do it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Third/ }));
    expect(screen.getByRole("button", { name: "Do it" })).toBeInTheDocument();
  });

  it("lays the cards out in a grid (several per row), not one long column", () => {
    renderCards();
    const grid = screen.getByTestId("card-grid");
    expect(grid.style.display).toBe("grid");
    expect(grid.style.gridTemplateColumns).toMatch(/repeat\(auto-fill, minmax\(\d+px, 1fr\)\)/);
    // Opening one card leaves its neighbours at their own height (align-items: start).
    expect(grid.style.alignItems).toBe("start");
    expect(within(grid).getAllByTestId("full-card")).toHaveLength(3);
  });

  it("Expand all / Collapse all", () => {
    renderCards();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("red")).toBeInTheDocument();
    expect(screen.getByText("blue")).toBeInTheDocument();
    expect(screen.getByText("green")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("red")).toBeNull();
  });

  it("exposes the open state to assistive tech", () => {
    renderCards();
    const first = screen.getByRole("button", { name: /First/ });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
  });

  it("says so when there is nothing", () => {
    render(<CardList cards={[]} accent="#000" empty="Nothing." />);
    expect(screen.getByText("Nothing.")).toBeInTheDocument();
  });
});

describe("fieldsOf", () => {
  const rows = (o: object, opts = {}) => render(
    <dl>{fieldsOf(o, opts).map(f => <div key={f.label}><dt>{f.label}</dt><dd data-testid={f.label}>{f.value}</dd></div>)}</dl>,
  );

  it("labels every field and shows a dash for an empty one rather than dropping it", () => {
    rows({ account_name: null, task: "", due_date: "2026-11-12", note_text: "hi" });
    expect(screen.getByText("Account name")).toBeInTheDocument();
    expect(screen.getByTestId("Account name").textContent).toBe("—");
    expect(screen.getByTestId("Task").textContent).toBe("—");
    expect(screen.getByTestId("Note text").textContent).toBe("hi");
  });

  it("formats dates, durations, booleans and links", () => {
    rows({ due_date: "2026-11-12", time_spent: 5400, active: true, slack_thread_url: "https://x.slack.com/a" }, { seconds: ["time_spent"] });
    expect(screen.getByTestId("Due date").textContent).toMatch(/Nov 12, 2026/);
    expect(screen.getByTestId("Time spent").textContent).toBe("1h 30m");
    expect(screen.getByTestId("Active").textContent).toBe("Yes");
    expect(screen.getByRole("link", { name: "https://x.slack.com/a" }).getAttribute("rel")).toContain("noopener");
  });

  it("renders rich text as formatted, sanitized HTML", () => {
    const { container } = rows({ task_details: '<ul><li>one</li></ul><script>1</script><img src=x onerror="1">' }, { html: ["task_details"] });
    expect(container.querySelector(".rich-text ul > li")?.textContent).toBe("one");
    expect(container.innerHTML).not.toContain("<script");
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("lists array items by name, and honours hide / labels", () => {
    rows({ id: 9, secret: "x", people: [{ name: "Ann" }, { title: "Bob" }], tags: [] }, { hide: ["id", "secret"], labels: { people: "Who" } });
    expect(screen.queryByText("Secret")).toBeNull();
    expect(screen.getByTestId("Who").textContent).toBe("AnnBob");
    expect(screen.getByTestId("Tags").textContent).toBe("—");
  });

  it("humanize and fmtSeconds", () => {
    expect(humanize("airtable_id")).toBe("Airtable ID");
    expect(humanize("slack_thread_url")).toBe("Slack thread URL");
    expect(fmtSeconds(0)).toBe("—");
    expect(fmtSeconds(90)).toBe("2m");
    expect(fmtSeconds(7200)).toBe("2h");
  });
});
