import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContactNoteRow } from "../ContactNoteRow";
import type { CustomerContactNote } from "../../../types";

const note: CustomerContactNote = {
  id: 7,
  contact: 1,
  author: 1,
  author_display: "Alice",
  content: "Prefers email over Slack",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderRow(onSave = vi.fn()) {
  const onDelete = vi.fn();
  render(<ContactNoteRow note={note} onSave={onSave} onDelete={onDelete} />);
  fireEvent.click(screen.getByTitle("Edit"));
  return { onSave, onDelete, textarea: screen.getByRole("textbox") };
}

describe("ContactNoteRow — Enter saves the note", () => {
  it("saves on a bare Enter", async () => {
    const onSave = vi.fn();
    const { textarea } = renderRow(onSave);

    fireEvent.change(textarea, { target: { value: "Prefers Slack now" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "Prefers Slack now"));
  });

  it("does not save on Shift+Enter — that inserts a newline", async () => {
    const onSave = vi.fn();
    const { textarea } = renderRow(onSave);

    fireEvent.change(textarea, { target: { value: "First line" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("still saves when the Save button is clicked", async () => {
    const onSave = vi.fn();
    const { textarea } = renderRow(onSave);

    fireEvent.change(textarea, { target: { value: "Clicked instead" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "Clicked instead"));
  });

  it("Escape cancels without saving", async () => {
    const onSave = vi.fn();
    const { textarea } = renderRow(onSave);

    fireEvent.change(textarea, { target: { value: "Discard me" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Prefers email over Slack")).toBeInTheDocument();
  });

  it("Enter on unchanged text just closes the editor", async () => {
    const onSave = vi.fn();
    const { textarea } = renderRow(onSave);

    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Prefers email over Slack")).toBeInTheDocument());
    expect(onSave).not.toHaveBeenCalled();
  });
});
