import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import Layout from "../Layout";
import { FeedbackProvider } from "../../context/FeedbackContext";
import { ExportProvider } from "../../context/ExportContext";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { CurrentUserProvider } from "../../context/CurrentUserContext";

// Sidebar icons are SVG imports (`?react`), which the test transform cannot do.
vi.mock("../../assets/icons/Calendar.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Conversation.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Team.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Checklist.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Settings.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Notification.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Code.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Schedule.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Innovation.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Structure.svg?react", () => ({ default: () => null }));

beforeEach(() => {
  localStorage.removeItem("agentpm-nav-accounts-open");
  // Layout also asks for lifetime token counts; answer with zero so nothing is unhandled.
  server.use(
    http.get("*/api/v1/agents/sessions/token-stats/", () => HttpResponse.json({ total_tokens: 0 })),
    http.get("*/api/v1/skills/skills/token-stats/", () => HttpResponse.json({ total_tokens: 0 })),
  );
  // Layout's theme hook reads prefers-color-scheme; jsdom has no matchMedia.
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
});

function Where() { return <span data-testid="where">{useLocation().pathname}</span>; }

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/accounts"]}>
      <AppErrorProvider>
        <CurrentUserProvider>
          <FeedbackProvider>
            <ExportProvider>
              <Layout /><Where />
            </ExportProvider>
          </FeedbackProvider>
        </CurrentUserProvider>
      </AppErrorProvider>
    </MemoryRouter>,
  );
}


const acct = (id: number, name: string, extra: object = {}) => ({
  id, company_name: name, status: "active", is_admin_account: false, ...extra,
});
function mockAccounts(n: number) {
  server.use(
    http.get("*/api/v1/accounts/accounts/", () => HttpResponse.json({
      count: n, next: null, previous: null,
      results: Array.from({ length: n }, (_, i) => acct(i + 10, `Customer ${i + 1}`)),
    })),
    http.get("*/api/v1/accounts/admin-account/", () => HttpResponse.json(acct(1, "Admin", { is_admin_account: true }))),
  );
}

describe("sidebar accounts list", () => {
  it("keeps Team outside the scrolling nav, with a bounded accounts list", async () => {
    mockAccounts(40);
    renderLayout();
    await screen.findByText("Customer 1");
    const nav = document.querySelector("aside nav") as HTMLElement;
    expect(nav.querySelector('a[href="/team"]')).toBeNull();
    expect(document.querySelector('aside a[href="/team"]')).not.toBeNull();
    const list = screen.getByText("Customer 1").closest("div.space-y-0\\.5") as HTMLElement;
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.maxHeight).not.toBe("");
  });

  it("hides every account with the arrow and shows the count while hidden", async () => {
    mockAccounts(12);
    renderLayout();
    await screen.findByText("Customer 1");
    fireEvent.click(screen.getByRole("button", { name: "Collapse accounts" }));
    expect(screen.queryByText("Customer 1")).toBeNull();
    expect(screen.getByTestId("accounts-count").textContent).toBe("(13)");
    const btn = screen.getByRole("button", { name: "Expand accounts" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(await screen.findByText("Customer 1")).toBeInTheDocument();
    expect(screen.queryByTestId("accounts-count")).toBeNull();
  });

  it("still navigates when the Accounts label is clicked", async () => {
    mockAccounts(3);
    renderLayout();
    await screen.findByText("Customer 1");
    fireEvent.click(screen.getByRole("button", { name: "Collapse accounts" }));
    expect(screen.getByTestId("where").textContent).toBe("/accounts"); // arrow click did not navigate away
    fireEvent.click(screen.getByText("Team"));
    expect(screen.getByTestId("where").textContent).toBe("/team");
    fireEvent.click(screen.getByText("Accounts"));
    expect(screen.getByTestId("where").textContent).toBe("/accounts");
  });

  it("remembers the collapsed state", async () => {
    mockAccounts(3);
    const first = renderLayout();
    await screen.findByText("Customer 1");
    fireEvent.click(screen.getByRole("button", { name: "Collapse accounts" }));
    expect(localStorage.getItem("agentpm-nav-accounts-open")).toBe("0");
    first.unmount();
    renderLayout();
    await screen.findByRole("button", { name: "Expand accounts" });
    expect(screen.queryByText("Customer 1")).toBeNull();
  });
});
