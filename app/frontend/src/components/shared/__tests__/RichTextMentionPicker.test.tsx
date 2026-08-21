/**
 * RichTextMentionEditor — @ and @# picker feedback.
 *
 * The reported bug was "typing @# does nothing". It wasn't that the trigger
 * failed: the dropdown was gated on `activeItems.length > 0`, and
 * `search/views.py::global_search` returns [] for a term under 2 characters —
 * so `@#` (and `@#a`) rendered no element at all, with no hint that a longer
 * query was needed.
 *
 * Runs against the REAL TipTap editor: the trigger lives in ProseMirror's
 * onUpdate, so a stub would prove nothing. Text is delivered by paste because
 * ProseMirror ignores synthetic per-character keydown in jsdom.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import RichTextMentionEditor from "../RichTextMentionEditor";

/** The contenteditable ProseMirror node inside the editor. */
function pm(): HTMLElement {
  const el = document.querySelector(".ProseMirror");
  if (!el) throw new Error("ProseMirror node did not render");
  return el as HTMLElement;
}

/** ProseMirror does not act on synthetic keydown, but it does handle paste. */
function type(text: string) {
  fireEvent.paste(pm(), {
    clipboardData: {
      getData: (t: string) => (t === "text/plain" ? text : ""),
      types: ["text/plain"],
      files: [],
    },
  });
}

function renderEditor(props: Partial<React.ComponentProps<typeof RichTextMentionEditor>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <RichTextMentionEditor value="" onChange={onChange} placeholder="Add a note…" {...props} />
  );
  return { onChange, ...utils };
}

const dropdown = () => document.querySelector("[data-mention-dropdown]");

describe("@# record picker", () => {
  it("tells you to keep typing instead of rendering nothing (the reported bug)", async () => {
    renderEditor();
    type("@#");

    await waitFor(() => {
      expect(screen.getByText(/Type at least 2 characters to search records/i)).toBeInTheDocument();
    });
    expect(dropdown()).toBeInTheDocument();
  });

  it("still shows the hint at one character, since the backend would return nothing", async () => {
    renderEditor();
    type("@#a");

    await waitFor(() => {
      expect(screen.getByText(/Type at least 2 characters/i)).toBeInTheDocument();
    });
  });

  it("lists matching records once the query is long enough", async () => {
    renderEditor();
    type("@#ac");

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });
    expect(screen.getByText("Finish Q3 review")).toBeInTheDocument();
  });

  it("says so when a long-enough query matches nothing", async () => {
    server.use(http.get("*/api/v1/search/", () => HttpResponse.json({ results: [] })));
    renderEditor();
    type("@#zzzz");

    await waitFor(() => {
      expect(screen.getByText(/No results for/i)).toBeInTheDocument();
    });
  });

  it("inserts the record as a link and reports it to onReferenceInsert", async () => {
    const onReferenceInsert = vi.fn();
    const onChange = vi.fn();
    render(<RichTextMentionEditor value="" onChange={onChange} onReferenceInsert={onReferenceInsert} />);
    type("@#ac");

    const option = await screen.findByText("Acme Corp");
    fireEvent.mouseDown(option);

    await waitFor(() => expect(onReferenceInsert).toHaveBeenCalledTimes(1));
    expect(onReferenceInsert.mock.calls[0][0]).toMatchObject({
      resource_type: "account",
      resource_id: 1,
      label: "Acme Corp",
      url: "/accounts/1",
    });
    // The href must reach the note body, since that is what the renderer
    // matches references against on read.
    const html = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(html).toContain('href="/accounts/1"');
  });

  it("closes the picker on Escape", async () => {
    renderEditor();
    type("@#ac");
    await screen.findByText("Acme Corp");

    fireEvent.keyDown(pm(), { key: "Escape" });

    await waitFor(() => expect(dropdown()).not.toBeInTheDocument());
  });
});

describe("@ user picker", () => {
  it("lists team members", async () => {
    renderEditor();
    type("@");

    await waitFor(() => expect(dropdown()).toBeInTheDocument());
  });

  it("renders above the z-50 layer that modals and side panels occupy", async () => {
    renderEditor();
    type("@#");

    await waitFor(() => expect(dropdown()).toBeInTheDocument());
    // A z-50 dropdown is painted under any z-50 panel that contains it.
    expect(dropdown()?.className).toContain("z-[100]");
  });
});
