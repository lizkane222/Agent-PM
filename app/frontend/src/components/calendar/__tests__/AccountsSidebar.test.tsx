import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockAirtableAccount } from "../../../test/handlers/accounts";
import AccountsSidebar from "../AccountsSidebar";

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
});
