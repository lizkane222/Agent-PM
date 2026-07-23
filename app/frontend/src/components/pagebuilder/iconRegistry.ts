// Auto-discovers every SVG in assets/icons/ via Vite's import.meta.glob.
// Returns a stable sorted list used by both the Icon renderer and the picker.

const svgModules = import.meta.glob<{ default: string }>(
  "../../assets/icons/*.svg",
  { eager: true }
);

function toReadableName(filepath: string): string {
  // "../../assets/icons/Bubble Chat.svg" → "Bubble Chat"
  const filename = filepath.split("/").pop() ?? "";
  return filename
    .replace(/\.svg$/i, "")
    .replace(/-/g, " ")
    .trim();
}

export interface IconEntry {
  name: string;    // readable label, e.g. "Bubble Chat"
  filename: string; // bare filename, e.g. "Bubble Chat.svg"
  src: string;     // resolved asset URL
}

export const ICON_REGISTRY: IconEntry[] = Object.entries(svgModules)
  .map(([path, mod]) => ({
    name: toReadableName(path),
    filename: (path.split("/").pop() ?? path),
    src: mod.default,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
