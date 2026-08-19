import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import {
  ACTION_ITEMS_UPDATED_KEY,
  isActionItemMutationUrl,
  notifyActionItemsChanged,
} from "../actionItemEvents";
import { apiClient } from "../api";

describe("isActionItemMutationUrl", () => {
  it("matches the action item routes on both apps", () => {
    expect(isActionItemMutationUrl("/airtable/action-items/")).toBe(true);
    expect(isActionItemMutationUrl("/airtable/action-items/12/")).toBe(true);
    expect(isActionItemMutationUrl("/airtable/action-items/recAAA/status/")).toBe(true);
    expect(isActionItemMutationUrl("/airtable/action-items/recAAA/fields/")).toBe(true);
    expect(isActionItemMutationUrl("/scheduler/action-items/3/")).toBe(true);
  });

  it("excludes nested attachment and step routes", () => {
    // These change an item's contents, not the item. Broadcasting on them would reload
    // every page on each checklist tick, remounting whatever modal is open.
    expect(isActionItemMutationUrl("/airtable/action-items/12/attachments/")).toBe(false);
    expect(isActionItemMutationUrl("/airtable/action-items/12/attachments/5/")).toBe(false);
    expect(isActionItemMutationUrl("/airtable/steps/")).toBe(false);
    expect(isActionItemMutationUrl("/airtable/steps/reorder/")).toBe(false);
  });

  it("excludes unrelated routes", () => {
    expect(isActionItemMutationUrl("/airtable/meetings/")).toBe(false);
    expect(isActionItemMutationUrl("/accounts/accounts/1/artifacts/")).toBe(false);
  });
});

describe("notifyActionItemsChanged", () => {
  beforeEach(() => localStorage.clear());

  it("writes the key so other tabs see it", () => {
    notifyActionItemsChanged();
    expect(localStorage.getItem(ACTION_ITEMS_UPDATED_KEY)).toBeTruthy();
  });

  it("dispatches an in-document storage event", () => {
    // localStorage.setItem never fires in the tab that wrote it, so the synthetic
    // dispatch is the only thing that reaches listeners on this page.
    const seen: (string | null)[] = [];
    const handler = (e: StorageEvent) => seen.push(e.key);
    window.addEventListener("storage", handler);
    try {
      notifyActionItemsChanged();
    } finally {
      window.removeEventListener("storage", handler);
    }
    expect(seen).toContain(ACTION_ITEMS_UPDATED_KEY);
  });
});

describe("api client broadcast interceptor", () => {
  let seen: number;
  const handler = (e: StorageEvent) => { if (e.key === ACTION_ITEMS_UPDATED_KEY) seen += 1; };

  beforeEach(() => {
    seen = 0;
    localStorage.clear();
    window.addEventListener("storage", handler);
    server.use(
      http.post("/api/v1/airtable/action-items/", () => HttpResponse.json({ id: 1 }, { status: 201 })),
      http.patch("/api/v1/airtable/action-items/:aid/fields/", () => HttpResponse.json({ id: 1 })),
      http.delete("/api/v1/airtable/action-items/:id/", () => new HttpResponse(null, { status: 204 })),
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([])),
      http.post("/api/v1/airtable/action-items/:id/attachments/", () => HttpResponse.json({ id: 9 }, { status: 201 })),
      http.post("/api/v1/airtable/steps/", () => HttpResponse.json({ id: 4 }, { status: 201 })),
      http.get("/api/v1/airtable/meetings/", () => HttpResponse.json({ results: [] })),
    );
  });

  afterEach(() => window.removeEventListener("storage", handler));

  it("broadcasts when an action item is created", async () => {
    // The bug: three creation paths never announced themselves, so an item made on
    // Account Detail never reached the Calendar sidebar.
    await apiClient.post("/airtable/action-items/", { task: "New" });
    expect(seen).toBe(1);
  });

  it("broadcasts when fields are patched", async () => {
    await apiClient.patch("/airtable/action-items/recAAA/fields/", { task: "Renamed" });
    expect(seen).toBe(1);
  });

  it("broadcasts when an action item is deleted", async () => {
    await apiClient.delete("/airtable/action-items/1/");
    expect(seen).toBe(1);
  });

  it("does not broadcast on a plain read", async () => {
    await apiClient.get("/airtable/action-items/", { noCache: true });
    expect(seen).toBe(0);
  });

  it("does not broadcast for attachment or step writes", async () => {
    await apiClient.post("/airtable/action-items/1/attachments/", { artifact_type: "link", name: "n", url: "u" });
    await apiClient.post("/airtable/steps/", { action_item: 1, title: "t", order: 0 });
    expect(seen).toBe(0);
  });

  it("does not broadcast for unrelated resources", async () => {
    await apiClient.get("/airtable/meetings/", { noCache: true });
    expect(seen).toBe(0);
  });
});
