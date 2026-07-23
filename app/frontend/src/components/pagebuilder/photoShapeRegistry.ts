// Auto-discovers every PNG in assets/photo-shapes/ via Vite's import.meta.glob.

const pngModules = import.meta.glob<{ default: string }>(
  "../../assets/photo-shapes/*.png",
  { eager: true }
);

export type PhotoShapeCategory = "Twilio" | "Developer" | "Executive" | "Owner" | "User";

export interface PhotoShapeEntry {
  filename: string;
  src: string;
  name: string;
  category: PhotoShapeCategory;
  sortKey: number; // for stable ordering within a category
}

const PERSONA_MAP: Record<string, PhotoShapeCategory> = {
  "s-dev":   "Developer",
  "s-exec":  "Executive",
  "s-owner": "Owner",
  "s-user":  "User",
};

function parse(filepath: string, src: string): PhotoShapeEntry | null {
  const filename = filepath.split("/").pop() ?? "";
  // Strip "Actual size_PNG-" prefix and ".png" suffix
  const inner = filename
    .replace(/^Actual size_PNG-/, "")
    .replace(/\.png$/i, "");

  // Twilio abstract shapes: "twil_1" … "twil_24"
  const twilMatch = inner.match(/^twil_(\d+)$/);
  if (twilMatch) {
    const n = parseInt(twilMatch[1], 10);
    return { filename, src, name: `Shape ${n}`, category: "Twilio", sortKey: n };
  }

  // Persona shapes: "s-dev_AdobeStock_NNNN"
  const personaMatch = inner.match(/^(s-dev|s-exec|s-owner|s-user)_/);
  if (personaMatch) {
    const cat = PERSONA_MAP[personaMatch[1]];
    // Use the stock ID as a stable sort key
    const idMatch = inner.match(/_(\d+)$/);
    const sortKey = idMatch ? parseInt(idMatch[1], 10) : 0;
    return { filename, src, name: cat, category: cat, sortKey };
  }

  return null;
}

// Build registry and number persona entries within their category
const raw = Object.entries(pngModules)
  .map(([path, mod]) => parse(path, mod.default))
  .filter((e): e is PhotoShapeEntry => e !== null)
  .sort((a, b) => a.category.localeCompare(b.category) || a.sortKey - b.sortKey);

// Assign readable per-category numbering for persona shapes
const categoryCounters: Partial<Record<PhotoShapeCategory, number>> = {};
export const PHOTO_SHAPE_REGISTRY: PhotoShapeEntry[] = raw.map((entry) => {
  if (entry.category === "Twilio") return entry;
  categoryCounters[entry.category] = (categoryCounters[entry.category] ?? 0) + 1;
  return { ...entry, name: `${entry.category} ${categoryCounters[entry.category]}` };
});

export const PHOTO_SHAPE_CATEGORIES: PhotoShapeCategory[] =
  ["Twilio", "Developer", "Executive", "Owner", "User"];
