import { describe, it, expect } from "vitest";
import type { AccountArtifact } from "../../types/accounts";
import type { CommentReference } from "../../types/comments";
import {
  DEFAULT_ARTIFACT_BROWSE, availableCreators, browseArtifacts, isArtifactBrowseActive, isLinkedToActionItem,
} from "../artifactBrowse";

const ref = (resource_type: string) => ({ resource_type: resource_type as CommentReference["resource_type"], resource_id: 1, label: "L", url: "/x" });
const mk = (o: Partial<AccountArtifact>): AccountArtifact => ({
  id: 1, account: 1, artifact_type: "link", name: "x", url: null, secondary_url: "", icon_key: "",
  file_url: null, image_url: null, mime_type: "", file_size: null, description: "", references: [], used_in: [],
  uploaded_by: null, uploaded_by_username: null, created_at: "2026-01-01T00:00:00Z", updated_at: "", ...o,
});
const A = mk({ id: 1, name: "A", uploaded_by_username: "bob", used_in: [ref("action_item")] });
const B = mk({ id: 2, name: "B", uploaded_by_username: "alice", used_in: [ref("project")] });
const C = mk({ id: 3, name: "C", uploaded_by_username: "alice" });
const D = mk({ id: 4, name: "D" });
const names = (s: Parameters<typeof browseArtifacts>[1]) =>
  browseArtifacts([A, B, C, D], { ...s, sort: "name_asc" }).flatMap((g) => g.items.map((i) => i.name));

describe("artifact creator and action-item filters", () => {
  it("lists creators with counts, skipping unknown", () => {
    expect(availableCreators([A, B, C, D])).toEqual([{ name: "alice", count: 2 }, { name: "bob", count: 1 }]);
  });
  it("detects action-item links only", () => {
    expect([A, B, C].map(isLinkedToActionItem)).toEqual([true, false, false]);
  });
  it("filters by creator (union)", () => {
    expect(names({ ...DEFAULT_ARTIFACT_BROWSE, creators: ["alice"] })).toEqual(["B", "C"]);
    expect(names({ ...DEFAULT_ARTIFACT_BROWSE, creators: ["alice", "bob"] })).toEqual(["A", "B", "C"]);
  });
  it("filters to artifacts used by an action item and combines with creator", () => {
    expect(names({ ...DEFAULT_ARTIFACT_BROWSE, linkedActionItem: true })).toEqual(["A"]);
    expect(names({ ...DEFAULT_ARTIFACT_BROWSE, linkedActionItem: true, creators: ["alice"] })).toEqual([]);
  });
  it("reports filters as active", () => {
    expect(isArtifactBrowseActive(DEFAULT_ARTIFACT_BROWSE)).toBe(false);
    expect(isArtifactBrowseActive({ ...DEFAULT_ARTIFACT_BROWSE, creators: ["a"] })).toBe(true);
    expect(isArtifactBrowseActive({ ...DEFAULT_ARTIFACT_BROWSE, linkedActionItem: true })).toBe(true);
  });
});
