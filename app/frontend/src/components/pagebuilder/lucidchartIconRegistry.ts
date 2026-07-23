// Auto-discovers every SVG in assets/lucidchart-assets/ via Vite's import.meta.glob.

const svgModules = import.meta.glob<{ default: string }>(
  "../../assets/lucidchart-assets/*.svg",
  { eager: true }
);

export interface LucidchartIconEntry {
  filename: string;
  src: string;
  name: string;
}

function toLabel(filename: string): string {
  return filename
    .replace(/^lucidchart-/, "")
    .replace(/\.svg$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const LUCIDCHART_ICON_REGISTRY: LucidchartIconEntry[] = Object.entries(svgModules)
  .map(([path, mod]) => {
    const filename = path.split("/").pop() ?? "";
    return { filename, src: mod.default, name: toLabel(filename) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
