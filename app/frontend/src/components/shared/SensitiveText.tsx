/**
 * <SensitiveText> -- text that can be hidden for screen sharing, shared across pages and users.
 *
 * Wrap any text-bearing field of a record:
 *
 *   <SensitiveText resourceType="action_item" resourceId={item.id} field="task" text={item.task} />
 *   <SensitiveText resourceType="account_note" resourceId={n.id} field="content" html={n.content}
 *                  as="div" className="rich-text" />
 *
 * HOW IT HIDES. Marks come from the server (`lib/sensitiveStore.ts`, one batched request per
 * type). A mark with blank `text` hides the whole field (or one line: `lineKey`); a mark with
 * `text` hides every occurrence of that snippet in the field (matched by text, not offsets).
 * The mask REPLACES the text: the secret is not in the DOM, so Cmd-F, copy, selection, and
 * devtools do not reveal it (blur alone would be reversible). HTML fields are sanitized, then
 * their text nodes are split around matches -- a snippet spanning inline elements is masked
 * per text node -- and only masks are written back, never the hidden text.
 *
 * NO MARKS = SAME MARKUP. With no marks (or an id that is not a saved record) it renders
 * exactly the text/HTML the caller had, in a `display: contents` span (or the `as`/`className`
 * element, when given).
 *
 * RIGHT-CLICK. Adds "Hide this line", "Hide selected text" (only with a selection inside this
 * element) and, on a mask, "Show hidden text". The entries are offered through
 * `components/shared/sensitiveMenu` -- surfaces that already own a context menu append
 * `sensitiveMenuItems(e)` instead of competing with a second menu.
 *
 * LIMITS. Display only: the data remains stored and readable via the API and exports, so this
 * is a screen-share aid, not access control. The raw text is shown until the marks for the
 * record have loaded (one round trip, then cached for the session).
 */
import "../../styles/sensitive.css";
import React, { useMemo, useRef } from "react";
import { isMarkableId, useSensitiveMarks } from "../../hooks/useSensitiveMarks";
import { locate, maskGlyphs, type MatchNode } from "../../lib/sensitiveMatch";
import { plainToHtml, sanitizeHtml } from "../../lib/noteHelpers";
import type { SensitiveMark, SensitiveResourceType } from "../../types/sensitive";
import { BLOCK_SELECTOR, registerFieldContext } from "./sensitiveContext";

export interface SensitiveTextProps {
  resourceType: SensitiveResourceType;
  resourceId: string | number | null | undefined;
  /** Which field of the record this text is (e.g. "task", "task_details"). */
  field: string;
  /** Scopes marks to one line of a field that has no ids of its own (e.g. a bullet). */
  lineKey?: string;
  text?: string;
  html?: string;
  as?: "span" | "div" | "p" | "li" | "h1" | "h2" | "h3" | "h4";
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  id?: string;
  testId?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Replaces the default HTML sanitizer (e.g. a surface that must keep `target` on links). */
  sanitizer?: (html: string) => string;
  /** Rendering of the UNMASKED plain text (e.g. @mention chips). Masked output is plain. */
  renderPlain?: (text: string) => React.ReactNode;
}

const MASK_TITLE =
  "Hidden for screen sharing. Right-click to show. This only masks the display in the app; the data is still stored and available via the API and exports.";

function scopeMarks(marks: readonly SensitiveMark[] | undefined, field: string, lineKey: string) {
  // A snippet mark matches by its text anywhere in the field; only a whole-line mark
  // (blank text) is scoped to one line through its `line_key`.
  const mine = (marks ?? []).filter((m) => m.field === field);
  return {
    whole: mine.find((m) => m.text === "" && m.line_key === lineKey),
    snippets: mine.filter((m) => m.text !== ""),
  };
}

function maskEl(markId: number, len: number, block = false): HTMLElement {
  const el = document.createElement("span");
  el.className = "sensitive-mask";
  el.setAttribute("data-sensitive-mask", "");
  el.setAttribute("data-mark-id", String(markId));
  if (block) el.setAttribute("data-block", "true");
  el.setAttribute("aria-label", "Hidden sensitive text");
  el.setAttribute("title", MASK_TITLE);
  el.textContent = maskGlyphs(len);
  return el;
}

function Mask({ markId, len, block }: { markId: number; len: number; block?: boolean }) {
  return (
    <span className="sensitive-mask" data-sensitive-mask="" data-mark-id={markId}
      data-block={block ? "true" : undefined} aria-label="Hidden sensitive text" title={MASK_TITLE}>
      {maskGlyphs(len)}
    </span>
  );
}

/** Mask snippets inside sanitized HTML. Only masks are written back; never the hidden text. */
function maskHtml(sanitized: string, snippets: SensitiveMark[]): string {
  const root = document.createElement("div");
  root.innerHTML = sanitized;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  const blocks = new Map<Element, number>();
  const nodes: MatchNode[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    textNodes.push(t);
    const b = t.parentElement?.closest(BLOCK_SELECTOR) ?? root;
    if (!blocks.has(b)) blocks.set(b, blocks.size);
    nodes.push({ text: t.data, block: blocks.get(b)! });
  }
  const pieces = locate(nodes, snippets);
  const byNode = new Map<number, typeof pieces>();
  for (const p of pieces) byNode.set(p.node, [...(byNode.get(p.node) ?? []), p]);
  for (const [ni, list] of byNode) {
    const t = textNodes[ni];
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const p of list) {
      if (p.start > at) frag.appendChild(document.createTextNode(t.data.slice(at, p.start)));
      frag.appendChild(maskEl(p.markId, p.end - p.start));
      at = p.end;
    }
    if (at < t.data.length) frag.appendChild(document.createTextNode(t.data.slice(at)));
    t.parentNode!.replaceChild(frag, t);
  }
  return root.innerHTML;
}

function maskPlain(text: string, snippets: SensitiveMark[]): React.ReactNode[] {
  const pieces = locate([{ text, block: 0 }], snippets);
  const out: React.ReactNode[] = [];
  let at = 0;
  pieces.forEach((p) => {
    if (p.start > at) out.push(text.slice(at, p.start));
    out.push(<Mask key={`${p.markId}-${p.start}`} markId={p.markId} len={p.end - p.start} />);
    at = p.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export default function SensitiveText({
  resourceType, resourceId, field, lineKey = "", text, html, as, className, style, title, id, testId, onClick, renderPlain, sanitizer,
}: SensitiveTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const markable = isMarkableId(resourceId);
  const { marks, mark, unmark } = useSensitiveMarks(resourceType, resourceId);
  const { whole, snippets } = useMemo(() => scopeMarks(marks, field, lineKey), [marks, field, lineKey]);

  const isHtml = html !== undefined;
  const source = isHtml ? html! : text ?? "";
  const hasMarks = markable && (!!whole || snippets.length > 0);

  const content = useMemo<{ node?: React.ReactNode; htmlOut?: string }>(() => {
    if (!isHtml) {
      if (!hasMarks) return { node: renderPlain ? renderPlain(source) : source };
      if (whole) return { node: <Mask markId={whole.id} len={source.length} block /> };
      return { node: maskPlain(source, snippets) };
    }
    const sanitized = sanitizer ? sanitizer(source) : sanitizeHtml(plainToHtml(source));
    if (!hasMarks) return { htmlOut: sanitized };
    if (whole) return { htmlOut: maskEl(whole.id, source.length, true).outerHTML };
    return { htmlOut: maskHtml(sanitized, snippets) };
  }, [isHtml, source, hasMarks, whole, snippets, renderPlain, sanitizer]);

  function onContextMenu(e: React.MouseEvent<HTMLElement>) {
    if (!markable || !ref.current) return;
    registerFieldContext(e, ref.current, { isHtml, field, lineKey, mark, unmark });
  }

  const Tag = (as ?? (isHtml ? "div" : "span")) as React.ElementType;
  const bare = !className && !style && !title && !id && !testId && !onClick && !as;
  const common = {
    ref: ref as React.Ref<HTMLElement>,
    className,
    id,
    title,
    "data-testid": testId,
    onClick,
    style: bare ? { display: "contents" as const } : style,
    onContextMenu: markable ? onContextMenu : undefined,
  };
  if (content.htmlOut !== undefined) {
    return <Tag {...common} dangerouslySetInnerHTML={{ __html: content.htmlOut }} />;
  }
  return <Tag {...common}>{content.node}</Tag>;
}
