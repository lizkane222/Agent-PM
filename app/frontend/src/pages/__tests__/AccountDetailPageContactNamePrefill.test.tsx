import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  fetchSharedLogsForResource: vi.fn(async () => []),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
  syncLogsFromBackend: vi.fn(),
  LOG_STORAGE_KEY: "app_log",
}));
vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(() => <textarea />),
  plainToHtml: (t: string) => t,
}));

describe("AccountDetailPage add-contact modal: name guessed from email", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("pre-fills an editable name when the email is entered and the name is blank", async () => {
    const { default: AccountDetailPage } = await import("../AccountDetailPage");
    render(
      <MemoryRouter initialEntries={["/accounts/1"]}>
        <Routes><Route path="/accounts/:id" element={<AccountDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    const adds = await screen.findAllByText("+ Add");
    let email: HTMLElement | null = null;
    for (const b of adds) {
      fireEvent.click(b);
      email = document.querySelector('input[type="email"]');
      if (email) break;
    }
    expect(email).not.toBeNull();
    const nameInput = email!.closest("div")!.parentElement!.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput.value).toBe("");
    fireEvent.change(email!, { target: { value: "jane.doe@acme.com" } });
    fireEvent.blur(email!);
    await waitFor(() => expect(nameInput.value).toBe("Jane Doe"));
    // editable, and a typed name is never overwritten by a later blur
    fireEvent.change(nameInput, { target: { value: "Janet D" } });
    fireEvent.change(email!, { target: { value: "other.person@acme.com" } });
    fireEvent.blur(email!);
    expect(nameInput.value).toBe("Janet D");
  });
});
