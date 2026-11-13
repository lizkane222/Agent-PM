/**
 * The rich-text stylesheet, applied to real DOM.
 *
 * Tailwind v4's Preflight resets every list (`ol, ul { list-style: none }`, no padding) and the
 * `prose` class is a no-op without the typography plugin, so bullet, numbered and "Steps" lists were
 * toggled correctly by the editor and then drawn as plain unindented lines. jsdom does not load the
 * app's CSS, so these tests inject the same reset first, then the rules under test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read as text with fs: Vitest turns `?raw` imports of .css files into an empty string. (A path
// string, not `new URL(...)`: under jsdom the global URL is not the class Node's fs expects.)
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");
const css = read("../rich-text.css");
if (css.length < 100) throw new Error("rich-text.css was not read");

// The file wraps its rules in `@layer base { ... }`; jsdom's CSS parser does not know layers, and
// the wrapper does not change which rules match, so test the rules inside it.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*@layer base\s*\{/, "").replace(/\}\s*$/, "");

// What Tailwind Preflight does to lists and form controls.
const PREFLIGHT = "ol, ul, menu { list-style: none; } ol, ul, li, p { margin: 0; padding: 0; }";

let style: HTMLStyleElement;
beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  style = document.createElement("style");
  style.textContent = `${PREFLIGHT}\n${rules}`;
  document.head.appendChild(style);
});

function mount(html: string, wrapperClass: string | null) {
  const host = document.createElement("div");
  if (wrapperClass) host.className = wrapperClass;
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}
const cs = (el: Element) => getComputedStyle(el);
const listStyle = (el: Element) => cs(el).getPropertyValue("list-style") || cs(el).listStyleType;

const BULLETS = "<ul><li><p>one</p><ul><li><p>nested</p><ul><li><p>deep</p></li></ul></li></ul></li><li><p>two</p></li></ul>";
const NUMBERS = "<ol><li><p>one</p><ol><li><p>nested</p></li></ol></li><li><p>two</p></li></ol>";
const STEPS =
  '<ul data-type="taskList">' +
  '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>open step</p></div></li>' +
  '<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>done step</p></div></li>' +
  "</ul>";

describe.each([".rich-text", ".prose", ".ProseMirror"])("lists inside %s", (selector) => {
  const cls = selector.slice(1);

  it("bullet lists get markers and indentation", () => {
    const host = mount(BULLETS, cls);
    const ul = host.querySelector("ul") as HTMLElement;
    expect(listStyle(ul)).toContain("disc");
    expect(cs(ul).paddingLeft).toBe("1.5em");
  });

  it("nested bullet lists change marker with depth", () => {
    const host = mount(BULLETS, cls);
    const uls = host.querySelectorAll("ul");
    expect(listStyle(uls[1])).toContain("circle");
    expect(listStyle(uls[2])).toContain("square");
  });

  it("numbered lists get numbers and indentation, and nested ones switch to letters", () => {
    const host = mount(NUMBERS, cls);
    const ols = host.querySelectorAll("ol");
    expect(listStyle(ols[0])).toContain("decimal");
    expect(cs(ols[0]).paddingLeft).toBe("1.5em");
    expect(listStyle(ols[1])).toContain("lower-alpha");
  });

  it("an item's paragraph adds no extra gap (TipTap wraps item text in <p>)", () => {
    const host = mount(BULLETS, cls);
    expect(cs(host.querySelector("li > p") as Element).marginTop).toBe("0px");
  });
});

describe("lists outside the rich-text scope are left alone", () => {
  it("a bare <ul> (an app menu, say) keeps Preflight's reset", () => {
    const host = mount("<ul><li>menu item</li></ul>", null);
    expect(listStyle(host.querySelector("ul") as Element)).toContain("none");
  });

  it("a list in an unrelated wrapper keeps the reset", () => {
    const host = mount("<ul><li>x</li></ul>", "some-nav");
    expect(listStyle(host.querySelector("ul") as Element)).toContain("none");
  });
});

describe("Steps (checklists)", () => {
  it.each([".rich-text", ".prose", ".ProseMirror"])("in %s: no bullet, no indent, checkbox beside the text", (selector) => {
    const host = mount(STEPS, selector.slice(1));
    const ul = host.querySelector("ul") as HTMLElement;
    expect(listStyle(ul)).toContain("none");
    expect(cs(ul).paddingLeft).toBe("0px");
    const li = host.querySelector("li") as HTMLElement;
    expect(cs(li).display).toBe("flex");
    expect(cs(li.querySelector("label") as Element).flexShrink).toBe("0");
    expect(cs(li.querySelector(":scope > div") as Element).flexGrow).toBe("1");
  });

  it("a finished step is struck through and the open one is not", () => {
    const host = mount(STEPS, "rich-text");
    const [open, done] = Array.from(host.querySelectorAll("li > div")) as HTMLElement[];
    expect(cs(done).textDecoration).toContain("line-through");
    expect(cs(open).textDecoration).not.toContain("line-through");
  });

  it("a checklist is not given bullets by the generic ul rule", () => {
    const host = mount(STEPS, "rich-text");
    expect(listStyle(host.querySelector("ul") as Element)).not.toContain("disc");
  });

  it("a checklist nested in a bullet list is still a checklist", () => {
    const host = mount(`<ul><li><p>parent</p>${STEPS}</li></ul>`, "rich-text");
    const task = host.querySelector('ul[data-type="taskList"]') as HTMLElement;
    expect(listStyle(task)).toContain("none");
  });
});

describe("displayed checklists are read-only", () => {
  it("in .rich-text (display) the checkbox ignores clicks", () => {
    const host = mount(STEPS, "rich-text");
    expect(cs(host.querySelector("input") as Element).pointerEvents).toBe("none");
  });

  it("in the editor (.ProseMirror, no .rich-text) the checkbox stays clickable", () => {
    const host = mount(STEPS, "ProseMirror");
    expect(cs(host.querySelector("input") as Element).pointerEvents).not.toBe("none");
  });

  it("a .prose wrapper around an editor does not disable its checkboxes", () => {
    const host = mount(`<div class="ProseMirror">${STEPS}</div>`, "prose");
    expect(cs(host.querySelector("input") as Element).pointerEvents).not.toBe("none");
  });
});

describe("the stylesheet is actually loaded by the app", () => {
  it("index.css imports it, after Tailwind so it can override Preflight", () => {
    const index = read("../../index.css");
    const tailwind = index.indexOf('@import "tailwindcss"');
    const richText = index.indexOf('@import "./styles/rich-text.css"');
    expect(tailwind).toBeGreaterThanOrEqual(0);
    expect(richText).toBeGreaterThan(tailwind);
  });

  it("is in the base layer, so a utility class on one element can still override it", () => {
    expect(css).toMatch(/@layer base\s*\{/);
  });
});
