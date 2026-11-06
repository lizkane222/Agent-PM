/**
 * Pure search / sort / group / filter logic for an account's artifact list.
 * Client-side only; nothing here is persisted.
 */
import type { AccountArtifact } from "../types/accounts";

export type ArtifactSort =
  | "created_desc" | "created_asc" | "name_asc" | "name_desc" | "creator" | "file_type" | "link_type";
export type ArtifactGroupBy = "none" | "file_type" | "link_type" | "creator";

export interface ArtifactBrowseState {
  query: string;
  sort: ArtifactSort;
  groupBy: ArtifactGroupBy;
  /** Selected type-chip keys (see `typeKey`). Empty = no type filter. */
  types: string[];
}

export const DEFAULT_ARTIFACT_BROWSE: ArtifactBrowseState = {
  query: "", sort: "created_desc", groupBy: "none", types: [],
};

export const SORT_OPTIONS: { value: ArtifactSort; label: string }[] = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "creator", label: "Creator" },
  { value: "file_type", label: "File type" },
  { value: "link_type", label: "Link type" },
];

export const GROUP_OPTIONS: { value: ArtifactGroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "file_type", label: "File type" },
  { value: "link_type", label: "Link type" },
  { value: "creator", label: "Creator" },
];

const EXT_CATEGORY: Record<string, string> = {
  pdf: "PDF",
  png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", svg: "Image", heic: "Image",
  doc: "Document", docx: "Document", txt: "Document", md: "Document", rtf: "Document", html: "Document",
  xls: "Spreadsheet", xlsx: "Spreadsheet", csv: "Spreadsheet",
  ppt: "Presentation", pptx: "Presentation", key: "Presentation",
  mp4: "Video", mov: "Video", webm: "Video", mp3: "Audio", wav: "Audio", m4a: "Audio",
  zip: "Archive", gz: "Archive", tar: "Archive",
  json: "Code", js: "Code", ts: "Code", py: "Code",
};

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** "PDF", "Image", ... for a file artifact; "" for a link. */
export function fileTypeOf(a: AccountArtifact): string {
  if (a.artifact_type !== "file") return "";
  const mime = (a.mime_type || "").toLowerCase();
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "Spreadsheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "Presentation";
  return EXT_CATEGORY[extOf(a.name)] ?? (mime.includes("word") || mime.startsWith("text/") ? "Document" : "Other");
}

function hostOf(url: string | null): string {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** The service a link points at (icon key when set, else host); "" for a file. */
export function linkTypeOf(a: AccountArtifact): string {
  if (a.artifact_type === "file") return "";
  if (a.icon_key) return a.icon_key.replace(/^file_/, "").replace(/[_-]+/g, " ");
  return hostOf(a.url) || "Other link";
}

/** Stable chip key: `file:PDF` or `link:docs.google.com`. */
export function typeKey(a: AccountArtifact): string {
  return a.artifact_type === "file" ? `file:${fileTypeOf(a)}` : `link:${linkTypeOf(a)}`;
}

export function typeLabel(key: string): string {
  const i = key.indexOf(":");
  return key.slice(0, i) === "file" ? key.slice(i + 1) : `${key.slice(i + 1)} (link)`;
}

/** Chip list for the artifacts currently loaded, sorted by label. */
export function availableTypes(artifacts: AccountArtifact[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of artifacts) counts.set(typeKey(a), (counts.get(typeKey(a)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: typeLabel(key), count }))
    .sort((x, y) => x.label.localeCompare(y.label));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

export function matchesQuery(a: AccountArtifact, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [a.name, a.uploaded_by_username, stripHtml(a.description || ""), a.url, a.secondary_url]
    .some((v) => (v ?? "").toLowerCase().includes(q));
}

const byName = (x: AccountArtifact, y: AccountArtifact) =>
  x.name.localeCompare(y.name, undefined, { sensitivity: "base", numeric: true });
const byCreated = (x: AccountArtifact, y: AccountArtifact) =>
  Date.parse(x.created_at || "") - Date.parse(y.created_at || "");
// Empty values sort last in every column-style sort.
const cmpEmptyLast = (a: string, b: string) =>
  a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { sensitivity: "base" });

export function sortArtifacts(items: AccountArtifact[], sort: ArtifactSort): AccountArtifact[] {
  const out = [...items];
  const tie = (r: number, x: AccountArtifact, y: AccountArtifact) => r || byName(x, y);
  switch (sort) {
    case "name_asc": return out.sort(byName);
    case "name_desc": return out.sort((x, y) => byName(y, x));
    case "created_asc": return out.sort((x, y) => tie(byCreated(x, y), x, y));
    case "creator": return out.sort((x, y) => tie(cmpEmptyLast(x.uploaded_by_username ?? "", y.uploaded_by_username ?? ""), x, y));
    case "file_type": return out.sort((x, y) => tie(cmpEmptyLast(fileTypeOf(x), fileTypeOf(y)), x, y));
    case "link_type": return out.sort((x, y) => tie(cmpEmptyLast(linkTypeOf(x), linkTypeOf(y)), x, y));
    case "created_desc":
    default: return out.sort((x, y) => tie(byCreated(y, x), x, y));
  }
}

function groupLabel(a: AccountArtifact, by: ArtifactGroupBy): string {
  switch (by) {
    case "file_type": return fileTypeOf(a) || "Links";
    case "link_type": return linkTypeOf(a) || "Files";
    case "creator": return a.uploaded_by_username || "Unknown creator";
    default: return "";
  }
}

// Catch-all buckets always list after the real types / creators.
const CATCH_ALL = new Set(["Links", "Files", "Unknown creator"]);

export interface ArtifactGroup { label: string; items: AccountArtifact[] }

/** Search + type filter + sort + group. Groups keep the order their first member has in the sort. */
export function browseArtifacts(artifacts: AccountArtifact[], state: ArtifactBrowseState): ArtifactGroup[] {
  const types = new Set(state.types);
  const kept = artifacts.filter((a) => matchesQuery(a, state.query) && (types.size === 0 || types.has(typeKey(a))));
  const sorted = sortArtifacts(kept, state.sort);
  if (state.groupBy === "none") return sorted.length ? [{ label: "", items: sorted }] : [];
  const groups = new Map<string, AccountArtifact[]>();
  for (const a of sorted) {
    const label = groupLabel(a, state.groupBy);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(a);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => (CATCH_ALL.has(x) ? 1 : 0) - (CATCH_ALL.has(y) ? 1 : 0) || cmpEmptyLast(x, y))
    .map(([label, items]) => ({ label, items }));
}

export function isArtifactBrowseActive(state: ArtifactBrowseState): boolean {
  return !!state.query.trim() || state.types.length > 0;
}
