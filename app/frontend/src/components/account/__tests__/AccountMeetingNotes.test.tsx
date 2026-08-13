import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockTeamMembers } from "../../../test/handlers/team";
import { AccountMeetingNotes } from "../AccountMeetingNotes";
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
  content: "Existing note",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderComponent(notes: AccountNote[] = []) {
  return render(
    <AccountMeetingNotes
      accountId={1}
      accountName="Acme Corp"
      notes={notes}
      teamMembers={mockTeamMembers}
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

describe("AccountMeetingNotes — @mention and @# reference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the draft textarea placeholder", () => {
    renderComponent();
    expect(screen.getByPlaceholderText(/Add a note/)).toBeInTheDocument();
  });

  it("renders existing notes", () => {
    renderComponent([mockNote]);
    expect(screen.getByText("Existing note")).toBeInTheDocument();
  });

  it("shows @mention dropdown when @ is typed", async () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() =>
      expect(screen.getByText("Alice Smith")).toBeInTheDocument()
    );
  });

  it("filters @mention results by query", async () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@bob" } });
    await waitFor(() =>
      expect(screen.getByText("Bob Jones")).toBeInTheDocument()
    );
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
  });

  it("hides dropdown when @ query contains a space", () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@alice " } });
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
  });

  it("inserts @Name token when a mention is clicked", async () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() => screen.getByText("Alice Smith"));
    fireEvent.mouseDown(screen.getByText("Alice Smith"));
    expect(textarea.value).toBe("@AliceSmith ");
  });

  it("closes @mention dropdown after Escape key", async () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() => screen.getByText("Alice Smith"));
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
  });

  it("shows @# ref dropdown after debounce", async () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@#acme" } });
    await waitFor(() =>
      expect(screen.getByText("Acme Corp")).toBeInTheDocument(),
      { timeout: 1500 }
    );
  });

  it("inserts [label](url) when a @# ref result is clicked", async () => {
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@#acme" } });
    await waitFor(() => screen.getByText("Acme Corp"), { timeout: 1500 });
    fireEvent.mouseDown(screen.getByText("Acme Corp"));
    expect(textarea.value).toBe("[Acme Corp](/accounts/1) ");
  });

  it("does not show @# ref dropdown before debounce fires", () => {
    // Immediately after typing — debounce hasn't elapsed, no dropdown yet
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@#acme" } });
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });

  it("shows no ref dropdown when search API fails", async () => {
    server.use(
      http.get("/api/v1/search/", () => new HttpResponse(null, { status: 500 }))
    );
    renderComponent();
    const textarea = screen.getByPlaceholderText(/Add a note/);
    fireEvent.change(textarea, { target: { value: "@#query" } });
    // Wait long enough for debounce + API call — dropdown should never appear
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });
});
