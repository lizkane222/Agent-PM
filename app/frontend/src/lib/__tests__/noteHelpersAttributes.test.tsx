import { describe, it, expect } from "vitest";

import { render } from "@testing-library/react";
import { elementProps, renderNoteWithReferences } from "../noteHelpers";

describe("rich-text attribute preservation", () => {
  const el = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild as Element;
  };

  it("maps class/for/style and drops event handlers", () => {
    const p = elementProps(el('<p class="a" style="margin-top: 2px" onclick="x()">t</p>'));
    expect(p.className).toBe("a");
    expect(p.style).toEqual({ marginTop: "2px" });
    expect(p).not.toHaveProperty("onclick");
  });

  it("makes a checked checkbox read-only", () => {
    const p = elementProps(el('<input type="checkbox" checked>'));
    expect(p.defaultChecked).toBe(true);
    expect(p.readOnly).toBe(true);
  });

  it("keeps task-list markup (and wraps in .rich-text) when a note has references", () => {
    const html =
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked><span></span></label><div><p>do it <a href="/x">x</a></p></div></li></ul>';
    const { container } = render(<>{renderNoteWithReferences(html, [{ resource_type: "account", resource_id: 1, label: "x", url: "/other" }])}</>);
    expect(container.querySelector(".rich-text")).toBeTruthy();
    expect(container.querySelector('ul[data-type="taskList"] > li > label input[type="checkbox"]')).toBeTruthy();
  });
});
