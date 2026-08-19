import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import StepsPanel from "../StepsPanel";
import { mockStep } from "../../../test/handlers/steps";
import type { ActionItemStep } from "../../../types";

vi.mock("../../comments/InlineCommentThread", () => ({ default: () => <div data-testid="comments" /> }));

const STEPS_URL = "/api/v1/airtable/steps/";
const ACTION_ITEM_ID = 10;

/** Serve a fixed checklist, and record every write the panel makes. */
function serveSteps(steps: ActionItemStep[]) {
  const patches: { id: string; body: Partial<ActionItemStep> }[] = [];
  const posts: Partial<ActionItemStep>[] = [];
  const deletes: string[] = [];
  const reorders: number[][] = [];
  // Mutable, so a reorder is reflected by the next GET exactly as the real endpoint would.
  // With a static list the refetch would revert the optimistic order and mask real bugs.
  let current = [...steps];
  server.use(
    http.get(STEPS_URL, () => HttpResponse.json(current)),
    http.patch(`${STEPS_URL}:id/`, async ({ params, request }) => {
      const body = (await request.json()) as Partial<ActionItemStep>;
      patches.push({ id: String(params.id), body });
      return HttpResponse.json(mockStep(body));
    }),
    http.post(STEPS_URL, async ({ request }) => {
      const body = (await request.json()) as Partial<ActionItemStep>;
      posts.push(body);
      return HttpResponse.json(mockStep({ ...body, id: 99 }), { status: 201 });
    }),
    http.delete(`${STEPS_URL}:id/`, ({ params }) => {
      deletes.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${STEPS_URL}reorder/`, async ({ request }) => {
      const body = (await request.json()) as { ids: number[] };
      reorders.push(body.ids);
      const byId = new Map(current.map((st) => [st.id, st]));
      const listed = body.ids.map((id) => byId.get(id)).filter((st): st is ActionItemStep => !!st);
      const seen = new Set(listed.map((st) => st.id));
      current = [...listed, ...current.filter((st) => !seen.has(st.id))];
      return HttpResponse.json(current);
    }),
  );
  return { patches, posts, deletes, reorders };
}

/**
 * Drag `fromTitle` onto `toTitle`. jsdom has no DragEvent (RTL falls back to a plain Event
 * and drops clientY) and getBoundingClientRect returns zeros, so the row box is stubbed and
 * dragover is dispatched as a MouseEvent carrying real coordinates.
 */
function dragStepOnto(fromTitle: string, toTitle: string, { above }: { above: boolean }) {
  const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  try {
    const handle = within(rowFor(fromTitle)).getByRole("button", { name: /^Reorder / });
    fireEvent.dragStart(handle, { dataTransfer: { effectAllowed: "", setData: vi.fn() } });

    const target = rowFor(toTitle);
    const over = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY: above ? 10 : 90 });
    Object.defineProperty(over, "dataTransfer", { value: { effectAllowed: "", dropEffect: "" } });
    fireEvent(target, over);

    fireEvent.drop(target, { dataTransfer: { getData: vi.fn(() => "") } });
  } finally {
    rects.mockRestore();
  }
}

/** Visible step titles, top to bottom. */
function renderedTitles(): string[] {
  return screen.getAllByTitle("Click to edit").map((el) => el.textContent ?? "");
}

const openStep = (id: number, title: string, order: number) =>
  mockStep({ id, title, order, status: "Open", action_item: ACTION_ITEM_ID });
const doneStep = (id: number, title: string, order: number) =>
  mockStep({ id, title, order, status: "Done", action_item: ACTION_ITEM_ID });

function renderPanel() {
  return render(<StepsPanel actionItemId={ACTION_ITEM_ID} />);
}

/** The row containing a step's title. */
function rowFor(title: string): HTMLElement {
  const label = screen.getByText(title);
  return label.closest(".group") as HTMLElement;
}

describe("StepsPanel", () => {
  beforeEach(() => {
    serveSteps([]);
  });

  it("seeds a greyed-out draft row instead of an empty state", async () => {
    renderPanel();
    const draft = await screen.findByPlaceholderText("Add an item…");

    // No "no steps yet" copy and nothing to click before typing.
    expect(screen.queryByText(/No steps yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add one" })).not.toBeInTheDocument();

    // It is a real input, so you can type straight into it.
    expect(draft).toBeEnabled();
    expect(draft.className).toContain("placeholder:italic");
    expect(draft.className).toContain("placeholder:text-gray-400");
    // Previewed as the next item in the list.
    expect(screen.getByText("1.")).toBeInTheDocument();
  });

  it("numbers the draft row after the existing steps", async () => {
    serveSteps([openStep(1, "a", 0), openStep(2, "b", 1)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());

    expect(screen.getByText("3.")).toBeInTheDocument();
  });

  it("typing into the draft row and pressing Enter creates the step with no Add click", async () => {
    const { posts } = serveSteps([]);
    renderPanel();
    const draft = await screen.findByPlaceholderText("Add an item…");

    fireEvent.change(draft, { target: { value: "straight in" } });
    fireEvent.keyDown(draft, { key: "Enter" });

    await waitFor(() => expect(posts.map((p) => p.title)).toEqual(["straight in"]));
  });

  it("blurring the draft row with text commits it", async () => {
    const { posts } = serveSteps([]);
    renderPanel();
    const draft = await screen.findByPlaceholderText("Add an item…");

    fireEvent.change(draft, { target: { value: "committed on blur" } });
    fireEvent.blur(draft);

    await waitFor(() => expect(posts.map((p) => p.title)).toEqual(["committed on blur"]));
  });

  it("Escape clears the draft row without creating anything", async () => {
    const { posts } = serveSteps([]);
    renderPanel();
    const draft = await screen.findByPlaceholderText("Add an item…");

    fireEvent.change(draft, { target: { value: "never mind" } });
    fireEvent.keyDown(draft, { key: "Escape" });

    expect((draft as HTMLInputElement).value).toBe("");
    expect(posts).toEqual([]);
  });

  it("numbers the steps", async () => {
    serveSteps([openStep(1, "First thing", 0), openStep(2, "Second thing", 1), openStep(3, "Third thing", 2)]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("First thing")).toBeInTheDocument());

    expect(within(rowFor("First thing")).getByText("1.")).toBeInTheDocument();
    expect(within(rowFor("Second thing")).getByText("2.")).toBeInTheDocument();
    expect(within(rowFor("Third thing")).getByText("3.")).toBeInTheDocument();
  });

  it("shows the completed count and percentage", async () => {
    // 1 of 4 done — the 25% in the Trello reference.
    serveSteps([doneStep(1, "a", 0), openStep(2, "b", 1), openStep(3, "c", 2), openStep(4, "d", 3)]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("1/4")).toBeInTheDocument());
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("shows the progress bar as soon as any step exists, not only at 100%", async () => {
    serveSteps([openStep(1, "a", 0), openStep(2, "b", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("reports 100% when every step is checked", async () => {
    serveSteps([doneStep(1, "a", 0), doneStep(2, "b", 1)]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("100%")).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("checking a step PATCHes status Done", async () => {
    const { patches } = serveSteps([openStep(1, "Draft the doc", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Draft the doc")).toBeInTheDocument());

    fireEvent.click(within(rowFor("Draft the doc")).getByRole("checkbox"));

    await waitFor(() => expect(patches).toEqual([{ id: "1", body: { status: "Done" } }]));
  });

  it("unchecking a done step PATCHes status Open", async () => {
    const { patches } = serveSteps([doneStep(1, "Draft the doc", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Draft the doc")).toBeInTheDocument());

    fireEvent.click(within(rowFor("Draft the doc")).getByRole("checkbox"));

    await waitFor(() => expect(patches).toEqual([{ id: "1", body: { status: "Open" } }]));
  });

  it("renders a done step as checked and struck through", async () => {
    serveSteps([doneStep(1, "Finished thing", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Finished thing")).toBeInTheDocument());

    expect(within(rowFor("Finished thing")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Finished thing").className).toContain("line-through");
  });

  it("Hide checked items removes done rows and keeps the rest numbered by true position", async () => {
    serveSteps([openStep(1, "keep me", 0), doneStep(2, "hide me", 1), openStep(3, "keep me too", 2)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("hide me")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Hide checked items" }));

    expect(screen.queryByText("hide me")).not.toBeInTheDocument();
    expect(screen.getByText("keep me")).toBeInTheDocument();
    // Numbers stay tied to the full list, so the gap signals something is hidden.
    expect(within(rowFor("keep me")).getByText("1.")).toBeInTheDocument();
    expect(within(rowFor("keep me too")).getByText("3.")).toBeInTheDocument();
  });

  it("the hide toggle flips back to Show checked items with a count", async () => {
    serveSteps([openStep(1, "open", 0), doneStep(2, "done", 1)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Hide checked items" }));
    fireEvent.click(screen.getByRole("button", { name: "Show checked items (1)" }));

    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("offers no hide toggle until something is checked", async () => {
    serveSteps([openStep(1, "a", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /Hide checked items/ })).not.toBeInTheDocument();
  });

  it("explains the empty list when everything is hidden", async () => {
    serveSteps([doneStep(1, "a", 0), doneStep(2, "b", 1)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Hide checked items" }));

    expect(screen.getByText("All 2 steps are done.")).toBeInTheDocument();
  });

  it("adds a step, ordered after the existing ones", async () => {
    const { posts } = serveSteps([openStep(1, "existing", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("existing")).toBeInTheDocument());

    const draft = screen.getByPlaceholderText("Add an item…");
    fireEvent.change(draft, { target: { value: "brand new" } });
    fireEvent.keyDown(draft, { key: "Enter" });

    await waitFor(() =>
      expect(posts).toEqual([{ action_item: ACTION_ITEM_ID, title: "brand new", order: 1 }])
    );
  });

  it("clears the draft row after a successful add so the next item can be typed", async () => {
    const { posts } = serveSteps([]);
    renderPanel();
    const draft = await screen.findByPlaceholderText("Add an item…");

    fireEvent.change(draft, { target: { value: "first" } });
    fireEvent.keyDown(draft, { key: "Enter" });

    await waitFor(() => expect(posts.map((p) => p.title)).toEqual(["first"]));
    await waitFor(() => expect((draft as HTMLInputElement).value).toBe(""));
  });

  it("will not create a step from whitespace", async () => {
    const { posts } = serveSteps([]);
    renderPanel();
    const draft = await screen.findByPlaceholderText("Add an item…");

    fireEvent.change(draft, { target: { value: "   " } });
    fireEvent.keyDown(draft, { key: "Enter" });
    fireEvent.blur(draft);

    await new Promise((r) => setTimeout(r, 20));
    expect(posts).toEqual([]);
  });

  it("deletes a step", async () => {
    const { deletes } = serveSteps([openStep(4, "Remove me", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Remove me")).toBeInTheDocument());

    fireEvent.click(within(rowFor("Remove me")).getByTitle("Delete step"));

    await waitFor(() => expect(deletes).toEqual(["4"]));
  });

  it("renames a step after clicking its line", async () => {
    const { patches } = serveSteps([openStep(1, "Old name", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Old name")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Old name"));
    const input = screen.getByDisplayValue("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(patches).toEqual([{ id: "1", body: { title: "New name" } }]));
  });

  it("treats a legacy Blocked step as unchecked rather than hiding it", async () => {
    // The UI is binary, but the model still allows Blocked/Archived.
    serveSteps([mockStep({ id: 1, title: "Blocked thing", status: "Blocked", action_item: ACTION_ITEM_ID })]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Blocked thing")).toBeInTheDocument());
    expect(within(rowFor("Blocked thing")).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("0/1")).toBeInTheDocument();
  });
  // ── Drag to reorder ─────────────────────────────────────────────────────────

  it("dragging a step above another reorders it and renumbers the list", async () => {
    const { reorders } = serveSteps([openStep(1, "alpha", 0), openStep(2, "beta", 1), openStep(3, "gamma", 2)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    expect(renderedTitles()).toEqual(["alpha", "beta", "gamma"]);

    dragStepOnto("gamma", "alpha", { above: true });

    await waitFor(() => expect(reorders).toEqual([[3, 1, 2]]));
    // The numbers follow the new order.
    await waitFor(() => expect(renderedTitles()).toEqual(["gamma", "alpha", "beta"]));
    expect(within(rowFor("gamma")).getByText("1.")).toBeInTheDocument();
    expect(within(rowFor("alpha")).getByText("2.")).toBeInTheDocument();
    expect(within(rowFor("beta")).getByText("3.")).toBeInTheDocument();
  });

  it("dropping on the lower half of a row places the step after it", async () => {
    const { reorders } = serveSteps([openStep(1, "alpha", 0), openStep(2, "beta", 1), openStep(3, "gamma", 2)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    dragStepOnto("alpha", "beta", { above: false });

    await waitFor(() => expect(reorders).toEqual([[2, 1, 3]]));
  });

  it("dragging to the last row's lower half moves the step to the end", async () => {
    const { reorders } = serveSteps([openStep(1, "alpha", 0), openStep(2, "beta", 1), openStep(3, "gamma", 2)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    dragStepOnto("alpha", "gamma", { above: false });

    await waitFor(() => expect(reorders).toEqual([[2, 3, 1]]));
  });

  it("shows an insertion indicator while dragging over a row", async () => {
    serveSteps([openStep(1, "alpha", 0), openStep(2, "beta", 1)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    expect(screen.queryByTestId("step-drop-indicator")).not.toBeInTheDocument();

    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    try {
      fireEvent.dragStart(within(rowFor("beta")).getByRole("button", { name: /^Reorder / }), {
        dataTransfer: { effectAllowed: "", setData: vi.fn() },
      });
      const over = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY: 10 });
      Object.defineProperty(over, "dataTransfer", { value: { effectAllowed: "", dropEffect: "" } });
      fireEvent(rowFor("alpha"), over);

      expect(screen.getByTestId("step-drop-indicator")).toBeInTheDocument();
    } finally {
      rects.mockRestore();
    }
  });

  it("dropping a step where it already was sends no request", async () => {
    const { reorders } = serveSteps([openStep(1, "alpha", 0), openStep(2, "beta", 1)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    // Lower half of the row above it == its current slot.
    dragStepOnto("beta", "alpha", { above: false });

    await new Promise((r) => setTimeout(r, 30));
    expect(reorders).toEqual([]);
  });

  it("every row exposes a labelled drag handle", async () => {
    serveSteps([openStep(1, "alpha", 0), openStep(2, "beta", 1)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    expect(within(rowFor("alpha")).getByRole("button", { name: "Reorder alpha" })).toBeInTheDocument();
    expect(within(rowFor("beta")).getByRole("button", { name: "Reorder beta" })).toBeInTheDocument();
  });

  it("reorders correctly while checked items are hidden", async () => {
    // beta is hidden, so the visible list is alpha, gamma — but the persisted order must
    // still describe the full list.
    const { reorders } = serveSteps([openStep(1, "alpha", 0), doneStep(2, "beta", 1), openStep(3, "gamma", 2)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("beta")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hide checked items" }));
    expect(renderedTitles()).toEqual(["alpha", "gamma"]);

    dragStepOnto("gamma", "alpha", { above: true });

    await waitFor(() => expect(reorders).toEqual([[3, 1, 2]]));
  });

  // ── Click the line to edit ──────────────────────────────────────────────────

  it("a single click on the title starts editing", async () => {
    serveSteps([openStep(1, "click me", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("click me")).toBeInTheDocument());

    fireEvent.click(screen.getByText("click me"));

    expect(screen.getByDisplayValue("click me")).toBeInTheDocument();
  });

  it("clicking the empty space on the line also starts editing", async () => {
    serveSteps([openStep(1, "short", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("short")).toBeInTheDocument());

    // The whole line is the target, not just the glyphs.
    fireEvent.click(within(rowFor("short")).getByText("1.").parentElement!);

    expect(screen.getByDisplayValue("short")).toBeInTheDocument();
  });

  it("places the caret at the clicked character", async () => {
    serveSteps([openStep(1, "abcdefgh", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("abcdefgh")).toBeInTheDocument());

    // jsdom implements neither caret API, so stand one in to represent the browser
    // reporting "you clicked between the 3rd and 4th character".
    const label = screen.getByText("abcdefgh");
    // Indexed cast so the stub can be installed and removed — lib.dom declares
    // caretRangeFromPoint as required, so `delete` on a typed Document is rejected.
    const doc = document as unknown as Record<string, unknown>;
    const original = doc.caretRangeFromPoint;
    doc.caretRangeFromPoint = () => ({ startContainer: label.firstChild!, startOffset: 3 });
    try {
      fireEvent.click(label, { clientX: 30, clientY: 5 });
    } finally {
      if (original === undefined) delete doc.caretRangeFromPoint;
      else doc.caretRangeFromPoint = original;
    }

    const input = screen.getByDisplayValue("abcdefgh") as HTMLInputElement;
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
  });

  it("falls back to the end of the text when the browser cannot report a caret", async () => {
    serveSteps([openStep(1, "abcdefgh", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("abcdefgh")).toBeInTheDocument());

    fireEvent.click(screen.getByText("abcdefgh"));

    const input = screen.getByDisplayValue("abcdefgh") as HTMLInputElement;
    expect(input.selectionStart).toBe("abcdefgh".length);
  });

  it("clicking the checkbox toggles it without starting an edit", async () => {
    const { patches } = serveSteps([openStep(1, "guard me", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("guard me")).toBeInTheDocument());

    fireEvent.click(within(rowFor("guard me")).getByRole("checkbox"));

    await waitFor(() => expect(patches).toEqual([{ id: "1", body: { status: "Done" } }]));
    expect(screen.queryByDisplayValue("guard me")).not.toBeInTheDocument();
  });

  it("clicking the drag handle does not start an edit", async () => {
    serveSteps([openStep(1, "guard me", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("guard me")).toBeInTheDocument());

    fireEvent.click(within(rowFor("guard me")).getByRole("button", { name: "Reorder guard me" }));

    expect(screen.queryByDisplayValue("guard me")).not.toBeInTheDocument();
  });

  it("clicking the comment button does not start an edit", async () => {
    serveSteps([openStep(1, "guard me", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("guard me")).toBeInTheDocument());

    fireEvent.click(within(rowFor("guard me")).getByRole("button", { name: "Comments" }));

    expect(screen.queryByDisplayValue("guard me")).not.toBeInTheDocument();
    expect(screen.getByTestId("comments")).toBeInTheDocument();
  });

  it("clicking the delete button does not start an edit", async () => {
    const { deletes } = serveSteps([openStep(1, "guard me", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("guard me")).toBeInTheDocument());

    fireEvent.click(within(rowFor("guard me")).getByTitle("Delete step"));

    await waitFor(() => expect(deletes).toEqual(["1"]));
    expect(screen.queryByDisplayValue("guard me")).not.toBeInTheDocument();
  });

  it("clicking inside the open editor does not reset the caret", async () => {
    serveSteps([openStep(1, "abcdefgh", 0)]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("abcdefgh")).toBeInTheDocument());

    fireEvent.click(screen.getByText("abcdefgh"));
    const input = screen.getByDisplayValue("abcdefgh") as HTMLInputElement;
    input.setSelectionRange(2, 2);

    fireEvent.click(input);

    expect(input.selectionStart).toBe(2);
  });
});
