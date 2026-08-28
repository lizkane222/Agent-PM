import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import type { TeamMember } from "../../types";

// ── Cross-cutting mocks (same pattern as ActionItemsPage.test.tsx) ─────────────

vi.mock("../../context/ExportContext", () => ({
  ExportProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useExport: () => ({
    exportMode: false,
    items: [],
    toggleMode: vi.fn(),
    toggleItem: vi.fn(),
    isSelected: vi.fn(() => false),
    clearItems: vi.fn(),
    count: 0,
  }),
}));

vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(),
  getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []),
}));

vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

// ── Mock data — more than the backend's default page size of 50 ────────────────

function makeMembers(count: number): TeamMember[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    user: null,
    full_name: `Member ${String(i).padStart(2, "0")}`,
    email: `member${i}@example.com`,
    title: "",
    department: "",
    tags: [],
    manager: null,
    manager_name: null,
    slack_handle: "",
    avatar_url: "",
    joined_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }));
}

const allMembers = makeMembers(60);

async function renderPage() {
  const { default: AccountsPage } = await import("../AccountsPage");
  render(
    <MemoryRouter>
      <AccountsPage />
    </MemoryRouter>
  );
}

describe("AccountsPage — team members sidebar", () => {
  it("requests a page_size large enough to avoid the backend's default 50-item page", async () => {
    // Mirrors the real ClientPageSizePagination behaviour: without a wide-enough
    // ?page_size=, only the first 50 of 60 members would come back.
    server.use(
      http.get("/api/v1/accounts/accounts/", () =>
        HttpResponse.json({ results: [], count: 0 })
      ),
      http.get("/api/v1/team/members/", ({ request }) => {
        const pageSize = Number(new URL(request.url).searchParams.get("page_size") ?? "50");
        const results = allMembers.slice(0, Math.min(pageSize, allMembers.length));
        return HttpResponse.json({ results, count: allMembers.length });
      })
    );

    await renderPage();

    fireEvent.click(screen.getByText("Team Members"));

    // Member 59 only appears if the request asked for more than the default 50.
    await waitFor(() => expect(screen.getByText("Member 59")).toBeInTheDocument());
    expect(screen.getByText("Member 00")).toBeInTheDocument();
  });
});
