import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockTeamMembers } from "../../../test/handlers/team";
import { AccountNoteRow } from "../AccountNoteRow";
import type { AccountNote } from "../../../types";

vi.mock("../../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockNote: AccountNote = {
  id: 1,
  account: 1,
  author: null,
  author_username: null,
  author_display: "",
  content: "Original note content",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderRow(note = mockNote) {
  return render(
    <ul>
      <AccountNoteRow
        note={note}
        accountId={1}
        accountName="Acme Corp"
        teamMembers={mockTeamMembers}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    </ul>
  );
}

describe("AccountNoteRow — @mention and @# reference while editing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders note content in read mode", () => {
    renderRow();
    expect(screen.getByText("Original note content")).toBeInTheDocument();
  });

  it("enters edit mode on click", () => {
    renderRow();
    fireEvent.click(screen.getByText("Original note content"));
    expect(screen.getByDisplayValue("Original note content")).toBeInTheDocument();
  });

  it("shows @mention dropdown when @ is typed in edit mode", async () => {
    renderRow();
    fireEvent.click(screen.getByText("Original note content"));
    const textarea = screen.getByDisplayValue("Original note content");
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() =>
      expect(screen.getByText("Alice Smith")).toBeInTheDocument()
    );
  });

  it("inserts @Name token when a mention is clicked in edit mode", async () => {
    renderRow();
    fireEvent.click(screen.getByText("Original note content"));
    const textarea = screen.getByDisplayValue("Original note content") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "See @" } });
    await waitFor(() => screen.getByText("Alice Smith"));
    fireEvent.mouseDown(screen.getByText("Alice Smith"));
    expect(textarea.value).toBe("See @AliceSmith ");
  });

  it("shows @# ref dropdown after debounce in edit mode", async () => {
    renderRow();
    fireEvent.click(screen.getByText("Original note content"));
    const textarea = screen.getByDisplayValue("Original note content");
    fireEvent.change(textarea, { target: { value: "See @#finish" } });
    await waitFor(() =>
      expect(screen.getByText("Finish Q3 review")).toBeInTheDocument(),
      { timeout: 1500 }
    );
  });

  it("inserts [label](url) when a @# ref result is clicked in edit mode", async () => {
    renderRow();
    fireEvent.click(screen.getByText("Original note content"));
    const textarea = screen.getByDisplayValue("Original note content") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "See @#acme" } });
    await waitFor(() => screen.getByText("Acme Corp"), { timeout: 1500 });
    fireEvent.mouseDown(screen.getByText("Acme Corp"));
    expect(textarea.value).toBe("See [Acme Corp](/accounts/1) ");
  });

  it("closes @mention dropdown on Escape in edit mode", async () => {
    renderRow();
    fireEvent.click(screen.getByText("Original note content"));
    const textarea = screen.getByDisplayValue("Original note content");
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() => screen.getByText("Alice Smith"));
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
  });
});
