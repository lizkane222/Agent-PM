import { toggleExportItem } from "../brain/exportItems.js";
import { EXPORT_ITEM_TOGGLE_FIXTURES } from "../fixtures/exportItemToggle.fixtures.js";

describe("toggleExportItem", () => {
  for (const f of EXPORT_ITEM_TOGGLE_FIXTURES) {
    const label = f.note ?? `toggle "${f.toggle.id}"`;
    it(label, () => {
      const result = toggleExportItem(f.initialItems, f.toggle);
      expect(result.map((i) => i.id)).toEqual(f.expectedIds);
    });
  }
});
