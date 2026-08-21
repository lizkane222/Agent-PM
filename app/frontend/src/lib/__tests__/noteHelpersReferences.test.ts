import { describe, it, expect } from "vitest";
import { sanitizeHtml, plainToHtml, htmlToPreviewText } from "../noteHelpers";

describe("noteHelpers - sanitization and HTML processing", () => {
  describe("sanitizeHtml", () => {
    it("sanitizes malicious HTML", () => {
      const maliciousHtml = '<p>Text <img src=x onerror="alert(1)"></p>';
      const result = sanitizeHtml(maliciousHtml);

      expect(result).toBeDefined();
      expect(result).not.toContain("onerror");
    });

    it("preserves safe HTML", () => {
      const safeHtml = "<p>Hello <strong>world</strong></p>";
      const result = sanitizeHtml(safeHtml);

      expect(result).toBeDefined();
      expect(result).toContain("Hello");
      expect(result).toContain("strong");
    });
  });

  describe("plainToHtml", () => {
    it("converts plain text with markdown links to HTML", () => {
      const plainText = "Check out [this task](/action-items/1)";
      const html = plainToHtml(plainText);

      expect(html).toContain("this task");
      expect(html).toContain("/action-items/1");
    });

    it("handles bullet points", () => {
      const plainText = "- Item 1\n- Item 2\n- Item 3";
      const html = plainToHtml(plainText);

      expect(html).toContain("ul");
      expect(html).toContain("li");
    });

    it("handles paragraphs", () => {
      const plainText = "First paragraph.\n\nSecond paragraph.";
      const html = plainToHtml(plainText);

      expect(html).toContain("p");
    });

    it("preserves already-HTML content", () => {
      const alreadyHtml = "<p>Already HTML</p>";
      const result = plainToHtml(alreadyHtml);

      expect(result).toBe(alreadyHtml);
    });
  });

  describe("htmlToPreviewText", () => {
    it("extracts plain text from HTML", () => {
      const html = "<p>Hello <strong>world</strong></p>";
      const text = htmlToPreviewText(html);

      expect(text).toBe("Hello world");
    });

    it("collapses whitespace", () => {
      const html = "<p>Multiple   spaces   and\nnewlines</p>";
      const text = htmlToPreviewText(html);

      expect(text).not.toContain("   ");
      expect(text).not.toContain("\n");
    });

    it("handles empty HTML", () => {
      const text = htmlToPreviewText("");
      expect(text).toBe("");
    });

    it("strips HTML tags", () => {
      const html = "<div><p>Content</p><a href='#'>link</a></div>";
      const text = htmlToPreviewText(html);

      expect(text).toBe("Contentlink");
    });
  });
});
