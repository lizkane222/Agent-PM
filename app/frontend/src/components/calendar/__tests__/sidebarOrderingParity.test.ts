import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structural guard for the action-items sidebar's grouped ordering.
 *
 * There are two copies of this sidebar and the one that actually renders on /calendar is the
 * local `ActionItemsSidebar` inside `pages/CalendarPage.tsx` — reached via that file's own
 * local `ItemsSidebar`, not `components/calendar/ItemsSidebar.tsx` (which has no consumers).
 * Neither the component nor its wrapper is exported, and `CalendarPage.test.tsx` mocks the
 * *module* copy, so the live one cannot be rendered in a test at all.
 *
 * `ActionItemsSidebarOrdering.test.tsx` covers the behaviour against the module copy. These
 * assertions read the source of both, so the live one cannot silently drift out of sync —
 * the same approach `checklistParity.test.ts` takes for StepsPanel.
 */

const SRC = resolve(__dirname, "../../..");

const SIDEBAR_COPIES = [
  "components/calendar/ActionItemsSidebar.tsx",
  "pages/CalendarPage.tsx",
];

function read(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

describe("action items sidebar ordering parity", () => {
  it.each(SIDEBAR_COPIES)("%s groups its list with the shared helper", (file) => {
    const source = read(file);
    expect(source).toContain("groupActionItems(");
    expect(source).toMatch(/import \{[^}]*groupActionItems[^}]*\} from "[^"]*lib\/actionItemSidebarOrder"/s);
  });

  it.each(SIDEBAR_COPIES)("%s reads zones and pins from the shared hooks", (file) => {
    // Both copies used to inline their own `stagedIds` useState over `actionItemZones`, which
    // is how they came to disagree about which zones even exist.
    const source = read(file);
    expect(source).toContain("useActionItemZoneSets()");
    expect(source).toContain("const { pinnedIds } = useFocusPins();");
    expect(source).not.toContain("setStagedIds");
  });

  it.each(SIDEBAR_COPIES)("%s renders a labelled section header per group", (file) => {
    const source = read(file);
    expect(source).toContain("data-section={group.key}");
    expect(source).toContain("group.items.length");
  });

  it.each(SIDEBAR_COPIES)("%s states the Done window rather than truncating silently", (file) => {
    const source = read(file);
    expect(source).toContain("DONE_WINDOW_DAYS");
    expect(source).toContain("isRecentlyDone(");
  });

  it.each(SIDEBAR_COPIES)("%s offers the shared filter chip row", (file) => {
    const source = read(file);
    expect(source).toContain("<SidebarFilterFlags");
    expect(source).toMatch(/import SidebarFilterFlags from "[^"]*SidebarFilterFlags"/);
  });

  it.each(SIDEBAR_COPIES)("%s asks the API for Done alongside the open statuses", (file) => {
    // Without Done in the fetch the Done section is permanently empty and the Done chip is a
    // no-op — a failure mode that looks like "there is nothing done" rather than a bug.
    expect(read(file)).toContain('status: "Open,In Progress,Done"');
  });

  it.each(SIDEBAR_COPIES)("%s no longer hand-rolls a zones storage listener", (file) => {
    // useActionItemZoneSets owns that key's listener now; a second one would double-parse and
    // could disagree with the store.
    const source = read(file);
    expect(source).not.toContain('v === "today"');
  });
});

describe("action items are edited only in the shared modal", () => {
  // Requested behaviour: clicking a sidebar action item opens ActionItemModal, and the card
  // itself never becomes an editor. Both copies had their own inline expanded form — a second,
  // diverging implementation of the modal's field set and save rules.
  //
  // Structural guards because the live copy cannot be rendered (see the header comment);
  // `ActionItemsSidebarModalOnly.test.tsx` asserts the behaviour against the module copy.

  it.each(SIDEBAR_COPIES)("%s opens ActionItemModal from its card", (file) => {
    const source = read(file);
    expect(source).toContain("ActionItemModal");
    expect(source).toContain("setModalItem(");
  });

  it.each(SIDEBAR_COPIES)("%s has no inline expand-to-edit state on the card", (file) => {
    const source = read(file);
    // The inline editor's three tells. `commitEdit` was its click-outside save, `forceExpand`
    // the prop that opened it, and `setExpanded` the toggle.
    expect(source).not.toContain("forceExpand");
    expect(source).not.toMatch(/function ActionItemCard_Cal[\s\S]{0,4000}?setExpanded\(/);
    expect(source).not.toMatch(/function ActionItemCard_Cal[\s\S]{0,4000}?function commitEdit\(/);
  });

  it.each(SIDEBAR_COPIES)("%s card renders the item prop, not a local form copy", (file) => {
    const source = read(file);
    // A collapsed-only card has no `editForm`; reading one back meant the card could display
    // values that had never been saved.
    const cardStart = source.indexOf("function ActionItemCard_Cal");
    expect(cardStart).toBeGreaterThan(-1);
    const card = source.slice(cardStart, cardStart + 6000);
    expect(card).not.toContain("editForm");
  });
});
