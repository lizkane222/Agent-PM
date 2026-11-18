import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structural guards for the calendar's action-items sidebar.
 *
 * There used to be two copies — a local function inside `pages/CalendarPage.tsx` (the one users
 * saw) and a diverged one in `components/calendar/` kept alive by tests. They are now ONE:
 * `components/calendar/ActionItemsSidebar.tsx`, imported by the page. These assertions keep it
 * that way and pin the shape the behavioural tests (`ActionItemsSidebarOrdering`,
 * `ActionItemsSidebarModalOnly`, `ActionItemsSidebarFreshness`) rely on.
 */

const SRC = resolve(__dirname, "../../..");
const read = (relativePath: string) => readFileSync(resolve(SRC, relativePath), "utf8");

const SIDEBAR = "components/calendar/ActionItemsSidebar.tsx";

describe("CalendarPage uses the one extracted sidebar", () => {
  const page = read("pages/CalendarPage.tsx");

  it("imports ActionItemsSidebar from components/calendar", () => {
    expect(page).toMatch(/import ActionItemsSidebar from "\.\.\/components\/calendar\/ActionItemsSidebar"/);
    expect(page).toContain("<ActionItemsSidebar ");
  });

  it("no longer defines its own sidebar, card, or the pill helpers that only they used", () => {
    expect(page).not.toMatch(/function ActionItemsSidebar\b/);
    expect(page).not.toMatch(/function ActionItemCard_Cal\b/);
    expect(page).not.toMatch(/function OccurrencesList\b/);
    expect(page).not.toMatch(/function CalPill(Select|Number|Date|Url)\b/);
  });

  it("does not fetch the sidebar's list itself", () => {
    expect(page).not.toContain('status: "Open,In Progress,Done"');
  });
});

describe("the sidebar's ordering and data source", () => {
  const source = read(SIDEBAR);

  it("groups its list with the shared helper", () => {
    expect(source).toContain("groupActionItems(");
    expect(source).toMatch(/import \{[^}]*groupActionItems[^}]*\} from "[^"]*lib\/actionItemSidebarOrder"/s);
  });

  it("reads zones and pins from the shared hooks", () => {
    expect(source).toContain("useActionItemZoneSets()");
    expect(source).toContain("const { pinnedIds } = useFocusPins();");
    expect(source).not.toContain("setStagedIds");
    expect(source).not.toContain('v === "today"');
  });

  it("renders a labelled section header per group", () => {
    expect(source).toContain("data-section={group.key}");
    expect(source).toContain("group.items.length");
  });

  it("states the Done window rather than truncating silently", () => {
    expect(source).toContain("DONE_WINDOW_DAYS");
    expect(source).toContain("isRecentlyDone(");
  });

  it("offers the shared filter chip row", () => {
    expect(source).toContain("<SidebarFilterFlags");
    expect(source).toMatch(/import SidebarFilterFlags from "[^"]*SidebarFilterFlags"/);
  });

  it("asks the API for Done alongside the open statuses, through the list hook", () => {
    // Without Done in the fetch the Done section is permanently empty and the Done chip is a
    // no-op — a failure mode that looks like "there is nothing done" rather than a bug.
    expect(source).toContain('status: "Open,In Progress,Done"');
    expect(source).toContain("useActionItemList(");
    expect(source).not.toContain("listActionItems(");
  });
});

describe("action items are edited only in the shared modal", () => {
  const source = read(SIDEBAR);

  it("opens ActionItemModal from its card", () => {
    expect(source).toContain("ActionItemModal");
    expect(source).toContain("setModalItem(");
  });

  it("has no inline expand-to-edit state on the card", () => {
    expect(source).not.toContain("forceExpand");
    expect(source).not.toMatch(/function ActionItemCard_Cal[\s\S]{0,4000}?setExpanded\(/);
    expect(source).not.toMatch(/function ActionItemCard_Cal[\s\S]{0,4000}?function commitEdit\(/);
  });

  it("card renders the item prop, not a local form copy", () => {
    const cardStart = source.indexOf("function ActionItemCard_Cal");
    expect(cardStart).toBeGreaterThan(-1);
    expect(source.slice(cardStart, cardStart + 6000)).not.toContain("editForm");
  });
});
