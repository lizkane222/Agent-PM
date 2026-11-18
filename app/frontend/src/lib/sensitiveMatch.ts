/**
 * Pure snippet matching for sensitive-text marks.
 *
 * Marks match by SNIPPET TEXT, never by character offsets (records are edited, offsets
 * drift). Both the haystack and the snippet are whitespace-normalised (runs collapse to one
 * space) so a selection copied across paragraphs still matches; text nodes in different
 * block elements are separated by a virtual space for the same reason.
 */

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface MatchNode {
  text: string;
  /** Identifier of the nearest block ancestor; nodes in different blocks get a virtual space between. */
  block: number;
}

export interface MatchPiece {
  node: number;
  start: number;
  end: number;
  markId: number;
}

export const isWs = (c: string) => /\s/.test(c);

/** Find every occurrence of each snippet; return per-node ranges (merged, non-overlapping). */
export function locate(nodes: MatchNode[], marks: Array<{ id: number; text: string }>): MatchPiece[] {
  let hay = "";
  const mapNode: number[] = [];
  const mapOff: number[] = [];
  const push = (ch: string, n: number, o: number) => { hay += ch; mapNode.push(n); mapOff.push(o); };
  nodes.forEach((node, ni) => {
    if (ni > 0 && node.block !== nodes[ni - 1].block && hay.length && hay[hay.length - 1] !== " ") push(" ", -1, -1);
    for (let o = 0; o < node.text.length; o++) {
      const ch = node.text[o];
      if (isWs(ch)) {
        if (hay.length && hay[hay.length - 1] !== " ") push(" ", ni, o);
      } else {
        push(ch, ni, o);
      }
    }
  });

  const raw: MatchPiece[] = [];
  for (const m of marks) {
    const needle = normalizeWs(m.text);
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const lo = new Map<number, [number, number]>();
      for (let i = at; i < at + needle.length; i++) {
        const n = mapNode[i];
        if (n < 0) continue;
        const o = mapOff[i];
        const cur = lo.get(n);
        if (!cur) lo.set(n, [o, o + 1]);
        else cur[1] = o + 1;
      }
      for (const [n, [s, e]] of lo) raw.push({ node: n, start: s, end: e, markId: m.id });
      from = at + needle.length;
    }
  }

  // Merge overlaps within a node (first mark wins the id).
  raw.sort((a, b) => a.node - b.node || a.start - b.start);
  const out: MatchPiece[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && last.node === p.node && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}

/** Mask text: bullets, length loosely following the hidden run but capped so it can't be measured. */
export function maskGlyphs(len: number): string {
  return "•".repeat(Math.min(Math.max(len, 3), 12));
}

/** Stable, short identity for a line of text (FNV-1a over the normalised text) -- a `line_key`. */
export function lineKeyFor(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of normalizeWs(text)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `l${h.toString(16)}`;
}
