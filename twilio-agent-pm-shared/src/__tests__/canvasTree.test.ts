import { findNode, removeNode, deepCloneNode, collectIds } from "../brain/canvasTree.js";
import { CanvasNodeSchema } from "../schemas.js";
import {
  FIND_NODE_FIXTURES,
  REMOVE_NODE_FIXTURES,
  DEEP_CLONE_FIXTURES,
  RICH_TEXT_PROPS_FIXTURES,
} from "../fixtures/canvasTree.fixtures.js";

let idCounter = 0;
function makeId() { return `test-${++idCounter}`; }

beforeEach(() => { idCounter = 0; });

describe("findNode", () => {
  for (const f of FIND_NODE_FIXTURES) {
    it(f.note ?? `id="${f.id}" → ${f.expectedId ?? "null"}`, () => {
      const result = findNode(f.root, f.id);
      expect(result?.id ?? null).toBe(f.expectedId);
    });
  }
});

describe("removeNode", () => {
  for (const f of REMOVE_NODE_FIXTURES) {
    it(f.note ?? `remove "${f.id}"`, () => {
      const result = removeNode(f.root, f.id);
      expect(collectIds(result).sort()).toEqual([...f.expectedIds].sort());
    });
  }
});

describe("deepCloneNode", () => {
  for (const f of DEEP_CLONE_FIXTURES) {
    it(f.note ?? `clone type="${f.source.type}"`, () => {
      const clone = deepCloneNode(f.source, f.offsetRoot, makeId);
      // New id assigned
      expect(clone.id).not.toBe(f.source.id);
      // Same type
      expect(clone.type).toBe(f.source.type);
      // Children also get new ids
      if (f.source.children.length > 0) {
        const origIds = collectIds(f.source.children);
        const cloneIds = collectIds(clone.children);
        expect(cloneIds).toHaveLength(origIds.length);
        for (const id of cloneIds) {
          expect(origIds).not.toContain(id);
        }
      }
      // Offset applied when requested
      if (f.offsetRoot && f.source.props["x"] !== undefined) {
        expect(clone.props["x"]).toBe((f.source.props["x"] as number) + 20);
        expect(clone.props["y"]).toBe(((f.source.props["y"] as number) ?? 0) + 20);
      }
    });
  }
});

// ── RichText props.html — sanitization invariant (security fix G1) ────────────
//
// The schema stores props.html as-is (z.record(z.unknown())). These tests
// confirm that XSS payloads round-trip through CanvasNodeSchema without error
// or corruption — the package correctly treats them as opaque data.
// Sanitization is the responsibility of the rendering surface (NodeRenderer).
describe("RichText props.html sanitization invariant", () => {
  for (const f of RICH_TEXT_PROPS_FIXTURES) {
    it(f.note, () => {
      // Schema must accept the node without throwing
      const parsed = CanvasNodeSchema.parse(f.node);

      // props.html is stored verbatim — no transformation in the core package
      expect(parsed.props["html"]).toBe(f.node.props["html"]);

      // Invariant flag is always true — enforced at the type and fixture level
      expect(f.propsHtmlIsUntrusted).toBe(true);

      // Type is always RichText for these fixtures
      expect(parsed.type).toBe("RichText");
    });
  }
});
