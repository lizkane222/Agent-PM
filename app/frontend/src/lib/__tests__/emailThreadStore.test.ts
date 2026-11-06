import { describe, it, expect } from "vitest";
import { getLoadedThreads, saveLoadedThreads, patchLoadedThread, trimForStorage, EMAIL_THREADS_KEY, resetEmailThreads } from "../emailThreadStore";
import type { GmailThread } from "../api";

const t = (id: string): GmailThread => ({ id, subject: "s", participants: [], message_count: 1, last_date: "", snippet: "", messages: [], summary: "", status: "", status_color: "gray", next_action: "" });

describe("emailThreadStore", () => {
  it("keeps threads per account with a stamp and persists them", () => {
    saveLoadedThreads(1, [t("a")], 111);
    saveLoadedThreads(2, [t("b")], 222);
    expect(getLoadedThreads(1)).toEqual({ threads: [t("a")], loadedAt: 111 });
    expect(getLoadedThreads(2)?.threads[0].id).toBe("b");
    expect(JSON.parse(localStorage.getItem(EMAIL_THREADS_KEY)!)["1"].loadedAt).toBe(111);
  });
  it("patches one thread and keeps the stamp", () => {
    saveLoadedThreads(1, [t("a")], 5);
    patchLoadedThread(1, "a", { summary: "new" });
    expect(getLoadedThreads(1)?.threads[0].summary).toBe("new");
    expect(getLoadedThreads(1)?.loadedAt).toBe(5);
  });
  it("reset clears memory and disk", () => {
    saveLoadedThreads(1, [t("a")]);
    resetEmailThreads();
    expect(getLoadedThreads(1)).toBeUndefined();
  });
  it("trims oldest accounts first when over budget", () => {
    const map = { "1": { threads: [t("a")], loadedAt: 1 }, "2": { threads: [t("b")], loadedAt: 2 } };
    const one = JSON.stringify(map["2"]).length + 10;
    expect(Object.keys(trimForStorage(map, one + 5))).toEqual(["2"]);
  });
});
