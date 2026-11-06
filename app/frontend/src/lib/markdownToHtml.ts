import DOMPurify from "dompurify";

/**
 * A small markdown → HTML converter for skill templates and attached documents.
 *
 * Deliberately limited to what those documents use — headings, bullet/numbered lists
 * (nested by indent), bold, italic, inline code, links, horizontal rules and paragraphs —
 * so the app needn't take a markdown dependency. The result is sanitized, so it is safe to
 * hand to TipTap or `dangerouslySetInnerHTML`. `[[Placeholders]]` and `@#--keywords` are
 * plain text and pass through untouched.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

const LIST_RE = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;

export function markdownToHtml(markdown: string): string {
  const lines = (markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  // Open lists, innermost last: [indent, tag]
  const stack: Array<{ indent: number; tag: "ul" | "ol" }> = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeLists = (toIndent = -1) => {
    while (stack.length && stack[stack.length - 1].indent > toIndent) {
      out.push(`</li></${stack.pop()!.tag}>`);
    }
  };

  for (const line of lines) {
    if (!line.trim()) { flushPara(); closeLists(); continue; }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushPara(); closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); closeLists(); out.push("<hr>"); continue; }

    const item = LIST_RE.exec(line);
    if (item) {
      flushPara();
      const indent = item[1].replace(/\t/g, "    ").length;
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) {
        out.push(`<${tag}><li>`);
        stack.push({ indent, tag });
      } else {
        while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
          out.push(`</li></${stack.pop()!.tag}>`);
        }
        out.push("</li><li>");
      }
      out.push(inline(item[3]));
      continue;
    }

    // A continuation of the previous list item's text, or a paragraph line.
    if (stack.length && /^\s+\S/.test(line)) { out.push(`<br>${inline(line.trim())}`); continue; }
    closeLists();
    para.push(line.trim());
  }
  flushPara(); closeLists();
  return DOMPurify.sanitize(out.join(""));
}
