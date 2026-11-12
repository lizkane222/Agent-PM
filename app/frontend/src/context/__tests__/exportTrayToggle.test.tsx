import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";
import { ExportProvider, useExport, type ExportItem } from "../ExportContext";
import { useExportTray } from "../../hooks/useExportTray";
import ExportBar from "../../components/ExportBar";
import type { AirtableActionItem } from "../../types";

/**
 * These run against the REAL ExportProvider on purpose. The pre-existing
 * useExportTray test mocks `useExport`, which hides the thing that actually
 * matters: what `toggleMode` does to the collected items.
 */

const item: ExportItem = {
  id: "account:1", type: "account", label: "Acme", summary: "", content: "Acme",
};

function Harness() {
  const { exportMode, items, toggleMode, toggleItem } = useExport();
  return (
    <div>
      <button onClick={toggleMode}>toggle</button>
      <button onClick={() => toggleItem(item)}>add</button>
      <span data-testid="mode">{String(exportMode)}</span>
      <span data-testid="count">{items.length}</span>
    </div>
  );
}

const actionItem = { airtable_id: "recX", task: "T", status: "Open", priority: "High" } as AirtableActionItem;

function TrayHarness() {
  const { addToTray } = useExportTray();
  const { items, exportMode } = useExport();
  return (
    <div>
      <button onClick={() => addToTray(actionItem)}>addViaHook</button>
      <span data-testid="mode">{String(exportMode)}</span>
      <span data-testid="count">{items.length}</span>
    </div>
  );
}

describe("export tray toggle", () => {
  beforeEach(() => localStorage.clear());

  it("closing the tray keeps the collected items", () => {
    render(<ExportProvider><Harness /></ExportProvider>);

    fireEvent.click(screen.getByText("add"));
    expect(screen.getByTestId("count").textContent).toBe("1");

    // open, then close
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));

    // Closing is not discarding — Clear is the only thing that empties the tray.
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("toggles the mode flag both ways", () => {
    render(<ExportProvider><Harness /></ExportProvider>);
    const mode = screen.getByTestId("mode");

    expect(mode.textContent).toBe("false");
    fireEvent.click(screen.getByText("toggle"));
    expect(mode.textContent).toBe("true");
    fireEvent.click(screen.getByText("toggle"));
    expect(mode.textContent).toBe("false");
    fireEvent.click(screen.getByText("toggle"));
    expect(mode.textContent).toBe("true");
  });

  it("adding an item opens the tray so it can't land somewhere invisible", () => {
    render(<ExportProvider><Harness /></ExportProvider>);

    fireEvent.click(screen.getByText("add"));

    expect(screen.getByTestId("mode").textContent).toBe("true");
  });

  /**
   * The tray used to render on `items.length > 0` and ignore `exportMode`
   * entirely, so the flag the sidebar button toggles and the tray's visibility
   * were two disconnected truths: opening an empty tray showed nothing, and
   * closing a full one couldn't hide it.
   */
  describe("tray visibility follows the toggle", () => {
    function renderTray() {
      return render(
        <MemoryRouter>
          <ExportProvider>
            <Harness />
            <ExportBar />
          </ExportProvider>
        </MemoryRouter>
      );
    }

    it("shows an empty tray when opened with nothing collected", () => {
      renderTray();
      expect(screen.queryByText(/items in export tray/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("toggle"));

      // Something must appear, or the button looks broken when the tray is empty.
      expect(screen.getByText(/items in export tray/i)).toBeInTheDocument();
      expect(screen.getByText(/Select records anywhere in the app/i)).toBeInTheDocument();
    });

    it("hides the tray on close even while it still holds items", () => {
      renderTray();
      fireEvent.click(screen.getByText("add"));
      expect(screen.getByText(/items in export tray/i)).toBeInTheDocument();

      fireEvent.click(screen.getByText("toggle"));

      expect(screen.queryByText(/items in export tray/i)).not.toBeInTheDocument();
      // ...and reopening brings the same item back.
      fireEvent.click(screen.getByText("toggle"));
      expect(screen.getByTestId("count").textContent).toBe("1");
    });

    it("offers Send and Clear only when there is something to act on", () => {
      renderTray();
      fireEvent.click(screen.getByText("toggle"));
      expect(screen.queryByText("Send to Chat")).not.toBeInTheDocument();
      expect(screen.queryByText("Clear")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("add"));
      expect(screen.getByText("Send to Chat")).toBeInTheDocument();
      expect(screen.getByText("Clear")).toBeInTheDocument();
    });

    it("closes from the tray's own ✕ without discarding anything", () => {
      renderTray();
      fireEvent.click(screen.getByText("add"));

      fireEvent.click(screen.getByRole("button", { name: /close export tray/i }));

      expect(screen.queryByText(/items in export tray/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("count").textContent).toBe("1");
    });

    it("keeps the tray open after Clear so more can be collected", () => {
      renderTray();
      fireEvent.click(screen.getByText("add"));

      fireEvent.click(screen.getByText("Clear"));

      expect(screen.getByTestId("count").textContent).toBe("0");
      expect(screen.getByText(/items in export tray/i)).toBeInTheDocument();
    });
  });

  describe("open/closed state persists", () => {
    it("a tray the user closed stays closed after a remount, items kept", () => {
      const first = render(<ExportProvider><Harness /></ExportProvider>);
      fireEvent.click(screen.getByText("add"));
      fireEvent.click(screen.getByText("toggle")); // close
      first.unmount();

      render(<ExportProvider><Harness /></ExportProvider>);
      expect(screen.getByTestId("mode").textContent).toBe("false");
      expect(screen.getByTestId("count").textContent).toBe("1");
    });

    it("a tray the user opened (even empty) stays open after a remount", () => {
      const first = render(<ExportProvider><Harness /></ExportProvider>);
      fireEvent.click(screen.getByText("toggle"));
      first.unmount();

      render(<ExportProvider><Harness /></ExportProvider>);
      expect(screen.getByTestId("mode").textContent).toBe("true");
    });

    it("survives a route change inside the router", () => {
      render(
        <MemoryRouter initialEntries={["/a"]}>
          <ExportProvider>
            <Harness />
            <Routes>
              <Route path="/a" element={<Link to="/b">go</Link>} />
              <Route path="/b" element={<span>page b</span>} />
            </Routes>
          </ExportProvider>
        </MemoryRouter>
      );
      fireEvent.click(screen.getByText("toggle"));
      fireEvent.click(screen.getByText("go"));
      expect(screen.getByText("page b")).toBeInTheDocument();
      expect(screen.getByTestId("mode").textContent).toBe("true");
    });

    it("with nothing stored, defaults to open only when items exist", () => {
      localStorage.setItem("agentpm_export_tray", JSON.stringify([item]));
      render(<ExportProvider><Harness /></ExportProvider>);
      expect(screen.getByTestId("mode").textContent).toBe("true");
    });

    it("an explicitly closed state wins over stored items", () => {
      localStorage.setItem("agentpm_export_tray", JSON.stringify([item]));
      localStorage.setItem("agentpm_export_tray_open", "0");
      render(<ExportProvider><Harness /></ExportProvider>);
      expect(screen.getByTestId("mode").textContent).toBe("false");
    });
  });

  describe("Send to Voice Session", () => {
    beforeEach(() => {
      server.use(http.post("*/api/v1/skills/voice-launch/", async ({ request }) => {
        const b = (await request.json()) as { text: string };
        return HttpResponse.json({ key: "k1", script: b.text });
      }));
    });
    it("announces a voice-launch built from the tray items", async () => {
      localStorage.setItem("agentpm_export_tray", JSON.stringify([item]));
      const got: Event[] = [];
      const on = (e: Event) => { got.push(e); e.preventDefault(); };
      window.addEventListener("voice-launch", on);
      try {
        render(<MemoryRouter><ExportProvider><ExportBar /></ExportProvider></MemoryRouter>);
        fireEvent.click(screen.getByText("Send to Voice Session"));
        await waitFor(() => expect(got).toHaveLength(1));
        const detail = (got[0] as CustomEvent).detail;
        expect(detail.script).toContain("Acme");
      } finally { window.removeEventListener("voice-launch", on); }
    });

    it("says so when no voice session picked it up", async () => {
      localStorage.setItem("agentpm_export_tray", JSON.stringify([item]));
      render(<MemoryRouter><ExportProvider><ExportBar /></ExportProvider></MemoryRouter>);
      fireEvent.click(screen.getByText("Send to Voice Session"));
      expect(await screen.findByRole("status")).toHaveTextContent(/Voice isn't available/i);
    });
  });

  describe("useExportTray auto-close", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("does not auto-close a tray the user opened themselves", () => {
      render(<ExportProvider><Harness /><TrayHarness /></ExportProvider>);
      fireEvent.click(screen.getByText("toggle")); // user opens
      fireEvent.click(screen.getByText("addViaHook"));
      act(() => { vi.advanceTimersByTime(6000); });
      expect(screen.getAllByTestId("mode")[0].textContent).toBe("true");
    });

    it("does not discard the tray when it auto-closes", () => {
      render(<ExportProvider><TrayHarness /></ExportProvider>);

      fireEvent.click(screen.getByText("addViaHook"));
      expect(screen.getByTestId("count").textContent).toBe("1");

      act(() => { vi.advanceTimersByTime(6000); });

      // The auto-close is a UI convenience; it must not destroy the user's picks.
      expect(screen.getByTestId("count").textContent).toBe("1");
    });
  });
});
