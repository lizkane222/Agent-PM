import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { sensitiveMarksResponse } from "../../test/handlers/sensitive";
import {
  createSensitiveMark, getSensitiveMarks, invalidateSensitiveMarks, removeSensitiveMark,
  requestSensitiveMarks,
} from "../sensitiveStore";

const mark = { id: 5, field: "task", text: "secret", line_key: "" };
const wait = () => new Promise((r) => setTimeout(r, 400));

describe("sensitiveStore", () => {
  it("coalesces many registrations into one request per type", async () => {
    const urls: string[] = [];
    server.use(http.get("/api/v1/sensitive/marks/", ({ request }) => {
      urls.push(request.url);
      return HttpResponse.json({ results: { "1": [mark] } });
    }));
    requestSensitiveMarks("action_item", 1);
    requestSensitiveMarks("action_item", 2);
    requestSensitiveMarks("action_item", 2);
    requestSensitiveMarks("account_note", 9);
    await wait();
    expect(urls).toHaveLength(2);
    expect(urls.find((u) => u.includes("action_item"))).toMatch(/resource_ids=1(%2C|,)2/);
    expect(getSensitiveMarks("action_item", 1)).toEqual([mark]);
    expect(getSensitiveMarks("action_item", 2)).toEqual([]);
  });

  it("does not request local-* ids and does not re-request fresh entries", async () => {
    let hits = 0;
    // Count only requests that ask about id 3 (a request leaked from an earlier test must not count).
    server.use(http.get("/api/v1/sensitive/marks/", ({ request }) => {
      const ids = new URL(request.url).searchParams.get("resource_ids") ?? "";
      if (ids.split(",").includes("3")) hits++;
      if (ids.includes("local")) hits += 100;
      return HttpResponse.json({ results: {} });
    }));
    requestSensitiveMarks("action_item", "local-abc");
    requestSensitiveMarks("action_item", 3);
    await wait();
    requestSensitiveMarks("action_item", 3);
    await wait();
    expect(hits).toBe(1);
  });

  it("create applies locally and refetches; remove drops it", async () => {
    server.use(
      sensitiveMarksResponse({ "4": [mark] }),
      http.post("/api/v1/sensitive/marks/", () => HttpResponse.json(mark, { status: 201 })),
      http.delete("/api/v1/sensitive/marks/5/", () => new HttpResponse(null, { status: 204 })),
    );
    requestSensitiveMarks("action_item", 4);
    await wait();
    await removeSensitiveMark("action_item", 4, 5);
    expect(getSensitiveMarks("action_item", 4)).toEqual([]);
    await createSensitiveMark({ resourceType: "action_item", resourceId: 4, field: "task", text: "secret" });
    expect(getSensitiveMarks("action_item", 4)).toEqual([mark]);
    await wait();
    expect(getSensitiveMarks("action_item", 4)).toEqual([mark]);
  });

  it("invalidate keeps the old marks visible while refetching", async () => {
    server.use(sensitiveMarksResponse({ "4": [mark] }));
    requestSensitiveMarks("action_item", 4);
    await wait();
    invalidateSensitiveMarks("action_item", 4);
    expect(getSensitiveMarks("action_item", 4)).toEqual([mark]);
  });

  it("create rejects on a server error so callers can report it", async () => {
    server.use(http.post("/api/v1/sensitive/marks/", () => HttpResponse.json({ detail: "x" }, { status: 404 })));
    await expect(createSensitiveMark({ resourceType: "action_item", resourceId: 1, field: "task", text: "s" })).rejects.toBeTruthy();
  });
});
