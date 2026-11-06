import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import GlobalSearch from "../GlobalSearch";
import { ExportProvider, useExport } from "../../context/ExportContext";
import type { SearchResult } from "../../lib/api";

// Distinct titles and no account field, so a title is findable by text without ambiguity.
const RESULTS: SearchResult[] = [
  { type: "account", type_label: "Account", id: 1, title: "Alpha Account", detail: "Tech", account: "", meta: "", url: "/accounts/1", accent: "blue" },
  { type: "action_item", type_label: "Action Item", id: 2, title: "Beta follow-up", detail: "Open", account: "", meta: "", url: "/action-items/2", accent: "indigo" },
];

/** Shows what is in the tray so the test can read it back. */
function TrayProbe() {
  const { items, exportMode } = useExport();
  return <div data-testid="tray" data-open={String(exportMode)}>{items.map(i => i.id).join(",")}</div>;
}

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={["/profile"]}>
      <ExportProvider>
        <GlobalSearch />
        <TrayProbe />
        <Routes>
          <Route path="/profile" element={<div>profile page</div>} />
          <Route path="/edit-preview" element={<div>full builder</div>} />
        </Routes>
      </ExportProvider>
    </MemoryRouter>,
  );
}

async function openAndSearch() {
  act(() => { window.dispatchEvent(new CustomEvent("open-global-search")); });
  const input = await screen.findByPlaceholderText(/Search everything/i);
  fireEvent.change(input, { target: { value: "acme" } });
  await screen.findByText("Alpha Account");
}

const select = (title: string) => fireEvent.click(screen.getByText(title));
const tray = () => screen.getByTestId("tray");

beforeEach(() => {
  localStorage.clear();
  server.use(http.get("*/api/v1/search/", () => HttpResponse.json({ results: RESULTS })));
});

describe("GlobalSearch — add selected to the export tray", () => {
  it("offers no tray button until something is selected", async () => {
    renderSearch();
    await openAndSearch();
    expect(screen.queryByRole("button", { name: /to export tray/i })).toBeNull();
  });

  it("adds every selected result to the tray in one click, closes, and stays on the page", async () => {
    renderSearch();
    await openAndSearch();
    select("Alpha Account");
    select("Beta follow-up");
    fireEvent.click(await screen.findByRole("button", { name: "Add 2 to export tray" }));

    await waitFor(() => expect(tray().textContent).toBe("account:1,action_item:2"));
    expect(tray().getAttribute("data-open")).toBe("true");
    expect(screen.queryByPlaceholderText(/Search everything/i)).toBeNull(); // modal closed
    expect(screen.getByText("profile page")).toBeInTheDocument();           // did not navigate
  });

  it("adds only the selected results", async () => {
    renderSearch();
    await openAndSearch();
    select("Beta follow-up");
    fireEvent.click(await screen.findByRole("button", { name: "Add 1 to export tray" }));
    await waitFor(() => expect(tray().textContent).toBe("action_item:2"));
  });

  it("does not remove an item that is already in the tray", async () => {
    localStorage.setItem("agentpm_export_tray", JSON.stringify([{
      id: "account:1", type: "account", label: "Alpha Account", summary: "", content: "Alpha Account",
    }]));
    renderSearch();
    await openAndSearch();
    select("Alpha Account");
    select("Beta follow-up");
    fireEvent.click(await screen.findByRole("button", { name: "Add 2 to export tray" }));
    // toggleItem would drop account:1; the guard keeps it and adds only the new one.
    await waitFor(() => expect(tray().textContent).toBe("account:1,action_item:2"));
  });

  it("clears the selection so reopening search does not offer the button again", async () => {
    renderSearch();
    await openAndSearch();
    select("Alpha Account");
    fireEvent.click(await screen.findByRole("button", { name: "Add 1 to export tray" }));
    act(() => { window.dispatchEvent(new CustomEvent("open-global-search")); });
    await screen.findByPlaceholderText(/Search everything/i);
    expect(screen.queryByRole("button", { name: /to export tray/i })).toBeNull();
  });

  it("'Export to Layouts' still adds the selection and goes to the full builder", async () => {
    renderSearch();
    await openAndSearch();
    select("Alpha Account");
    fireEvent.click(await screen.findByRole("button", { name: /Export to Layouts/i }));
    expect(await screen.findByText("full builder")).toBeInTheDocument();
    expect(tray().textContent).toBe("account:1");
  });

});
