import DOMPurify from "dompurify";

/**
 * Safe renderer for calendar event descriptions. Google descriptions are often HTML-ish
 * ("<br>One tap mobile<br>+1646…"), sometimes plain text with newlines and bare URLs.
 * Anything outside a strict allow-list is dropped, links get rel="noopener noreferrer",
 * and only http(s)/mailto/tel URLs survive.
 */
const ALLOWED_TAGS = ["br", "p", "a", "b", "strong", "i", "em", "ul", "ol", "li", "code", "pre", "span"];
const ALLOWED_ATTR = ["href"];
const SAFE_URL = /^(https?:|mailto:|tel:)/i;

const HAS_TAG = /<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plainToSafeHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<>"]+)/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/\r?\n/g, "<br>");
}

export function renderEventDescriptionHtml(description: string | null | undefined): string {
  const raw = description ?? "";
  if (!raw.trim()) return "";
  const input = HAS_TAG.test(raw) ? raw : plainToSafeHtml(raw);
  const clean = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: SAFE_URL,
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  tpl.content.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (!SAFE_URL.test(href)) {
      a.removeAttribute("href");
      return;
    }
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  return tpl.innerHTML;
}
