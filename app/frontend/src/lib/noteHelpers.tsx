import React from "react";
import DOMPurify from "dompurify";
import type { CommentReference } from "../types";

// Escapes &, <, > so legacy plain text can be safely wrapped in HTML tags
// without literal angle brackets being parsed as markup.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Legacy hand-rolled markdown link syntax from `handleLinkPaste`: [label](url)
const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s"]+)\)/g;

function lineToHtml(line: string): string {
  return escapeHtml(line).replace(
    MD_LINK,
    (_m, label: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
}

// Converts one blank-line-delimited paragraph of legacy plain text to HTML.
// Lines starting with "- " (the account/contact note sub-bullet convention)
// become a real <ul><li> list; other lines are joined with <br>.
function paragraphToHtml(paragraph: string): string {
  const out: string[] = [];
  let listBuf: string[] = [];
  let textBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length) { out.push(`<ul>${listBuf.map((l) => `<li>${l}</li>`).join("")}</ul>`); listBuf = []; }
  };
  const flushText = () => {
    if (textBuf.length) { out.push(`<p>${textBuf.join("<br>")}</p>`); textBuf = []; }
  };
  for (const line of paragraph.split("\n")) {
    if (line.startsWith("- ")) {
      flushText();
      listBuf.push(lineToHtml(line.slice(2)));
    } else {
      flushList();
      textBuf.push(lineToHtml(line));
    }
  }
  flushList();
  flushText();
  return out.join("");
}

// Converts legacy plain-text note/description content to HTML for TipTap.
// Content that already looks like HTML is passed through untouched.
export function plainToHtml(text: string): string {
  if (!text.trim()) return "";
  if (text.trimStart().startsWith("<")) return text; // already HTML
  return text.split(/\n\n+/).map(paragraphToHtml).join("");
}

// Sanitizes rich-text HTML before rendering via dangerouslySetInnerHTML.
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

// Strips HTML tags down to plain text for compact single/multi-line previews
// (card summaries, list rows) where full rich-text rendering doesn't fit.
export function htmlToPreviewText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = DOMPurify.sanitize(html);
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

// Renders note text: @mentions → indigo, [text](url) → clickable link
export function renderNoteInline(text: string): React.ReactNode[] {
  const TOKEN = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(@\S+)/g;
  const parts: React.ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(<a key={match.index} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2 hover:opacity-75" onClick={(e) => e.stopPropagation()}>{match[2]}</a>);
    } else {
      parts.push(<span key={match.index} className="text-indigo-500 font-medium">{match[0]}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Meeting-summary bullets: bare URLs and [text](url) become hyperlinks, @mentions stay blue.
// Long URLs (Zoom share links run past 150 chars) are shortened for display only.
const MEETING_NOTE_TOKEN = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>"')]+)|(@\S+)/g;

function shortenUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  return bare.length > 48 ? `${bare.slice(0, 45)}…` : bare;
}

export function renderMeetingNoteText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0, match: RegExpExecArray | null;
  const re = new RegExp(MEETING_NOTE_TOKEN.source, "g");
  const link = (key: number, href: string, label: string) => (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2 hover:opacity-75" style={{ overflowWrap: "anywhere" }} onClick={(e) => e.stopPropagation()}>{label}</a>
  );
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) {
      parts.push(link(match.index, match[3], match[2]));
    } else if (match[4]) {
      // Sentence punctuation right after a link belongs to the sentence, not the URL.
      const url = match[4].replace(/[.,;:!?]+$/, "");
      parts.push(link(match.index, url, shortenUrl(url)));
      if (url.length < match[4].length) parts.push(match[4].slice(url.length));
    } else {
      parts.push(<span key={match.index} style={{ color: "#2563eb", fontWeight: 600 }}>{match[0]}</span>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Renders HTML note content with structured references as interactive links
// References are lazy-loaded to avoid circular dependency with ReferenceLink component
export function renderNoteWithReferences(
  html: string,
  references?: CommentReference[]
): React.ReactNode {
  if (!references || references.length === 0) {
    // No references: render HTML as-is with dangerouslySetInnerHTML
    return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(html)) }} />;
  }

  // With references: parse HTML and replace href links with ReferenceLink components
  // This is a simple implementation that finds <a> tags and matches them against references
  const sanitized = sanitizeHtml(plainToHtml(html));
  const parser = new DOMParser();
  let doc: Document;
  try {
    doc = parser.parseFromString(`<div>${sanitized}</div>`, "text/html");
  } catch {
    // Fallback if parsing fails
    return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitized }} />;
  }

  // Find all anchor tags and match against references by href
  const root = doc.body.firstChild;
  if (!root) return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitized }} />;

  const renderNode = (node: Node): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { // Text node
        result.push(child.textContent);
      } else if (child.nodeType === 1) { // Element node
        const el = child as Element;
        if (el.tagName === "A" && el.getAttribute("href")) {
          const href = el.getAttribute("href")!;
          const ref = references.find((r) => r.url === href);
          if (ref) {
            // Lazy-load ReferenceLink to avoid circular deps
            const { ReferenceLink } = require("../components/shared/ReferenceLink");
            result.push(
              <ReferenceLink key={href} reference={ref}>
                {el.textContent}
              </ReferenceLink>
            );
          } else {
            // Not in our references: render as regular link
            result.push(
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
              >
                {el.textContent}
              </a>
            );
          }
        } else {
          // Other elements: recurse, KEEPING their attributes. They used to be dropped, which turned
          // a checklist's <input type="checkbox"> into a plain text box and lost data-type="taskList",
          // so no list styling could apply to a note that contained a record reference.
          const tag = el.tagName.toLowerCase();
          result.push(
            React.createElement(
              tag,
              { ...elementProps(el), key: el.outerHTML },
              // React throws if a void element (br, hr, input, img…) is given children, even [].
              VOID_TAGS.has(tag) ? undefined : renderNode(child)
            )
          );
        }
      }
    }
    return result;
  };

  return <div className="rich-text">{renderNode(root)}</div>;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// HTML attribute -> React prop, for the ones whose names differ.
const ATTR_TO_PROP: Record<string, string> = {
  class: "className", for: "htmlFor", colspan: "colSpan", rowspan: "rowSpan", tabindex: "tabIndex",
  readonly: "readOnly", checked: "defaultChecked", contenteditable: "contentEditable", datetime: "dateTime",
};

function parseInlineStyle(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 1) continue;
    const name = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const value = decl.slice(i + 1).trim();
    if (name && value) style[name] = value;
  }
  return style as React.CSSProperties;
}

/** Props that recreate an element's attributes. Event handlers are never copied. */
export function elementProps(el: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) continue;
    if (name === "style") { props.style = parseInlineStyle(attr.value); continue; }
    if (name === "checked") { props.defaultChecked = true; continue; }
    props[ATTR_TO_PROP[name] ?? attr.name] = attr.value;
  }
  // A checkbox shown in a saved note is a record of state, not a control.
  if (el.tagName === "INPUT" && el.getAttribute("type") === "checkbox") props.readOnly = true;
  return props;
}

// On paste: if text is selected and clipboard looks like a URL, wrap as [selection](url)
export function handleLinkPaste(
  e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  value: string,
  setValue: (v: string) => void,
) {
  const pasted = e.clipboardData.getData("text").trim();
  if (!/^https?:\/\/\S+$/.test(pasted)) return;
  const el = e.currentTarget;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start === end) return; // nothing selected — let normal paste happen
  e.preventDefault();
  const selected = value.slice(start, end);
  const replacement = `[${selected}](${pasted})`;
  const next = value.slice(0, start) + replacement + value.slice(end);
  setValue(next);
  // Restore cursor after the link
  requestAnimationFrame(() => {
    const pos = start + replacement.length;
    el.setSelectionRange(pos, pos);
  });
}
