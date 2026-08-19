import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import UrlPillInput from "../UrlPillInput";

const URL = "https://acme.slack.com/archives/C123/p456";

function setup(value?: string) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<UrlPillInput value={value} onCommit={onCommit} onCancel={onCancel} />);
  return { onCommit, onCancel, input: screen.getByPlaceholderText("https://…") as HTMLInputElement };
}

/**
 * jsdom never applies clipboard data to an input, so a handler that read the value back after
 * the default paste would see nothing here — and would be untestable. `UrlPillInput` splices
 * the pasted text in itself, which this exercises directly.
 */
function paste(input: HTMLInputElement, text: string) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

describe("UrlPillInput", () => {
  it("commits a pasted URL immediately", () => {
    // The whole point: pasting a link is the entire intent of this field, so it must not wait
    // for a blur that the user has no reason to know is required.
    const { onCommit, input } = setup();
    paste(input, URL);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(URL);
  });

  it("splices a paste into the existing value at the cursor", () => {
    const { onCommit, input } = setup("https://x.com/keep");
    input.setSelectionRange(input.value.length, input.value.length);
    paste(input, "/more");
    expect(onCommit).toHaveBeenCalledWith("https://x.com/keep/more");
  });

  it("replaces the selection on paste", () => {
    const { onCommit, input } = setup("https://old.example.com");
    input.setSelectionRange(0, input.value.length);
    paste(input, URL);
    expect(onCommit).toHaveBeenCalledWith(URL);
  });

  it("commits on Enter and does not let the key reach an enclosing form", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: URL } });
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(URL);
    expect(event.defaultPrevented).toBe(true);
  });

  it("commits on blur", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: URL } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(URL);
  });

  it("trims surrounding whitespace", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: `  ${URL}  ` } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(URL);
  });

  it("cancels on Escape without committing", () => {
    const { onCommit, onCancel, input } = setup("https://keep.example.com");
    fireEvent.change(input, { target: { value: "https://discard.example.com" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits once when a paste is followed by a blur", () => {
    // Committing closes the pill, which unmounts the input — and removing a focused element
    // can fire blur on the way out, which would otherwise save (and PATCH) twice.
    const { onCommit, input } = setup();
    paste(input, URL);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("commits once when Escape is followed by a blur", () => {
    const { onCommit, onCancel, input } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("ignores an empty paste and leaves the default behaviour alone", () => {
    const { onCommit, input } = setup();
    paste(input, "");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("seeds the input with the current value and focuses it", () => {
    const { input } = setup(URL);
    expect(input.value).toBe(URL);
    expect(input).toHaveFocus();
  });
});
