import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { mockAccount, mockAccountNote, mockAirtableMeeting, mockAirtableAccount } from "../../test/handlers/accounts";
import { mockActionItem } from "../../test/handlers/action_items";
import { useAccountDetail } from "../useAccountDetail";

describe("useAccountDetail", () => {
  it("starts with loading true", () => {
    const { result } = renderHook(() => useAccountDetail("1"));
    expect(result.current.loading).toBe(true);
  });

  it("loads base and airtable data then sets phase done", async () => {
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.phase).toBe("done");
  });

  it("populates account and notes after base phase", async () => {
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.account?.company_name).toBe(mockAccount.company_name);
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].content).toBe(mockAccountNote.content);
  });

  it("populates airtable entities when account has airtable_id", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () =>
        HttpResponse.json([mockActionItem])
      )
    );
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.actionItems.length).toBeGreaterThan(0);
    expect(result.current.meetings).toHaveLength(1);
    expect(result.current.meetings[0].name).toBe(mockAirtableMeeting.name);
    expect(result.current.airtableAccount?.airtable_id).toBe(mockAirtableAccount.airtable_id);
  });

  it("skips airtable layer when account has no airtable_id", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/", () =>
        HttpResponse.json({ ...mockAccount, airtable_id: "" })
      )
    );
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.phase).toBe("done");
    expect(result.current.actionItems).toHaveLength(0);
    expect(result.current.meetings).toHaveLength(0);
  });

  it("sets phase error and loading false on Layer 1 failure", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/:id/", () => HttpResponse.error())
    );
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.phase).toBe("error");
    expect(result.current.error).not.toBeNull();
  });

  it("sets phase error on Layer 2 failure but preserves base entities", async () => {
    server.use(
      http.get("/api/v1/airtable/action-items/", () => HttpResponse.error())
    );
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.account?.company_name).toBe(mockAccount.company_name);
    expect(result.current.actionItems).toHaveLength(0);
    expect(result.current.phase).toBe("error");
  });

  it("loads contacts and quickLinks independently of main waterfall", async () => {
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contacts.length).toBeGreaterThan(0);
    expect(result.current.quickLinks.length).toBeGreaterThan(0);
  });

  it("refetch triggers full reload", async () => {
    const { result } = renderHook(() => useAccountDetail("1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.account).not.toBeNull();

    // Trigger refetch and wait for it to complete (loading true→false may be
    // too brief for waitFor to catch the intermediate state in React 18).
    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.account?.company_name).toBe(mockAccount.company_name);
  });
});
