import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount } from "../../test/handlers/accounts";

global.ResizeObserver = class ResizeObserver { observe() {} unobserve() {} disconnect() {} };

vi.mock("../../lib/appLog", () => ({
  addLog: vi.fn(), fetchSharedLogsForResource: vi.fn(async () => []), getLogs: vi.fn(() => []),
  getLogsForResource: vi.fn(() => []), syncLogsFromBackend: vi.fn(), LOG_STORAGE_KEY: "app_log",
}));
vi.mock("../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  useRightClickComment: () => ({ onContextMenu: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../components/shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(() => <textarea data-testid="description-editor" />),
}));

const acct = (id: number, company_name: string) => ({ ...mockAccount, id, company_name, airtable_id: `rec${id}` });

function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname + l.search + l.hash}</span>; }

async function renderAt(url: string, accounts = [acct(1, "Acme Corp"), acct(2, "Autodesk")]) {
  const fetched: string[] = [];
  server.use(
    http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ count: accounts.length, next: null, previous: null, results: accounts })),
    http.get("/api/v1/accounts/admin-account/", () => new HttpResponse(null, { status: 404 })),
    http.get("/api/v1/accounts/accounts/:id/", ({ params }) => {
      fetched.push(String(params.id));
      const a = accounts.find((x) => String(x.id) === String(params.id));
      return a ? HttpResponse.json(a) : new HttpResponse(null, { status: 404 });
    }),
  );
  const { default: AccountDetailPage } = await import("../AccountDetailPage");
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/accounts/:id" element={<><AccountDetailPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
  return fetched;
}

describe("AccountDetailPage — name in the URL", () => {
  it("loads the account named by the slug and calls the API with its numeric id", async () => {
    const fetched = await renderAt("/accounts/autodesk");
    await waitFor(() => expect(fetched).toContain("2"));
    expect(fetched).not.toContain("autodesk");
    expect(screen.getByTestId("where").textContent).toBe("/accounts/autodesk");
  });

  it("redirects a numeric URL to the slug, keeping the query string and hash", async () => {
    await renderAt("/accounts/2?meeting=77&glow=1#notes");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/accounts/autodesk?meeting=77&glow=1#notes"));
  });

  it("leaves a numeric URL alone when the name is ambiguous", async () => {
    const fetched = await renderAt("/accounts/3", [acct(3, "Acme, Inc."), acct(4, "Acme Inc")]);
    await waitFor(() => expect(fetched).toContain("3"));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("where").textContent).toBe("/accounts/3");
  });

  it("shows not found for an ambiguous slug and for an unknown slug, without calling the account API", async () => {
    const fetched = await renderAt("/accounts/acmeinc", [acct(3, "Acme, Inc."), acct(4, "Acme Inc")]);
    expect(await screen.findByText("Account not found.")).toBeInTheDocument();
    expect(fetched).toEqual([]);
  });

  it("shows not found for an unknown slug", async () => {
    const fetched = await renderAt("/accounts/nosuchaccount");
    expect(await screen.findByText("Account not found.")).toBeInTheDocument();
    expect(fetched).toEqual([]);
  });
});
