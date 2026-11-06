import { describe, it, expect } from "vitest";
import type { AccountArtifact } from "../../types/accounts";
import {
  DEFAULT_ARTIFACT_BROWSE, availableTypes, browseArtifacts, fileTypeOf, linkTypeOf, matchesQuery, sortArtifacts, typeKey,
} from "../artifactBrowse";

const mk = (o: Partial<AccountArtifact>): AccountArtifact => ({
  id: 1, account: 1, artifact_type: "link", name: "x", url: null, secondary_url: "", icon_key: "",
  file_url: null, image_url: null, mime_type: "", file_size: null, description: "", references: [], used_in: [],
  uploaded_by: null, uploaded_by_username: null, created_at: "2026-01-01T00:00:00Z", updated_at: "", ...o,
});
const A = mk({ id: 1, name: "Zeta deck", artifact_type: "file", mime_type: "application/pdf", uploaded_by_username: "bob", created_at: "2026-03-01T00:00:00Z" });
const B = mk({ id: 2, name: "alpha doc", url: "https://www.notion.so/x", uploaded_by_username: "alice", created_at: "2026-01-01T00:00:00Z", description: "<p>Quarterly <b>plan</b></p>" });
const C = mk({ id: 3, name: "Beta img", artifact_type: "file", mime_type: "image/png", uploaded_by_username: "alice", created_at: "2026-02-01T00:00:00Z" });
const D = mk({ id: 4, name: "Notes", url: "https://docs.google.com/d", icon_key: "", uploaded_by_username: null, created_at: "2026-04-01T00:00:00Z" });
const ALL = [A, B, C, D];
const names = (xs: AccountArtifact[]) => xs.map((x) => x.name);

describe("artifactBrowse", () => {
  it("classifies file and link types", () => {
    expect(fileTypeOf(A)).toBe("PDF");
    expect(fileTypeOf(C)).toBe("Image");
    expect(fileTypeOf(mk({ artifact_type: "file", name: "a.xlsx", mime_type: "application/octet-stream" }))).toBe("Spreadsheet");
    expect(fileTypeOf(mk({ artifact_type: "file", name: "a.bin" }))).toBe("Other");
    expect(fileTypeOf(B)).toBe("");
    expect(linkTypeOf(B)).toBe("notion.so");
    expect(linkTypeOf(mk({ icon_key: "lucidchart", url: "https://lucid.app/x" }))).toBe("lucidchart");
    expect(linkTypeOf(A)).toBe("");
    expect(typeKey(A)).toBe("file:PDF");
  });

  it("searches name, creator, description (HTML stripped) and url", () => {
    expect(matchesQuery(B, "ALPHA")).toBe(true);
    expect(matchesQuery(A, "bob")).toBe(true);
    expect(matchesQuery(B, "quarterly plan")).toBe(true);
    expect(matchesQuery(B, "<b>")).toBe(false);
    expect(matchesQuery(D, "docs.google")).toBe(true);
    expect(matchesQuery(A, "nomatch")).toBe(false);
    expect(matchesQuery(A, "   ")).toBe(true);
  });

  it("sorts every way", () => {
    expect(names(sortArtifacts(ALL, "name_asc"))).toEqual(["alpha doc", "Beta img", "Notes", "Zeta deck"]);
    expect(names(sortArtifacts(ALL, "name_desc"))).toEqual(["Zeta deck", "Notes", "Beta img", "alpha doc"]);
    expect(names(sortArtifacts(ALL, "created_desc"))).toEqual(["Notes", "Zeta deck", "Beta img", "alpha doc"]);
    expect(names(sortArtifacts(ALL, "created_asc"))).toEqual(["alpha doc", "Beta img", "Zeta deck", "Notes"]);
    // creator: alice (alpha, Beta) then bob, empty creator last
    expect(names(sortArtifacts(ALL, "creator"))).toEqual(["alpha doc", "Beta img", "Zeta deck", "Notes"]);
    // file type: Image, PDF, then links (no file type) by name
    expect(names(sortArtifacts(ALL, "file_type"))).toEqual(["Beta img", "Zeta deck", "alpha doc", "Notes"]);
    // link type: docs.google.com, notion.so, files last
    expect(names(sortArtifacts(ALL, "link_type"))).toEqual(["Notes", "alpha doc", "Beta img", "Zeta deck"]);
  });

  it("does not mutate its input", () => {
    const copy = [...ALL];
    sortArtifacts(ALL, "name_asc");
    expect(ALL).toEqual(copy);
  });

  it("groups by file type, link type and creator", () => {
    const g = (groupBy: "file_type" | "link_type" | "creator") =>
      browseArtifacts(ALL, { ...DEFAULT_ARTIFACT_BROWSE, groupBy, sort: "name_asc" }).map((x) => [x.label, names(x.items)]);
    expect(g("file_type")).toEqual([["Image", ["Beta img"]], ["PDF", ["Zeta deck"]], ["Links", ["alpha doc", "Notes"]]]);
    expect(g("link_type")).toEqual([["docs.google.com", ["Notes"]], ["notion.so", ["alpha doc"]], ["Files", ["Beta img", "Zeta deck"]]]);
    expect(g("creator")).toEqual([["alice", ["alpha doc", "Beta img"]], ["bob", ["Zeta deck"]], ["Unknown creator", ["Notes"]]]);
  });

  it("no grouping yields one unlabeled group; no matches yields none", () => {
    const one = browseArtifacts(ALL, DEFAULT_ARTIFACT_BROWSE);
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe("");
    expect(browseArtifacts(ALL, { ...DEFAULT_ARTIFACT_BROWSE, query: "zzz" })).toEqual([]);
  });

  it("filters by selected type chips (union) and combines with search", () => {
    const f = (types: string[], query = "") => names(browseArtifacts(ALL, { ...DEFAULT_ARTIFACT_BROWSE, types, query, sort: "name_asc" }).flatMap((x) => x.items));
    expect(f(["file:PDF"])).toEqual(["Zeta deck"]);
    expect(f(["file:PDF", "link:notion.so"])).toEqual(["alpha doc", "Zeta deck"]);
    expect(f(["file:PDF", "link:notion.so"], "alice")).toEqual(["alpha doc"]);
  });

  it("lists available type chips with counts, sorted by label", () => {
    const t = availableTypes([...ALL, mk({ id: 9, name: "Another", artifact_type: "file", mime_type: "application/pdf" })]);
    expect(t.map((x) => [x.key, x.count])).toEqual([
      ["link:docs.google.com", 1], ["file:Image", 1], ["link:notion.so", 1], ["file:PDF", 2],
    ]);
  });
});
