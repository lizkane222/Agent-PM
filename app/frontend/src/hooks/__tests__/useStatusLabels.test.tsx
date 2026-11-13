import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockUserProfile } from "../../test/handlers/team";
import { CurrentUserProvider } from "../../context/CurrentUserContext";
import { useStatusLabels, seedStatusLabels } from "../useStatusLabels";

const ME_URL = "/api/v1/team/profiles/me/";

describe("useStatusLabels", () => {
  beforeEach(() => seedStatusLabels({}));

  it("defaults to the canonical names", () => {
    const { result } = renderHook(() => useStatusLabels());
    expect(result.current.label("Open")).toBe("Open");
    expect(result.current.label("Done")).toBe("Done");
  });

  it("seeds from the shared profile without an extra request per consumer", async () => {
    let gets = 0;
    server.use(http.get(ME_URL, () => { gets++; return HttpResponse.json({ ...mockUserProfile, status_labels: { Open: "Not Started" } }); }));
    const wrapper = ({ children }: { children: React.ReactNode }) => <CurrentUserProvider>{children}</CurrentUserProvider>;
    const a = renderHook(() => useStatusLabels(), { wrapper });
    await waitFor(() => expect(a.result.current.label("Open")).toBe("Not Started"));
    // A second consumer shares the same store.
    const b = renderHook(() => useStatusLabels());
    expect(b.result.current.label("Open")).toBe("Not Started");
    expect(gets).toBe(1);
  });

  it("applies locally and PATCHes the full map", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(http.patch(ME_URL, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...mockUserProfile, ...body });
    }));
    const { result } = renderHook(() => useStatusLabels());
    await act(async () => { await result.current.setLabel("Done", "Completed"); });
    expect(result.current.label("Done")).toBe("Completed");
    expect(body).toEqual({ status_labels: { Done: "Completed" } });
  });

  it("reverts and rethrows when the server rejects the change", async () => {
    server.use(http.patch(ME_URL, () => HttpResponse.json({ status_labels: ["bad"] }, { status: 400 })));
    const { result } = renderHook(() => useStatusLabels());
    let failed = false;
    await act(async () => { await result.current.setLabel("Open", "Not Started").catch(() => { failed = true; }); });
    expect(failed).toBe(true);
    expect(result.current.label("Open")).toBe("Open");
  });

  it("drops junk from a stored profile", () => {
    seedStatusLabels({ Open: "Done", Bogus: "x" } as never);
    const { result } = renderHook(() => useStatusLabels());
    expect(result.current.label("Open")).toBe("Open");
  });
});
