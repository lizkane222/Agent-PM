// Auto-discovers every PNG in assets/Product Shapes/ via Vite's import.meta.glob.

const pngModules = import.meta.glob<{ default: string }>(
  "../../assets/Product Shapes/*.png",
  { eager: true }
);

export type ProductShapeKind = "shape" | "line";

export interface ProductShapeEntry {
  filename: string;
  src: string;
  name: string;
  kind: ProductShapeKind;
  index: number;
}

function parse(filepath: string, src: string): ProductShapeEntry | null {
  const filename = filepath.split("/").pop() ?? "";
  // "Actual size_PNG-shape-N.png" or "Actual size_PNG-shape-line-N.png"
  const lineMatch = filename.match(/shape-line-(\d+)\.png$/i);
  if (lineMatch) {
    const n = parseInt(lineMatch[1], 10);
    return { filename, src, name: `Line ${n}`, kind: "line", index: n };
  }
  const shapeMatch = filename.match(/shape-(\d+)\.png$/i);
  if (shapeMatch) {
    const n = parseInt(shapeMatch[1], 10);
    return { filename, src, name: `Shape ${n}`, kind: "shape", index: n };
  }
  // story background shape
  if (filename.includes("story-background")) {
    return { filename, src, name: "Story BG", kind: "shape", index: 999 };
  }
  return null;
}

export const PRODUCT_SHAPE_REGISTRY: ProductShapeEntry[] = Object.entries(pngModules)
  .map(([path, mod]) => parse(path, mod.default))
  .filter((e): e is ProductShapeEntry => e !== null)
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.index - b.index);
