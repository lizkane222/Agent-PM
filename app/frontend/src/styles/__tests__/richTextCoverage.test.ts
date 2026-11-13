import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Any component that renders saved rich text with dangerouslySetInnerHTML must sit inside a
// `.rich-text` (or `.prose`) element, or Tailwind's Preflight strips its bullets, numbers and
// checkboxes. This fails the build for a NEW display site that forgets the class.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXEMPT = new Set(["lib/markdownToHtml.ts"]); // converter only; the caller renders it

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("rich-text display coverage", () => {
  it("every dangerouslySetInnerHTML site is styled by .rich-text or .prose", () => {
    const missing = walk(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"))
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !EXEMPT.has(rel))
      .filter((rel) => !/rich-text|prose/.test(readFileSync(join(SRC, rel), "utf8")));
    expect(missing).toEqual([]);
  });
});
