/**
 * Pure formatting helpers for Gmail thread bodies.
 *
 * Output is plain data (text segments + http(s)/mailto link segments) that React renders
 * as nodes, so message content is never injected as HTML. HTML bodies are flattened to
 * text first; anchors keep their target as "label (url)" so the link survives.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", copy: "©",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function looksLikeHtml(s: string): boolean {
  return /<(a|p|div|br|span|table|html|body|b|i|ul|li|blockquote)[\s>/]/i.test(s);
}

/** Flatten an HTML body to plain text, keeping paragraph breaks and link targets. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, d: string, sq: string, label: string) => {
      const href = decodeEntities((d ?? sq ?? "").trim());
      const text = label.replace(/<[^>]*>/g, "").trim();
      if (!/^(https?:|mailto:)/i.test(href)) return text;
      if (!text || text === href) return href;
      return `${text} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return s;
}

/** Normalise line endings, trim trailing spaces and cap runs of blank lines at one. */
export function normalizeBody(raw: string): string {
  const text = looksLikeHtml(raw) ? htmlToText(raw) : raw;
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS: RegExp[] = [
  /^On .{5,200}wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{5,}\s*$/,
  /^From:\s.+/i, // header block of a quoted message (only honoured when followed by Sent/Date/To)
  /^>/,
];
const SIGNATURE_MARKERS: RegExp[] = [/^--\s?$/, /^Sent from my (iPhone|iPad|Android|mobile|Galaxy)/i, /^Get Outlook for /i];

export interface SplitBody {
  main: string;
  /** Quoted earlier messages and/or signature, collapsed by default. Empty when none. */
  hidden: string;
}

/**
 * Split off quoted replies and signatures. Everything from the first marker to the end
 * is "hidden" so the new content of the message reads first. A body that is only quote
 * (nothing before the marker) is left whole rather than shown empty.
 */
export function splitQuoted(body: string): SplitBody {
  const text = normalizeBody(body);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let hit = SIGNATURE_MARKERS.some((re) => re.test(line));
    if (!hit) {
      for (const re of QUOTE_MARKERS) {
        if (!re.test(line)) continue;
        if (/^From:/i.test(line)) {
          hit = lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date|To|Subject):/i.test(l.trim()));
        } else {
          hit = true;
        }
        if (hit) break;
      }
    }
    if (hit) {
      const main = lines.slice(0, i).join("\n").trim();
      if (!main) return { main: text, hidden: "" };
      return { main, hidden: lines.slice(i).join("\n").trim() };
    }
  }
  return { main: text, hidden: "" };
}

export type LinkSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|mailto:)[^\s<>"']+|\bwww\.[^\s<>"']+/gi;

/** Turn plain text into text/link segments. Only http(s) and mailto become links. */
export function linkify(text: string): LinkSegment[] {
  const out: LinkSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const start = m.index ?? 0;
    // Trailing punctuation belongs to the sentence; an unbalanced ")" does too.
    for (;;) {
      const c = url[url.length - 1];
      if (/[.,;:!?'"\]]/.test(c) || (c === ")" && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length)) {
        url = url.slice(0, -1);
      } else break;
    }
    if (!url) continue;
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    out.push({ type: "link", text: url, href });
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export interface Sender { name: string; email: string }

/** "Jane Doe <jane@x.com>" -> {name, email}. Falls back to the raw string. */
export function parseSender(from: string): Sender {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const email = m[2].trim();
    return { name: m[1].trim() || email, email };
  }
  const bare = from.trim();
  return { name: bare, email: /@/.test(bare) ? bare : "" };
}

/** Friendly local date/time when parseable, otherwise the original string. */
export function formatMessageDate(raw: string): string {
  const d = new Date(raw);
  if (!raw || Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Split text into paragraphs (blank-line separated); single newlines stay inside a paragraph. */
export function toParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}
