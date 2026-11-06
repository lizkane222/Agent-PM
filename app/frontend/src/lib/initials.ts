/** First letter of the first and last word of a name ("Liz Kane" → "LK"); one word → one letter. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Drops seniority words ("Senior", "Principal", "Staff", …) — they add nothing in the sidebar card. */
const SENIORITY_RE = /\b(senior|sr\.?|principal|staff|lead|junior|jr\.?)\b,?\s*/gi;
export function sidebarTitle(title: string | undefined): string {
  return (title ?? "").replace(SENIORITY_RE, "").replace(/\s{2,}/g, " ").trim();
}

