import { describe, it, expect } from "vitest";
import { ALL_FIELD_DEFS, MINI_FIELD_CATALOG, fieldLabel, fieldType } from "../miniFields";

describe("miniFields", () => {
  it("turns a catalog key into the label the picker shows", () => {
    expect(fieldLabel("g_title")).toBe("Title");
    expect(fieldLabel("g_description")).toBe("Description");
    expect(fieldLabel("ai_due_date")).toBe("Due Date");
  });

  it("shows an unknown key as itself rather than hiding the data", () => {
    expect(fieldLabel("legacy_thing")).toBe("legacy_thing");
  });

  it("knows each field's type, defaulting to text", () => {
    expect(fieldType("g_description")).toBe("textarea");
    expect(fieldType("g_url")).toBe("url");
    expect(fieldType("nope")).toBe("text");
  });

  it("has unique keys, so a key identifies exactly one field", () => {
    const keys = ALL_FIELD_DEFS.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(MINI_FIELD_CATALOG.flatMap(c => c.fields)).toHaveLength(keys.length);
  });
});
