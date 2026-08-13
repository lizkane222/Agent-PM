import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../LoginPage";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../lib/auth", () => ({
  login: vi.fn(),
}));

import { login } from "../../lib/auth";
const mockLogin = vi.mocked(login);

// Default: Okta not enabled
function mockOidcStatus(enabled: boolean) {
  vi.spyOn(global, "fetch").mockResolvedValueOnce({
    json: async () => ({ okta_enabled: enabled }),
  } as Response);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders username, password fields and sign-in button", () => {
    mockOidcStatus(false);
    renderPage();
    expect(screen.getByLabelText(/username or email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("hides the Okta SSO link when okta_enabled is false", async () => {
    mockOidcStatus(false);
    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/v1/auth/oidc-status/"));
    expect(screen.queryByRole("link", { name: /sign in with okta sso/i })).not.toBeInTheDocument();
  });

  it("shows the Okta SSO link when okta_enabled is true", async () => {
    mockOidcStatus(true);
    renderPage();
    const oktaLink = await screen.findByRole("link", { name: /sign in with okta sso/i });
    expect(oktaLink).toHaveAttribute("href", "/oidc/authenticate/");
  });

  it("calls login() and navigates to / on successful submit", async () => {
    mockOidcStatus(false);
    mockLogin.mockResolvedValueOnce({ access: "tok", refresh: "ref" });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/username or email/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("alice", "secret"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("shows an error message on failed login", async () => {
    mockOidcStatus(false);
    mockLogin.mockRejectedValueOnce(new Error("401"));
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/username or email/i), {
      target: { value: "bad" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("disables the submit button while loading", async () => {
    mockOidcStatus(false);
    let resolve: (v: { access: string; refresh: string }) => void;
    mockLogin.mockReturnValueOnce(
      new Promise((r) => { resolve = r; })
    );
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/username or email/i), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled()
    );

    resolve!({ access: "tok", refresh: "ref" });
  });
});
