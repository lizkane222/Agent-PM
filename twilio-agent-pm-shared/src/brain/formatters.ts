/** Emoji icon for a MIME type / filename. */
export function fileIcon(mime: string, name: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("video/")) return "🎬";
  if (name.endsWith(".xlsx") || name.endsWith(".csv")) return "📊";
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "📝";
  return "📎";
}

/** Emoji icon for an attachment URL based on its domain. */
export function attachLinkIcon(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const p = new URL(url).pathname;
    if (h === "docs.google.com") {
      if (p.startsWith("/spreadsheets/")) return "📊";
      if (p.startsWith("/presentation/")) return "🟨";
      if (p.startsWith("/forms/")) return "📋";
      return "📄";
    }
    if (h === "drive.google.com") return "🗂️";
    if (h === "mail.google.com" || h === "gmail.com") return "📧";
    if (h === "calendar.google.com") return "📅";
    if (h === "sheets.google.com") return "📊";
    if (h === "slides.google.com") return "🟨";
    if (h === "forms.google.com") return "📋";
    if (h === "sites.google.com") return "🌐";
    if (h === "notebooklm.google.com") return "📓";
    if (h === "gemini.google.com") return "✨";
    if (h.endsWith("gong.io")) return "🎙️";
    if (h.endsWith("figma.com")) return "🎨";
    if (h.endsWith("notion.so")) return "📓";
    if (h.endsWith("github.com")) return "💻";
    if (h.endsWith("slack.com")) return "💬";
    if (h.endsWith("salesforce.com")) return "☁️";
    if (h.endsWith("airtable.com")) return "🗃️";
    if (h.endsWith("zoom.us")) return "📹";
    if (h.endsWith("loom.com")) return "🎥";
    if (h.endsWith("atlassian.net") || h.endsWith("atlassian.com")) return "🔷";
  } catch { /* ignore */ }
  return "🔗";
}

/** Human-readable file size string. */
export function fmtBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Formats seconds as H:MM:SS or M:SS. */
export function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Formats an ARR string (dollars) into a short currency form. */
export function formatArr(arr: string | null): string {
  if (!arr) return "—";
  const n = parseFloat(arr);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
