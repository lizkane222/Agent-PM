import { describe, it, expect } from "vitest";
import { formatMessageDate, htmlToText, linkify, normalizeBody, parseSender, splitQuoted, toParagraphs } from "../emailThreadFormat";

describe("linkify", () => {
  it("links http, www and mailto, trimming trailing punctuation", () => {
    const segs = linkify("See https://a.com/x, or www.b.com. Mail mailto:me@x.com!");
    const links = segs.filter((s) => s.type === "link") as { href: string; text: string }[];
    expect(links.map((l) => l.href)).toEqual(["https://a.com/x", "https://www.b.com", "mailto:me@x.com"]);
    expect(segs.map((s) => s.text).join("")).toBe("See https://a.com/x, or www.b.com. Mail mailto:me@x.com!");
  });
  it("keeps a balanced paren inside the url and drops an unbalanced one", () => {
    const l = linkify("(see https://a.com/f_(1)) ok").find((s) => s.type === "link")!;
    expect(l.text).toBe("https://a.com/f_(1)");
  });
  it("never links javascript: or data: urls", () => {
    expect(linkify("javascript:alert(1) data:text/html,x").every((s) => s.type === "text")).toBe(true);
  });
});

describe("htmlToText", () => {
  it("drops script/style and tags, never keeps markup", () => {
    const t = htmlToText('<style>p{}</style><p>Hi <b>there</b></p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(t).not.toMatch(/[<>]/);
    expect(t).not.toContain("alert");
    expect(t.trim()).toBe("Hi there");
  });
  it("keeps http anchors as label (url) and drops javascript: targets", () => {
    expect(htmlToText('<a href="https://x.com/a?b=1&amp;c=2">Docs</a>')).toBe("Docs (https://x.com/a?b=1&c=2)");
    expect(htmlToText('<a href="javascript:alert(1)">Click</a>')).toBe("Click");
  });
  it("decodes entities", () => {
    expect(htmlToText("a &amp; b &#39;c&#39; &lt;x&gt;")).toBe("a & b 'c' <x>");
  });
});

describe("splitQuoted", () => {
  it("collapses an 'On ... wrote:' reply", () => {
    const r = splitQuoted("Sounds good.\n\nOn Mon, Nov 3, 2026 at 9:00 AM Jane <j@x.com> wrote:\n> earlier text");
    expect(r.main).toBe("Sounds good.");
    expect(r.hidden).toContain("wrote:");
  });
  it("collapses signatures and Outlook header blocks", () => {
    expect(splitQuoted("Thanks\n-- \nBob\nCEO").hidden).toContain("Bob");
    const o = splitQuoted("Yes\n\nFrom: A <a@x.com>\nSent: Monday\nTo: b\nSubject: s\n\nold");
    expect(o.main).toBe("Yes");
  });
  it("does not treat a lone 'From:' line as quote", () => {
    expect(splitQuoted("From: the team, welcome").hidden).toBe("");
  });
  it("keeps the whole body when it is only quote", () => {
    const r = splitQuoted("> only quoted");
    expect(r.main).toBe("> only quoted");
    expect(r.hidden).toBe("");
  });
});

describe("misc", () => {
  it("parseSender", () => {
    expect(parseSender('"Jane Doe" <j@x.com>')).toEqual({ name: "Jane Doe", email: "j@x.com" });
    expect(parseSender("<j@x.com>")).toEqual({ name: "j@x.com", email: "j@x.com" });
    expect(parseSender("plain")).toEqual({ name: "plain", email: "" });
  });
  it("formatMessageDate falls back to the raw string", () => {
    expect(formatMessageDate("not a date")).toBe("not a date");
    expect(formatMessageDate("2026-11-03T10:00:00Z")).toMatch(/2026/);
  });
  it("normalizes and paragraphs", () => {
    expect(normalizeBody("a  \r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
    expect(toParagraphs("a\nb\n\nc")).toEqual(["a\nb", "c"]);
  });
});
