import { useState } from "react";
import documentIconUrl from "../../assets/icons/Document.svg";
import imageIconUrl from "../../assets/icons/Image.svg";
import statisticsIconUrl from "../../assets/icons/Statistics.svg";
import cloudUploadIconUrl from "../../assets/icons/Cloud Upload.svg";
import segmentIconUrl from "../../assets/icons/Segment.svg";

export interface ArtifactIconEntry {
  key: string;
  label: string;
  /** favicon domain for Google Favicon API, or null to use emoji/asset fallback */
  faviconDomain?: string;
  /** emoji fallback when no favicon domain */
  emoji?: string;
  /** asset image URL fallback */
  assetUrl?: string;
}

export const ARTIFACT_ICON_CATALOG: ArtifactIconEntry[] = [
  // Google products — use stable gstatic CDN URLs (favicon API returns generic G for all subdomains)
  { key: "google_docs",     label: "Google Docs",      assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png" },
  { key: "google_sheets",   label: "Google Sheets",    assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" },
  { key: "google_slides",   label: "Google Slides",    assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/slides_2020q4_32dp.png" },
  { key: "google_forms",    label: "Google Forms",     assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/forms_2020q4_32dp.png" },
  { key: "google_drive",    label: "Google Drive",     assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" },
  { key: "google_calendar", label: "Google Calendar",  assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png" },
  { key: "gmail",           label: "Gmail",            assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png" },
  { key: "notebooklm",      label: "NotebookLM",       assetUrl: "https://www.gstatic.com/images/branding/product/1x/notebooklm_32dp.png" },
  { key: "google_sites",    label: "Google Sites",     assetUrl: "https://ssl.gstatic.com/images/branding/product/1x/sites_2020q4_32dp.png" },
  { key: "gemini",          label: "Gemini",           assetUrl: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" },
  // Work services
  { key: "twilio",               label: "Twilio",               faviconDomain: "twilio.com" },
  { key: "segment",              label: "Segment",              assetUrl: segmentIconUrl },
  { key: "slack",               label: "Slack",               faviconDomain: "slack.com" },
  { key: "airtable",            label: "Airtable",            faviconDomain: "airtable.com" },
  { key: "salesforce",          label: "Salesforce",          faviconDomain: "salesforce.com" },
  { key: "gong",                label: "Gong",                faviconDomain: "gong.io" },
  { key: "zoom",                label: "Zoom",                faviconDomain: "zoom.us" },
  { key: "github",              label: "GitHub",              faviconDomain: "github.com" },
  { key: "notion",              label: "Notion",              faviconDomain: "notion.so" },
  { key: "confluence",          label: "Confluence",          faviconDomain: "confluence.atlassian.net" },
  { key: "jira",                label: "Jira",                faviconDomain: "jira.atlassian.com" },
  { key: "figma",               label: "Figma",               faviconDomain: "figma.com" },
  { key: "loom",                label: "Loom",                faviconDomain: "loom.com" },
  { key: "lucidchart",          label: "Lucidchart",          faviconDomain: "lucidchart.com" },
  { key: "microsoft_teams",     label: "Microsoft Teams",     faviconDomain: "teams.microsoft.com" },
  // File types
  { key: "file_doc",    label: "Document",    assetUrl: documentIconUrl },
  { key: "file_sheet",  label: "Spreadsheet", assetUrl: statisticsIconUrl },
  { key: "file_image",  label: "Image",       assetUrl: imageIconUrl },
  { key: "file_code",   label: "Code",        emoji: "</>" },
  { key: "file_upload", label: "File",        assetUrl: cloudUploadIconUrl },
  // Generic
  { key: "link",        label: "Link",        emoji: "🔗" },
];

export const CATALOG_BY_KEY = Object.fromEntries(ARTIFACT_ICON_CATALOG.map((e) => [e.key, e]));

export function getAutoIconKey(url: string): string {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname.replace(/^www\./, "");
    const p = parsed.pathname;
    if (h === "docs.google.com") {
      if (p.startsWith("/spreadsheets/")) return "google_sheets";
      if (p.startsWith("/presentation/")) return "google_slides";
      if (p.startsWith("/forms/")) return "google_forms";
      return "google_docs";
    }
    if (h === "drive.google.com") return "google_drive";
    if (h === "calendar.google.com") return "google_calendar";
    if (h === "mail.google.com" || h === "gmail.com") return "gmail";
    if (h === "notebooklm.google.com") return "notebooklm";
    if (h === "sites.google.com") return "google_sites";
    if (h === "gemini.google.com") return "gemini";
    if (h.endsWith("twilio.com")) return "twilio";
    if (h.endsWith("segment.com") || h.endsWith("segment.io")) return "segment";
    if (h.endsWith("slack.com")) return "slack";
    if (h.endsWith("airtable.com")) return "airtable";
    if (h.endsWith("salesforce.com")) return "salesforce";
    if (h.endsWith("gong.io")) return "gong";
    if (h.endsWith("zoom.us")) return "zoom";
    if (h.endsWith("github.com")) return "github";
    if (h.endsWith("notion.so")) return "notion";
    if (h.endsWith("atlassian.net") || h.endsWith("atlassian.com")) {
      if (p.includes("/wiki") || p.includes("confluence")) return "confluence";
      return "jira";
    }
    if (h.endsWith("figma.com")) return "figma";
    if (h.endsWith("loom.com")) return "loom";
    if (h.endsWith("lucidchart.com")) return "lucidchart";
    if (h.endsWith("teams.microsoft.com") || h.endsWith("office.com")) return "microsoft_teams";
  } catch { /* ignore */ }
  return "link";
}

export function ArtifactIconImg({
  entry, size, onError,
}: {
  entry: ArtifactIconEntry;
  size: number;
  onError?: () => void;
}) {
  if (entry.faviconDomain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?sz=32&domain=${entry.faviconDomain}`}
        alt={entry.label}
        width={size}
        height={size}
        style={{ borderRadius: 3, objectFit: "contain", display: "block", flexShrink: 0 }}
        onError={onError}
      />
    );
  }
  if (entry.assetUrl) {
    return (
      <img
        src={entry.assetUrl}
        alt={entry.label}
        width={size}
        height={size}
        style={{ objectFit: "contain", display: "block", flexShrink: 0 }}
        onError={onError}
      />
    );
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{entry.emoji ?? "🔗"}</span>;
}

export function ArtifactIcon({
  artifactType, mime, name, url, iconKey, size = 18,
}: {
  artifactType: string;
  mime: string;
  name: string;
  url?: string | null;
  iconKey?: string;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (artifactType === "link") {
    const resolvedKey = (iconKey && iconKey !== "") ? iconKey : getAutoIconKey(url ?? "");
    const entry = CATALOG_BY_KEY[resolvedKey] ?? CATALOG_BY_KEY["link"];
    if (!imgFailed) {
      return <ArtifactIconImg entry={entry} size={size} onError={() => setImgFailed(true)} />;
    }
    return <span style={{ fontSize: size, lineHeight: 1 }}>🔗</span>;
  }

  // File type — use asset icons
  const m = mime.toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const CODE_EXTS = new Set(["js", "ts", "tsx", "jsx", "mjs", "cjs", "css", "scss", "sass", "less", "html", "htm", "xml", "py", "rb", "go", "java", "c", "cpp", "h", "cs", "php", "rs", "swift", "kt", "json", "yaml", "yml", "toml", "sh", "bash", "zsh", "sql", "graphql", "gql", "vue", "svelte"]);
  let fileEntry: ArtifactIconEntry;
  if (m.startsWith("image/")) fileEntry = CATALOG_BY_KEY["file_image"];
  else if (m.includes("spreadsheet") || ext === "xlsx" || ext === "csv") fileEntry = CATALOG_BY_KEY["file_sheet"];
  else if (CODE_EXTS.has(ext)) fileEntry = CATALOG_BY_KEY["file_code"];
  else fileEntry = CATALOG_BY_KEY["file_upload"];

  return <ArtifactIconImg entry={fileEntry} size={size} />;
}
