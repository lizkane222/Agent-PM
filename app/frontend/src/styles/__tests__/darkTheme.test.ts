import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const css = readFileSync(join(SRC, "index.css"), "utf8");

/** The dark token block: from `[data-theme="dark"] {` (first, the variables) to its closing brace. */
function darkVars(): Record<string, string> {
  const start = css.indexOf('[data-theme="dark"] {');
  const end = css.indexOf("\n}\n", start);
  const block = css.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
function lightVars(): Record<string, string> {
  const start = css.indexOf(":root {\n  --surface-card");
  const end = css.indexOf("\n}\n", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("dark theme scale", () => {
  const v = darkVars();

  it("defines the key variables", () => {
    for (const k of [
      "--twilio-gray-10", "--surface-card", "--surface-subtle", "--surface-subtle-2", "--border-subtle",
      "--text-ink", "--surface", "--bg", "--text-primary", "--text-secondary", "--border",
      "--color-gray-50", "--color-gray-100", "--color-gray-200", "--color-gray-400", "--color-gray-600", "--color-gray-900",
      "--color-red-50", "--color-green-100", "--color-amber-50", "--fc-page-bg-color",
    ]) expect(v[k], k).toBeTruthy();
  });

  it("layers: page darker than card darker than nested darker than deeper nested", () => {
    const page = lum(v["--twilio-gray-10"]);
    const card = lum(v["--surface-card"]);
    const nested = lum(v["--color-gray-50"]);
    const nested2 = lum(v["--color-gray-100"]);
    expect(page).toBeLessThan(card);
    expect(card).toBeLessThan(nested);
    expect(nested).toBeLessThan(nested2);
  });

  it("text and borders are legible against the card", () => {
    const card = v["--surface-card"];
    expect(contrast(v["--text-ink"], card)).toBeGreaterThan(10);
    expect(contrast(v["--color-gray-900"], card)).toBeGreaterThan(10);
    expect(contrast(v["--color-gray-600"], card)).toBeGreaterThan(6);
    expect(contrast(v["--color-gray-400"], card)).toBeGreaterThan(4.5);
    expect(contrast(v["--text-secondary"], card)).toBeGreaterThan(4.5);
    expect(contrast(v["--border-subtle"], card)).toBeGreaterThan(1.2);
    for (const k of ["--ink-red", "--ink-amber", "--ink-indigo", "--ink-green"])
      expect(contrast(v[k], v["--surface-subtle"]), k).toBeGreaterThan(7);
  });

  it("tinted chips are lighter than the card but still dark", () => {
    const card = lum(v["--surface-card"]);
    for (const f of ["red", "amber", "green", "blue", "violet", "emerald"]) {
      const t = lum(v[`--color-${f}-50`]);
      expect(t, f).toBeGreaterThan(card);
      expect(t, f).toBeLessThan(0.05);
    }
  });

  it("does not flip --color-white (text-white stays on saturated buttons)", () => {
    expect(v["--color-white"]).toBeUndefined();
  });
});

describe("light mode tokens equal the literals they replaced", () => {
  const l = lightVars();
  it.each([
    ["--surface-card", "#ffffff"], ["--surface-subtle", "#f9fafb"], ["--surface-subtle-2", "#f3f4f6"],
    ["--surface-subtle-3", "#fafafa"], ["--border-subtle", "#e5e7eb"], ["--border-subtle-2", "#d1d5db"],
    ["--text-ink", "#121c2d"], ["--text-gray-400", "#9ca3af"], ["--text-gray-500", "#6b7280"],
  ])("%s", (k, val) => expect(l[k]).toBe(val));
  it("never defines the fallback-driven variables in light mode", () => {
    for (const k of ["--surface", "--bg", "--text-primary", "--text-secondary", "--border"]) expect(l[k]).toBeUndefined();
  });
});

// Files other sessions own; their literals are migrated separately.
// registry.ts / NodeRenderer.tsx draw the user's canvas content, which is exported as light HTML.
const EXCLUDED = /(pagebuilder\/registry\.ts|pagebuilder\/NodeRenderer\.tsx|(ChatPage|TranscriptFooter|ExportContext|ExportBar|GlobalSearch|components\/Layout)\.tsx)$/;
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "__tests__" && n !== "node_modules") walk(p, out); }
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("no hard-coded light surfaces in inline styles", () => {
  const files = walk(SRC).filter((f) => !EXCLUDED.test(relative(SRC, f)));
  it("background: '#fff' / '#ffffff' / '#f9fafb' / '#f3f4f6' / '#fafafa' are tokens", () => {
    const re = /\b(?:background|backgroundColor)\s*:\s*["'](?:#fff|#ffffff|#f9fafb|#f3f4f6|#fafafa)["']/gi;
    const bad: string[] = [];
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      const m = t.match(re);
      if (m) bad.push(`${relative(SRC, f)}: ${m.length}`);
    }
    expect(bad).toEqual([]);
  });
  it("border: '1px solid #e5e7eb' is a token", () => {
    // CanvasExportModal builds a standalone exported HTML document (always light); not app UI.
    const re = /solid #e5e7eb/i;
    const bad = files
      .filter((f) => !/CanvasExportModal\.tsx$/.test(f))
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(bad).toEqual([]);
  });
});

describe("rich text editors and the Layouts canvas in dark mode", () => {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  const darkBlock = css.slice(css.indexOf('[data-theme="dark"] {'));
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("defines the editor and canvas-dot variables in dark mode only", () => {
    expect(darkBlock).toMatch(/--rte-bg:\s*#1c2640/);
    expect(darkBlock).toMatch(/--rte-toolbar-bg:\s*#212d4a/);
    expect(darkBlock).toMatch(/--canvas-dot:\s*rgba\(120, 140, 190, 0\.25\)/);
    const light = css.slice(0, css.indexOf('[data-theme="dark"] {'));
    expect(light).not.toMatch(/--rte-bg|--rte-toolbar-bg|--canvas-dot/);
  });

  it.each(["components/shared/RichTextMentionEditor.tsx", "components/pagebuilder/RichTextEditor.tsx"])(
    "%s wrapper and toolbar use the variables, light fallbacks unchanged",
    (rel) => {
      const t = read(rel);
      expect(t).toContain("bg-[var(--rte-bg,#ffffff)]");
      expect(t).toContain("bg-[var(--rte-toolbar-bg,#F4F4F6)]");
      expect(t).not.toContain("bg-[#F4F4F6]");
    },
  );

  it("the canvas dot grid colour is a variable with the old light colour as fallback", () => {
    const t = read("components/pagebuilder/PageBuilder.tsx");
    expect(t).toContain("var(--canvas-dot, #AEBBC1)");
    expect(t).not.toMatch(/radial-gradient\(circle, #AEBBC1/);
  });
});
