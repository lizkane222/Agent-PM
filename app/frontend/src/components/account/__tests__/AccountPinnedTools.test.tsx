import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockPin } from "../../../test/handlers/discover";
import AccountPinnedTools from "../AccountPinnedTools";

const accountPin = { ...mockPin, id: 9, account: 1, account_name: "Acme Corp", pinned_by_username: "bob", can_remove: false };

describe("AccountPinnedTools", () => {
  it("asks for this account's pins and renders each as a new-tab favicon link", async () => {
    const seen: string[] = [];
    server.use(http.get("/api/v1/discover/pins/", ({ request }) => {
      seen.push(new URL(request.url).search);
      return HttpResponse.json([accountPin]);
    }));
    render(<AccountPinnedTools accountId={1} />);
    const link = (await screen.findByText("CRM Sync Tool")).closest("a") as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(screen.getByTestId("site-favicon")).toBeInTheDocument();
    expect(seen).toContain("?account=1");
  });

  it("shows no unpin control for someone else's pin, and one for my own", async () => {
    server.use(http.get("/api/v1/discover/pins/", () => HttpResponse.json([
      accountPin, { ...accountPin, id: 10, can_remove: true, applet: { ...accountPin.applet, id: 2, name: "Mine" } },
    ])));
    render(<AccountPinnedTools accountId={1} />);
    await screen.findByText("Mine");
    expect(screen.queryByRole("button", { name: "Unpin CRM Sync Tool" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unpin Mine" })).toBeInTheDocument();
  });

  it("unpin calls DELETE", async () => {
    let deleted = "";
    server.use(
      http.get("/api/v1/discover/pins/", () => HttpResponse.json([{ ...accountPin, can_remove: true }])),
      http.delete("/api/v1/discover/pins/:id/", ({ params }) => { deleted = String(params.id); return new HttpResponse(null, { status: 204 }); }),
    );
    render(<AccountPinnedTools accountId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unpin CRM Sync Tool" }));
    await waitFor(() => expect(deleted).toBe("9"));
  });

  it("empty and error states", async () => {
    const { unmount } = render(<AccountPinnedTools accountId={1} />);
    expect(await screen.findByText(/Nothing pinned/)).toBeInTheDocument();
    unmount();
    server.use(http.get("/api/v1/discover/pins/", () => HttpResponse.error()));
    render(<AccountPinnedTools accountId={2} />);
    expect(await screen.findByText(/Could not load pinned tools/)).toBeInTheDocument();
  });

  it("does not render a link for a non-http url", async () => {
    server.use(http.get("/api/v1/discover/pins/", () => HttpResponse.json([
      { ...accountPin, applet: { ...accountPin.applet, url: "javascript:alert(1)" } },
    ])));
    render(<AccountPinnedTools accountId={1} />);
    const name = await screen.findByText("CRM Sync Tool");
    expect(name.closest("a")).toBeNull();
    expect(screen.queryByTestId("site-favicon")).toBeNull();
  });
});
