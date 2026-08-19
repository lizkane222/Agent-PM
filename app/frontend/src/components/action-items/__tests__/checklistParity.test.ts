import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structural guard for checklist parity.
 *
 * Action item detail lives in seven separate components — two of which are copy-pasted
 * duplicates inside AccountDetailPage — so mounting a new section in "the" modal reliably
 * misses most of them. That is exactly how the checklist shipped visible on the Action Items
 * page but missing from the Account Detail modal.
 *
 * These assertions read the source rather than rendering, because rendering every one of
 * these surfaces needs a different set of mocks. If a surface is legitimately retired,
 * delete its entry here; if a new one is added, add it.
 */

const SRC = resolve(__dirname, "../../..");

/** Every surface that renders editable action item detail. */
const DETAIL_SURFACES = [
  "components/account/ActionItemModal.tsx",
  "components/account/ActionItemSidePanelContent.tsx",
  "components/calendar/ActionItemsSidebar.tsx",
  "pages/ActionItemsPage.tsx",
  "pages/AccountDetailPage.tsx",
  "pages/CalendarPage.tsx",
];

function read(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

describe("action item checklist parity", () => {
  it.each(DETAIL_SURFACES)("%s renders the shared StepsPanel", (file) => {
    const source = read(file);
    expect(source).toContain("<StepsPanel");
    expect(source).toMatch(/import StepsPanel from "[^"]*action-items\/StepsPanel"/);
  });

  it.each(DETAIL_SURFACES)("%s guards the checklist against local-* drafts", (file) => {
    // Steps key off the numeric PK, which a draft has not been assigned yet.
    const source = read(file);
    for (const mount of source.split("<StepsPanel").slice(1)) {
      const preceding = source.slice(0, source.indexOf(mount));
      expect(preceding).toContain('startsWith("local-")');
    }
  });

  it("AccountDetailPage mounts it in both its modal and its side panel", () => {
    // It has local copies of each, neither of which uses the shared components.
    const source = read("pages/AccountDetailPage.tsx");
    expect(source.split("<StepsPanel").length - 1).toBe(2);
  });

  it.each(DETAIL_SURFACES)("%s no longer invites writing steps into the description", (file) => {
    expect(read(file)).not.toContain("Additional context, steps, or notes");
  });

  it("no surface anywhere still advertises steps in the description placeholder", () => {
    // Includes the create forms, which have no checklist but must not contradict it either.
    for (const file of [
      ...DETAIL_SURFACES,
      "components/account/NewActionItemCard.tsx",
    ]) {
      expect(read(file)).not.toContain("Additional context, steps, or notes");
    }
  });
});

/** Every surface that renders an action item's attachment controls. */
const ATTACHMENT_SURFACES = [
  "components/account/ActionItemModal.tsx",
  "components/account/ActionItemSidePanelContent.tsx",
  "pages/AccountDetailPage.tsx",
  "pages/ActionItemsPage.tsx",
];

describe("action item attachment parity", () => {
  it.each(ATTACHMENT_SURFACES)("%s offers the shared ArtifactPicker", (file) => {
    // Linking an existing account artifact used to exist in exactly one of these.
    const source = read(file);
    expect(source).toContain("<ArtifactPicker");
    expect(source).toMatch(/import ArtifactPicker from "[^"]*action-items\/ArtifactPicker"/);
  });

  it.each(ATTACHMENT_SURFACES)("%s can upload a file", (file) => {
    expect(read(file)).toContain("+ File");
  });

  it.each(ATTACHMENT_SURFACES)("%s surfaces attachment errors rather than swallowing them", (file) => {
    // A swallowed rejection here reads as "I clicked and nothing happened", which is exactly
    // how the broken file upload went unnoticed.
    const source = read(file);
    expect(source).toMatch(/role="alert"/);
    expect(source).not.toContain("catch { /* skip */ }");
  });

  it("AccountDetailPage offers it in both its modal and its side panel", () => {
    expect(read("pages/AccountDetailPage.tsx").split("<ArtifactPicker").length - 1).toBe(2);
  });

  it("nobody hand-rolls their own artifact dropdown any more", () => {
    for (const file of ATTACHMENT_SURFACES) {
      const source = read(file);
      // The one remaining "+ Artifact" string lives inside ArtifactPicker itself.
      expect(source).not.toContain(">+ Artifact<");
      expect(source).not.toContain("accountArtifacts");
    }
  });
});
