import { describe, it, expect } from "vitest";
import {
  ALL_SWATCHES,
  DARK_TEXT,
  DEFAULT_CATEGORY_COLORS,
  EVENT_TYPE_META,
  IMPORTANT_PALETTE,
  LIGHT_TEXT,
  PALETTES,
  borderFor,
  darken,
  isHexColor,
  readableTextColor,
  relativeLuminance,
  withAlpha,
} from "../eventColors";

describe("PALETTES", () => {
  it("offers the four named palettes in order", () => {
    expect(PALETTES.map((p) => p.name)).toEqual([
      "Bubblegum",
      "Purple Pastel",
      "Ocean",
      "90s",
    ]);
  });

  it("holds five valid hex colors per palette", () => {
    for (const palette of PALETTES) {
      expect(palette.colors).toHaveLength(5);
      for (const color of palette.colors) {
        expect(isHexColor(color)).toBe(true);
      }
    }
  });

  it("has no duplicate swatches across palettes", () => {
    const lower = ALL_SWATCHES.map((c) => c.toLowerCase());
    expect(new Set(lower).size).toBe(20);
  });

  it("uses the 90s palette for important colors", () => {
    expect(IMPORTANT_PALETTE).toEqual(["#842D78", "#174DB1", "#297EA1", "#E5A836", "#B2336C"]);
  });
});

describe("DEFAULT_CATEGORY_COLORS", () => {
  it("covers every colorable event type", () => {
    for (const { id } of EVENT_TYPE_META) {
      expect(isHexColor(DEFAULT_CATEGORY_COLORS[id])).toBe(true);
    }
    expect(Object.keys(DEFAULT_CATEGORY_COLORS)).toHaveLength(EVENT_TYPE_META.length);
  });

  it("gives all seven types a distinct color", () => {
    const colors = Object.values(DEFAULT_CATEGORY_COLORS).map((c) => c.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("draws only from the offered palettes", () => {
    const offered = new Set(ALL_SWATCHES.map((c) => c.toLowerCase()));
    for (const color of Object.values(DEFAULT_CATEGORY_COLORS)) {
      expect(offered).toContain(color.toLowerCase());
    }
  });

  it("avoids the near-white swatches, which would vanish on the white grid", () => {
    const nearWhite = ["#f0f9f8", "#f1eeff", "#fff6ed"];
    const used = Object.values(DEFAULT_CATEGORY_COLORS).map((c) => c.toLowerCase());
    for (const color of nearWhite) {
      expect(used).not.toContain(color);
    }
  });
});

describe("relativeLuminance", () => {
  it("bounds black and white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("treats a malformed color as white so text falls back to dark", () => {
    expect(relativeLuminance("nope")).toBe(1);
  });
});

describe("readableTextColor", () => {
  it("uses dark text on every pastel swatch", () => {
    const pastels = [...PALETTES[0].colors, ...PALETTES[1].colors];
    for (const color of pastels) {
      expect(readableTextColor(color)).toBe(DARK_TEXT);
    }
  });

  it("uses white text on the dark Ocean and 90s swatches", () => {
    const dark = ["#18363E", "#2D5F6E", "#842D78", "#174DB1", "#B2336C"];
    for (const color of dark) {
      expect(readableTextColor(color)).toBe(LIGHT_TEXT);
    }
  });

  it("picks the higher-contrast option for every offered swatch", () => {
    for (const color of ALL_SWATCHES) {
      expect([DARK_TEXT, LIGHT_TEXT]).toContain(readableTextColor(color));
    }
  });
});

describe("darken", () => {
  it("leaves a color untouched at 0 and blackens it at 1", () => {
    expect(darken("#82BFB7", 0)).toBe("#82bfb7");
    expect(darken("#82BFB7", 1)).toBe("#000000");
  });

  it("pads single-digit channels", () => {
    expect(darken("#0A0A0A", 0.5)).toBe("#050505");
  });

  it("passes malformed input through untouched", () => {
    expect(darken("nope", 0.5)).toBe("nope");
  });
});

describe("borderFor", () => {
  it("darkens near-white fills so the event keeps an edge", () => {
    const border = borderFor("#F0F9F8");
    expect(border).not.toBe("#F0F9F8");
    expect(relativeLuminance(border)).toBeLessThan(relativeLuminance("#F0F9F8"));
  });

  it("borders a mid or dark fill in its own color", () => {
    expect(borderFor("#82BFB7")).toBe("#82BFB7");
    expect(borderFor("#842D78")).toBe("#842D78");
  });
});

describe("withAlpha", () => {
  it("renders an rgba string at the given opacity", () => {
    expect(withAlpha("#d1d5db", 0.75)).toBe("rgba(209, 213, 219, 0.75)");
  });

  it("keeps the fill distinguishable from the same color at full opacity", () => {
    expect(withAlpha("#d1d5db", 0.75)).not.toBe("#d1d5db");
  });

  it("clamps opacity into 0..1", () => {
    expect(withAlpha("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
    expect(withAlpha("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
  });

  it("passes malformed input through untouched", () => {
    expect(withAlpha("nope", 0.75)).toBe("nope");
  });
});

describe("isHexColor", () => {
  it("accepts 6-digit hex in either case", () => {
    expect(isHexColor("#AABBCC")).toBe(true);
    expect(isHexColor("#aabbcc")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["AABBCC", "#AABBC", "#AABBCCDD", "red", "", null, undefined, 123]) {
      expect(isHexColor(bad)).toBe(false);
    }
  });
});
