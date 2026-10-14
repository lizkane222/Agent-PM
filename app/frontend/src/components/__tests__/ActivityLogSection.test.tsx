import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { resourceActivityResponse } from "../../test/handlers/realtime";
import ActivityLogSection from "../ActivityLogSection";
import { addLog, fetchSharedLogsForResource } from "../../lib/appLog";

function renderSection(resourceType: "action_item" | "account", resourceId: string | number) {
  return render(
    <MemoryRouter>
      <ActivityLogSection resourceType={resourceType} resourceId={resourceId} variant="inline" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("ActivityLogSection — shared action-item feed", () => {
  it("shows the empty state when nobody has logged anything", async () => {
    renderSection("action_item", "recItem1");
    expect(await screen.findByText("No activity recorded yet.")).toBeInTheDocument();
  });

  it("shows a teammate's edit, labelled with who made it", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/for-resource/", () =>
        HttpResponse.json(resourceActivityResponse([
          { title: '"Fix it" — Reassigned to Jane', actor_display: "Bob B", client_ts: 2000 },
        ])),
      ),
    );
    renderSection("action_item", "recItem1");
    expect(await screen.findByText('"Fix it" — Reassigned to Jane')).toBeInTheDocument();
    expect(screen.getByTestId("activity-actor")).toHaveTextContent("by Bob B");
  });

  it("requests the feed for this item only", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("/api/v1/realtime/activity/for-resource/", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ results: [] });
      }),
    );
    renderSection("action_item", "recItem1");
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen!.get("type")).toBe("action_item");
    expect(seen!.get("id")).toBe("recItem1");
  });

  it("keeps a new local entry and the teammate's entries together", async () => {
    server.use(
      http.get("/api/v1/realtime/activity/for-resource/", () =>
        HttpResponse.json(resourceActivityResponse([
          { title: "teammate entry", actor_display: "Bob B", client_ts: 1000 },
        ])),
      ),
    );
    renderSection("action_item", "recItem1");
    await screen.findByText("teammate entry");
    act(() => {
      addLog({ category: "action_item", message: "my entry", resource: { type: "action_item", id: "recItem1" } });
    });
    expect(await screen.findByText("my entry")).toBeInTheDocument();
    expect(screen.getByText("teammate entry")).toBeInTheDocument();
  });

  it("does not query the shared feed for non-action-item resources", async () => {
    let hit = false;
    server.use(
      http.get("/api/v1/realtime/activity/for-resource/", () => {
        hit = true;
        return HttpResponse.json({ results: [] });
      }),
    );
    renderSection("account", 5);
    await screen.findByText("No activity recorded yet.");
    await new Promise((r) => setTimeout(r, 20));
    expect(hit).toBe(false);
  });
});

describe("fetchSharedLogsForResource", () => {
  it("dedupes a local entry that the server also returns, keeping the actor", async () => {
    addLog({ category: "action_item", message: "mine", resource: { type: "action_item", id: "recX" } });
    const localId = JSON.parse(localStorage.getItem("appActivityLog")!)[0].id;
    server.use(
      http.get("/api/v1/realtime/activity/for-resource/", () =>
        HttpResponse.json(resourceActivityResponse([{ title: "mine", actor_display: "Me", client_id: localId }])),
      ),
    );
    const all = await fetchSharedLogsForResource("action_item", "recX");
    expect(all).toHaveLength(1);
    expect(all[0].actor).toBe("Me");
  });

  it("falls back to local entries when the request fails", async () => {
    addLog({ category: "action_item", message: "mine", resource: { type: "action_item", id: "recY" } });
    server.use(
      http.get("/api/v1/realtime/activity/for-resource/", () => new HttpResponse(null, { status: 500 })),
    );
    const all = await fetchSharedLogsForResource("action_item", "recY");
    expect(all.map((e) => e.message)).toEqual(["mine"]);
  });
});
