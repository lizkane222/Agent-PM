import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MiniNodePreview from "../MiniNodePreview";
import { defaultPropsFor, type MiniNode } from "../miniCanvas";

const mk = (type: string, props: Record<string, unknown> = {}, over: Partial<MiniNode> = {}): MiniNode => ({
  id: "m", type, icon: "", label: type, x: 0, y: 0, w: 200, h: 60,
  props: { ...defaultPropsFor(type), ...props }, ...over,
});

const preview = (node: MiniNode) => render(<MiniNodePreview node={node} />).container;

describe("MiniNodePreview draws each component as itself", () => {
  it("Heading is a heading element at its level, with its text", () => {
    const c = preview(mk("Heading", { text: "Quarterly plan", level: 2 }));
    const h = c.querySelector("h2") as HTMLElement;
    expect(h).toBeTruthy();
    expect(h.textContent).toBe("Quarterly plan");
    expect(h.style.fontWeight).toBe("700");
  });

  it("Heading level changes the element", () => {
    expect(preview(mk("Heading", { level: 1 })).querySelector("h1")).toBeTruthy();
    expect(preview(mk("Heading", { level: 4 })).querySelector("h4")).toBeTruthy();
  });

  it("Text is a paragraph at its font size", () => {
    const p = preview(mk("Text", { text: "Body copy", fontSize: 18 })).querySelector("p") as HTMLElement;
    expect(p.textContent).toBe("Body copy");
    expect(p.style.fontSize).toBe("18px");
  });

  it("Label is small uppercase text", () => {
    const l = preview(mk("Label", { text: "Status" })).querySelector("[data-mini-preview=Label]") as HTMLElement;
    expect(l.style.textTransform).toBe("uppercase");
    expect(l.textContent).toBe("Status");
  });

  it("Divider is a horizontal rule", () => {
    const c = preview(mk("Divider", { thickness: 3, color: "#ff0000" }));
    const hr = c.querySelector("hr") as HTMLElement;
    expect(hr).toBeTruthy();
    expect(hr.style.borderTop).toContain("3px");
  });

  it("RichText renders its HTML and strips scripts", () => {
    const c = preview(mk("RichText", { html: "<p>Hello <strong>there</strong></p><script>alert(1)</script>" }));
    expect(c.querySelector("strong")?.textContent).toBe("there");
    expect(c.querySelector("script")).toBeNull();
  });

  it("Card has a card's border, radius and shadow", () => {
    const el = preview(mk("Card")).querySelector("[data-mini-preview=Card]") as HTMLElement;
    expect(el.style.border).toContain("1px solid");
    expect(el.style.borderRadius).toBe("12px");
    expect(el.style.boxShadow).not.toBe("");
  });

  it("Section is rounder than a Card and has no shadow", () => {
    const el = preview(mk("Section")).querySelector("[data-mini-preview=Section]") as HTMLElement;
    expect(el.style.borderRadius).toBe("16px");
    expect(el.style.boxShadow).toBe("");
  });

  it("Row lays out horizontally and Column vertically", () => {
    expect((preview(mk("Row")).querySelector("[data-mini-preview=Row]") as HTMLElement).style.flexDirection).toBe("row");
    expect((preview(mk("Column")).querySelector("[data-mini-preview=Column]") as HTMLElement).style.flexDirection).toBe("column");
  });

  it("Page is a titled sheet", () => {
    const c = preview(mk("Page", { label: "Cover" }));
    expect(c.textContent).toContain("Cover");
    expect(c.querySelector("[data-mini-preview=Page]")).toBeTruthy();
  });

  it("an empty container is findable: dashed outline and its type name", () => {
    const row = preview(mk("Row")).querySelector("[data-mini-preview=Row]") as HTMLElement;
    expect(row.style.border).toContain("dashed");
    expect(row.textContent).toContain("Row");
  });

  it("each type renders a different element, not one shared card", () => {
    const sigs = ["Heading", "Text", "Label", "Divider", "Card", "Section", "Row", "Column", "Container", "Page"]
      .map(t => preview(mk(t)).innerHTML);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("returns nothing for a type it does not know, so the caller keeps the generic card", () => {
    expect(preview(mk("Button")).innerHTML).toBe("");
    expect(preview(mk("record")).innerHTML).toBe("");
  });

  it("falls back to registry defaults when a node carries no props", () => {
    const c = preview({ ...mk("Heading"), props: undefined });
    expect(c.querySelector("h1")?.textContent).toBe("Heading");
  });
});

describe("MiniNodePreview shows the data attached to a component", () => {
  const fields = { g_title: "Test Rich text title", g_description: "test rich text description" };

  it("Rich Text: its own content AND the fields (the reported case)", () => {
    const c = preview(mk("RichText", {}, { fields }));
    expect(c.textContent).toContain("Rich text content");
    expect(c.textContent).toContain("Test Rich text title");
    expect(c.textContent).toContain("test rich text description");
  });

  it.each(["Heading", "Text", "Label", "Divider", "RichText", "Card", "Section", "Row", "Column", "Container", "Page"])(
    "%s draws each filled field as a label over its value", (type) => {
      const c = preview(mk(type, {}, { fields }));
      const list = c.querySelector("[data-mini-fields]") as HTMLElement;
      expect(list, type).toBeTruthy();
      expect(list.querySelector("[data-mini-field=g_title]")?.textContent).toBe("TitleTest Rich text title");
      expect(list.querySelector("[data-mini-field=g_description]")?.textContent).toBe("Descriptiontest rich text description");
    });

  it("a text component keeps its own content above the fields", () => {
    const c = preview(mk("Heading", { text: "My heading" }, { fields }));
    const html = c.innerHTML;
    expect(html.indexOf("My heading")).toBeLessThan(html.indexOf("Test Rich text title"));
  });

  it("draws nothing for fields that are blank", () => {
    const c = preview(mk("Card", {}, { fields: { g_title: "", g_notes: "  " } }));
    expect(c.querySelector("[data-mini-fields]")).toBeNull();
  });

  it("an empty container with fields no longer shows its 'empty' hint", () => {
    const c = preview(mk("Row", {}, { fields }));
    expect(c.querySelector("[data-mini-preview=Row]")?.textContent).not.toMatch(/^Row$/);
    expect((c.querySelector("[data-mini-preview=Row]") as HTMLElement).style.border).not.toContain("dashed");
  });

  it("grows to fit the fields instead of clipping them", () => {
    const withFields = preview(mk("Card", {}, { fields, h: 60 })).querySelector("[data-mini-preview=Card]") as HTMLElement;
    expect(withFields.style.height).toBe("auto");
    expect(withFields.style.minHeight).toBe("60px");
    const plain = preview(mk("Card", {}, { h: 60 })).querySelector("[data-mini-preview=Card]") as HTMLElement;
    expect(plain.style.height).toBe("100%");
  });

  it("renders values as text, never as markup", () => {
    const c = preview(mk("Text", {}, { fields: { g_notes: "<img src=x onerror=alert(1)>" } }));
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toContain("<img src=x");
  });

  it("keeps line breaks in multi-line values", () => {
    const c = preview(mk("Card", {}, { fields: { g_notes: "line one\nline two" } }));
    const v = c.querySelector("[data-mini-field=g_notes] div:last-child") as HTMLElement;
    expect(v.style.whiteSpace).toBe("pre-wrap");
  });
});
