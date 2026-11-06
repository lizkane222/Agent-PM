import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { activityLogResponse } from "../../../test/handlers/accounts";
import AccountActivityLog from "../AccountActivityLog";

const row = (category: string, title: string) => ({
  id: `${category}-1`, category, ts: "2026-11-03T10:00:00Z", title, body: "", link: "/reminders", actor: "", status: "sent",
});

beforeEach(() => localStorage.clear());

function renderLog() {
  return render(<MemoryRouter><AccountActivityLog accountId={5} /></MemoryRouter>);
}

describe("AccountActivityLog", () => {
  it("shows all seven category tabs with counts", async () => {
    server.use(http.get("/api/v1/accounts/accounts/5/activity-log/", () =>
      HttpResponse.json(activityLogResponse([row("notifications", "N1"), row("notifications", "N2"), row("tokens", "T")]))));
    renderLog();
    for (const label of ["Activity", "Events", "Comments", "Notifications", "Reminders", "Feedback", "Tokens"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByTestId("count-notifications")).toHaveTextContent("2"));
    expect(screen.getByTestId("count-tokens")).toHaveTextContent("1");
  });

  it("requests and lists one category when its tab is opened", async () => {
    const seen: (string | null)[] = [];
    server.use(http.get("/api/v1/accounts/accounts/5/activity-log/", ({ request }) => {
      const c = new URL(request.url).searchParams.get("category");
      seen.push(c);
      return HttpResponse.json(activityLogResponse(c === "notifications" ? [row("notifications", "Notes imported")] : []));
    }));
    renderLog();
    fireEvent.click(screen.getByRole("tab", { name: /Notifications/ }));
    expect(await screen.findByText("Notes imported")).toBeInTheDocument();
    expect(seen).toContain("notifications");
  });

  it("shows an empty state and an error state", async () => {
    renderLog();
    fireEvent.click(screen.getByRole("tab", { name: /Reminders/ }));
    expect(await screen.findByText("Nothing recorded yet.")).toBeInTheDocument();
    server.use(http.get("/api/v1/accounts/accounts/5/activity-log/", () => new HttpResponse(null, { status: 500 })));
    fireEvent.click(screen.getByRole("tab", { name: /Feedback/ }));
    expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
  });

  it("keeps the existing local activity list on the Activity tab", async () => {
    renderLog();
    expect(await screen.findByText("No activity recorded yet.")).toBeInTheDocument();
  });
});
