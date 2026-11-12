/**
 * RichTextMentionEditor — Enter-to-submit contract.
 *
 * These run against the REAL TipTap editor, not a stub, because the whole
 * reason `onSubmit` exists as a prop is that ProseMirror's own DOM keydown
 * listener runs before any React handler on an ancestor node. A stub would
 * pass whether or not the keyboard extension is actually registered.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RichTextMentionEditor from "../RichTextMentionEditor";

beforeAll(() => {
  // TipTap's Placeholder extension calls elementFromPoint, which jsdom lacks.
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => document.body;
  }
});

/** The contenteditable ProseMirror node inside the editor. */
function pm(): HTMLElement {
  const el = document.querySelector(".ProseMirror");
  if (!el) throw new Error("ProseMirror node did not render");
  return el as HTMLElement;
}

function renderEditor(props: Partial<React.ComponentProps<typeof RichTextMentionEditor>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <RichTextMentionEditor value="" onChange={onChange} placeholder="Add a note…" {...props} />
  );
  return { onChange, ...utils };
}

describe("RichTextMentionEditor — Enter submits", () => {
  it("renders the real ProseMirror editor", async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
  });

  it("calls onSubmit on a bare Enter", async () => {
    const onSubmit = vi.fn();
    renderEditor({ onSubmit });
    await waitFor(() => pm());

    fireEvent.keyDown(pm(), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onSubmit on Shift+Enter (that inserts a line break)", async () => {
    const onSubmit = vi.fn();
    renderEditor({ onSubmit });
    await waitFor(() => pm());

    fireEvent.keyDown(pm(), { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("swallows the Enter keypress so no stray paragraph is left behind", async () => {
    const onSubmit = vi.fn();
    renderEditor({ onSubmit, value: "<p>Follow up with Dana</p>" });
    await waitFor(() => pm());
    const before = pm().innerHTML;

    fireEvent.keyDown(pm(), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalled();
    expect(pm().innerHTML).toBe(before);
  });

  it("leaves Enter alone when no onSubmit is given (description fields)", async () => {
    renderEditor({ value: "<p>Some context</p>" });
    await waitFor(() => pm());

    // Must not throw, and must not swallow the key — the default TipTap
    // paragraph split stays in place for detail/description fields.
    expect(() => fireEvent.keyDown(pm(), { key: "Enter" })).not.toThrow();
  });

  it("submits from inside a bullet list rather than opening a new bullet", async () => {
    const onSubmit = vi.fn();
    renderEditor({ onSubmit, value: "<ul><li><p>First bullet</p></li></ul>" });
    await waitFor(() => pm());

    fireEvent.keyDown(pm(), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(pm().querySelectorAll("li")).toHaveLength(1);
  });

  it("submits from inside a checklist item too", async () => {
    const onSubmit = vi.fn();
    renderEditor({
      onSubmit,
      value: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Send deck</p></li></ul>',
    });
    await waitFor(() => pm());

    fireEvent.keyDown(pm(), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("still forwards other keys to onKeyDownCapture (Escape-to-cancel path)", async () => {
    const onKeyDownCapture = vi.fn();
    renderEditor({ onKeyDownCapture });
    await waitFor(() => pm());

    fireEvent.keyDown(pm(), { key: "Escape" });

    expect(onKeyDownCapture).toHaveBeenCalled();
    expect(onKeyDownCapture.mock.calls[0][0].key).toBe("Escape");
  });

  it("renders without an onSubmit prop and without a submit path", async () => {
    const onSubmit = vi.fn();
    const { rerender } = renderEditor({ onSubmit });
    await waitFor(() => pm());

    // The extension reads onSubmit through a ref, so a prop change must take
    // effect on the already-built editor.
    rerender(<RichTextMentionEditor value="" onChange={vi.fn()} placeholder="Add a note…" />);
    fireEvent.keyDown(pm(), { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("picks up a replaced onSubmit callback without rebuilding the editor", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderEditor({ onSubmit: first });
    await waitFor(() => pm());
    const node = pm();

    rerender(<RichTextMentionEditor value="" onChange={vi.fn()} onSubmit={second} placeholder="Add a note…" />);
    fireEvent.keyDown(pm(), { key: "Enter" });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // Same DOM node: the editor was not torn down and rebuilt.
    expect(pm()).toBe(node);
  });

  it("keeps the toolbar and placeholder intact", async () => {
    renderEditor({ onSubmit: vi.fn() });
    await waitFor(() => pm());
    expect(screen.getByTitle("Bold")).toBeInTheDocument();
    expect(screen.getByTitle("Bullet list")).toBeInTheDocument();
  });
});

describe("RichTextMentionEditor — Underline button (opt-in)", () => {
  it("is not shown by default, so notes and action items keep their existing toolbar", async () => {
    renderEditor();
    await waitFor(() => pm());
    expect(screen.getByTitle("Bold")).toBeInTheDocument();
    expect(screen.queryByTitle("Underline")).toBeNull();
  });

  it("is shown when asked for", async () => {
    renderEditor({ showUnderline: true });
    await waitFor(() => pm());
    expect(screen.getByTitle("Underline")).toBeInTheDocument();
  });

  it("underlines the selected text", async () => {
    const { onChange } = renderEditor({ showUnderline: true, value: "<p>hello</p>" });
    await waitFor(() => pm());
    fireEvent.keyDown(pm(), { key: "a", ctrlKey: true });         // select all
    fireEvent.mouseDown(screen.getByTitle("Underline"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<u>hello</u>");
  });

  it("bold and italic still work alongside it", async () => {
    const { onChange } = renderEditor({ showUnderline: true, value: "<p>hello</p>" });
    await waitFor(() => pm());
    fireEvent.keyDown(pm(), { key: "a", ctrlKey: true });
    fireEvent.mouseDown(screen.getByTitle("Bold"));
    fireEvent.mouseDown(screen.getByTitle("Italic"));
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(1));
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
  });
});

describe("RichTextMentionEditor — list buttons", () => {
  const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)?.[0] as string;

  it("Bullet list wraps the line in <ul><li>", async () => {
    const { onChange } = renderEditor({ value: "<p>apples</p>" });
    await waitFor(() => pm());
    fireEvent.mouseDown(screen.getByTitle("Bullet list"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(last(onChange)).toMatch(/<ul><li><p>apples<\/p><\/li><\/ul>/);
    expect(pm().querySelector("ul > li")).toBeTruthy();
  });

  it("Numbered list wraps the line in <ol><li>", async () => {
    const { onChange } = renderEditor({ value: "<p>apples</p>" });
    await waitFor(() => pm());
    fireEvent.mouseDown(screen.getByTitle("Numbered list"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(last(onChange)).toMatch(/<ol><li><p>apples<\/p><\/li><\/ol>/);
    expect(pm().querySelector("ol > li")).toBeTruthy();
  });

  it("Steps (checklist) makes a task list with a checkbox beside the text", async () => {
    const { onChange } = renderEditor({ value: "<p>apples</p>" });
    await waitFor(() => pm());
    fireEvent.mouseDown(screen.getByTitle("Checklist"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = last(onChange);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('type="checkbox"');
    // The structure the stylesheet lays out: <li> > <label> (checkbox) + <div> (text).
    const li = pm().querySelector('ul[data-type="taskList"] > li') as HTMLElement;
    expect(li.querySelector(":scope > label input[type=checkbox]")).toBeTruthy();
    expect(li.querySelector(":scope > div")?.textContent).toBe("apples");
  });

  it("Steps: ticking the checkbox marks the step done and is saved", async () => {
    const { onChange } = renderEditor({ value: "<p>apples</p>" });
    await waitFor(() => pm());
    fireEvent.mouseDown(screen.getByTitle("Checklist"));
    await waitFor(() => expect(pm().querySelector('input[type="checkbox"]')).toBeTruthy());
    const box = pm().querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() => expect(last(onChange)).toContain('data-checked="true"'));
  });

  it("pressing the same list button again turns the list back into a paragraph", async () => {
    const { onChange } = renderEditor({ value: "<p>apples</p>" });
    await waitFor(() => pm());
    fireEvent.mouseDown(screen.getByTitle("Bullet list"));
    await waitFor(() => expect(last(onChange)).toContain("<ul>"));
    fireEvent.mouseDown(screen.getByTitle("Bullet list"));
    await waitFor(() => expect(last(onChange)).not.toContain("<ul>"));
  });

  it("the active list button is highlighted so you can see which list you are in", async () => {
    renderEditor({ value: "<p>apples</p>" });
    await waitFor(() => pm());
    const bullet = screen.getByTitle("Bullet list");
    const before = bullet.className;
    fireEvent.mouseDown(bullet);
    await waitFor(() => expect(screen.getByTitle("Bullet list").className).not.toBe(before));
  });

  it("an existing saved list loads as a list", async () => {
    renderEditor({ value: "<ul><li><p>a</p></li><li><p>b</p></li></ul>" });
    await waitFor(() => expect(pm().querySelectorAll("ul > li")).toHaveLength(2));
  });
});
