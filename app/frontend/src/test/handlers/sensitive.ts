import { http, HttpResponse } from "msw";
import type { SensitiveMark, SensitiveMarksResponse } from "../../types/sensitive";

export const mockSensitiveMark: SensitiveMark = { id: 1, field: "task", text: "", line_key: "" };

/**
 * Default handler: no record has any hidden text, so <SensitiveText> renders exactly the
 * same markup as before it existed and every page test's network stays quiet.
 */
export const sensitiveHandlers = [
  http.get("/api/v1/sensitive/marks/", () => HttpResponse.json<SensitiveMarksResponse>({ results: {} })),
];

/** Override helper: `server.use(sensitiveMarksResponse({ "7": [mark] }))`. */
export function sensitiveMarksResponse(results: Record<string, SensitiveMark[]>) {
  return http.get("/api/v1/sensitive/marks/", ({ request }) => {
    const ids = (new URL(request.url).searchParams.get("resource_ids") ?? "").split(",");
    const out: Record<string, SensitiveMark[]> = {};
    for (const id of ids) if (results[id]) out[id] = results[id];
    return HttpResponse.json<SensitiveMarksResponse>({ results: out });
  });
}
