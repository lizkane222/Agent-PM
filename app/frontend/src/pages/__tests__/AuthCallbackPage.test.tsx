import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AuthCallbackPage, { readTokensFromHash } from "../AuthCallbackPage";
import { getAccessToken, getRefreshToken } from "../../lib/auth";

function renderAt(hash: string) {
  window.history.replaceState(null, "", `/auth/callback${hash}`);
  return render(
    <MemoryRouter initialEntries={["/auth/callback"]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AuthCallbackPage", () => {
  beforeEach(() => localStorage.clear());

  it("stores the token pair from the fragment and goes home", async () => {
    renderAt("#access=AAA&refresh=RRR");
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(getAccessToken()).toBe("AAA");
    expect(getRefreshToken()).toBe("RRR");
  });

  it("scrubs the tokens from the address bar", async () => {
    renderAt("#access=AAA&refresh=RRR");
    await screen.findByText("home");
    expect(window.location.hash).toBe("");
  });

  it("sends the user back to login with a fixed error when the fragment is missing", async () => {
    renderAt("");
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it("does not sign in on a half-formed fragment", async () => {
    renderAt("#access=AAA");
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it("parses the fragment", () => {
    expect(readTokensFromHash("#access=a&refresh=b")).toEqual({ access: "a", refresh: "b" });
    expect(readTokensFromHash("")).toBeNull();
  });
});
