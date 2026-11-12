import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAirtableAccount } from "../../../test/handlers/accounts";
import AccountsSidebar, { OPTION_GLOW_MS } from "../AccountsSidebar";

vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

const mockAdminAccount = { id: 999, company_name: "My Company", is_admin_account: true };

function registerHandlers() {
  server.use(
    http.get("/api/v1/accounts/admin-account/", () => HttpResponse.json(mockAdminAccount)),
    // Empty app-only account list so the merged list is just [admin, Acme Corp] — predictable for assertions.
    http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ results: [], count: 0 })),
    http.get("/api/v1/airtable/accounts/", () => HttpResponse.json({ results: [mockAirtableAccount] })),
  );
}

const baseProps = {
  open: true,
  onToggle: vi.fn(),
  eventAccountLinks: new Map(),
  onLink: vi.fn(),
  selectedAccountName: null as string | null,
  onSelectAccount: vi.fn(),
  logTimeModeAccount: null as string | null,
  onLogTimeMode: vi.fn(),
};

describe("AccountsSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerHandlers();
  });

  it("renders the Accounts toggle button and calls onToggle on click", () => {
    render(<AccountsSidebar {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Accounts/ }));
    expect(baseProps.onToggle).toHaveBeenCalled();
  });

  it("loads and renders the merged account list with the admin account pinned first", async () => {
    render(<AccountsSidebar {...baseProps} />);
    await waitFor(() => expect(screen.getByText("My Company")).toBeInTheDocument());
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("clicking an account calls onSelectAccount with its name", async () => {
    render(<AccountsSidebar {...baseProps} />);
    await waitFor(() => screen.getByText("Acme Corp"));
    fireEvent.click(screen.getByText("Acme Corp"));
    expect(baseProps.onSelectAccount).toHaveBeenCalledWith("Acme Corp");
  });

  it("Log Time button is disabled until an account is selected", async () => {
    render(<AccountsSidebar {...baseProps} />);
    await waitFor(() => screen.getByText("Acme Corp"));
    expect(screen.getByRole("button", { name: "Log Time to Salesforce" })).toBeDisabled();
  });

  it("Log Time button is enabled and calls onLogTimeMode when an account is selected", async () => {
    render(<AccountsSidebar {...baseProps} selectedAccountName="Acme Corp" />);
    await waitFor(() => screen.getByText("Acme Corp"));
    const logTimeBtn = screen.getByRole("button", { name: "Log Time to Salesforce" });
    expect(logTimeBtn).not.toBeDisabled();
    fireEvent.click(logTimeBtn);
    expect(baseProps.onLogTimeMode).toHaveBeenCalledWith("Acme Corp");
  });

  it("does not render the Unlinked view button when onShowUnlinkedView is not provided", async () => {
    render(<AccountsSidebar {...baseProps} />);
    await waitFor(() => screen.getByText("Acme Corp"));
    expect(screen.queryByRole("button", { name: /Unlinked Events \/ Accounts/ })).not.toBeInTheDocument();
  });

  it("renders the Unlinked view button and calls onShowUnlinkedView on click", async () => {
    const onShowUnlinkedView = vi.fn();
    render(<AccountsSidebar {...baseProps} onShowUnlinkedView={onShowUnlinkedView} unlinkedCount={3} />);
    await waitFor(() => screen.getByText("Acme Corp"));
    const unlinkedBtn = screen.getByRole("button", { name: /Unlinked Events \/ Accounts/ });
    fireEvent.click(unlinkedBtn);
    expect(onShowUnlinkedView).toHaveBeenCalled();
    expect(within(unlinkedBtn).getByText("3")).toBeInTheDocument();
  });

  it("hides the unlinked count badge when unlinkedCount is zero", async () => {
    render(<AccountsSidebar {...baseProps} onShowUnlinkedView={vi.fn()} unlinkedCount={0} />);
    await waitFor(() => screen.getByText("Acme Corp"));
    const unlinkedBtn = screen.getByRole("button", { name: /Unlinked Events \/ Accounts/ });
    expect(within(unlinkedBtn).queryByText("0")).not.toBeInTheDocument();
  });

  it("overLeftNav switches the overlay panel to fixed positioning for log-time mode", async () => {
    const { container } = render(<AccountsSidebar {...baseProps} overLeftNav />);
    await waitFor(() => screen.getByText("Acme Corp"));
    const panel = container.querySelector(".fixed.inset-y-0.left-0");
    expect(panel).not.toBeNull();
  });

  it("defaults to absolute positioning when overLeftNav is not set", async () => {
    const { container } = render(<AccountsSidebar {...baseProps} />);
    await waitFor(() => screen.getByText("Acme Corp"));
    const panel = container.querySelector(".absolute.top-0.left-0.h-full");
    expect(panel).not.toBeNull();
  });

  describe("recurring-meeting options", () => {
    const histBtn = () => screen.getByRole("checkbox", { name: "update historical" });
    const subseqBtn = () => screen.getByRole("checkbox", { name: "update subsequent recurring" });

    it("both buttons are off by default", () => {
      render(<AccountsSidebar {...baseProps} />);
      expect(histBtn()).toHaveAttribute("aria-checked", "false");
      expect(subseqBtn()).toHaveAttribute("aria-checked", "false");
    });

    it("reads as one line, ( ) historical ← recurring → future ( ), and the words toggle too", () => {
      const onHist = vi.fn();
      const onSub = vi.fn();
      render(<AccountsSidebar {...baseProps} onUpdateHistoricalChange={onHist} onUpdateSubsequentChange={onSub} />);
      const group = screen.getByRole("group", { name: "Recurring meetings" });
      expect(group.textContent).toBe("historical← recurring →future");
      fireEvent.click(within(group).getByText("historical"));
      fireEvent.click(within(group).getByText("future"));
      expect(onHist).toHaveBeenCalledWith(true);
      expect(onSub).toHaveBeenCalledWith(true);
    });

    it("each button reports the opposite of its current state when clicked", () => {
      const onHist = vi.fn();
      const onSub = vi.fn();
      const { rerender } = render(
        <AccountsSidebar {...baseProps} onUpdateHistoricalChange={onHist} onUpdateSubsequentChange={onSub} />,
      );
      fireEvent.click(histBtn());
      fireEvent.click(subseqBtn());
      expect(onHist).toHaveBeenCalledWith(true);
      expect(onSub).toHaveBeenCalledWith(true);

      rerender(
        <AccountsSidebar {...baseProps} updateHistorical updateSubsequent
          onUpdateHistoricalChange={onHist} onUpdateSubsequentChange={onSub} />,
      );
      expect(histBtn()).toHaveAttribute("aria-checked", "true");
      fireEvent.click(histBtn());
      expect(onHist).toHaveBeenLastCalledWith(false);
    });

    describe("glow", () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });

      it("both buttons glow when the sidebar opens, then stop after 2 seconds", () => {
        expect(OPTION_GLOW_MS).toBe(2000);
        render(<AccountsSidebar {...baseProps} />);
        expect(histBtn()).toHaveAttribute("data-glow", "true");
        expect(subseqBtn()).toHaveAttribute("data-glow", "true");
        act(() => { vi.advanceTimersByTime(OPTION_GLOW_MS - 1); });
        expect(histBtn()).toHaveAttribute("data-glow", "true");
        act(() => { vi.advanceTimersByTime(1); });
        expect(histBtn()).toHaveAttribute("data-glow", "false");
        expect(subseqBtn()).toHaveAttribute("data-glow", "false");
      });

      it("does not glow while the sidebar is closed, and glows again on the next open", () => {
        const { rerender } = render(<AccountsSidebar {...baseProps} open={false} />);
        expect(histBtn()).toHaveAttribute("data-glow", "false");
        rerender(<AccountsSidebar {...baseProps} open />);
        expect(histBtn()).toHaveAttribute("data-glow", "true");
        act(() => { vi.advanceTimersByTime(OPTION_GLOW_MS); });
        expect(histBtn()).toHaveAttribute("data-glow", "false");
        rerender(<AccountsSidebar {...baseProps} open={false} />);
        rerender(<AccountsSidebar {...baseProps} open />);
        expect(histBtn()).toHaveAttribute("data-glow", "true");
      });
    });
  });
});
