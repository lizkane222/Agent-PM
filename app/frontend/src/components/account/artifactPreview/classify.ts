import type { AccountArtifact } from "../../../types";

/**
 * How the overlay renders an artifact. Decided from the artifact alone (no request):
 * - `screenshot` — the user supplied an image; it always wins;
 * - `image` / `pdf` / `video` / `audio` — the browser renders the file URL itself;
 * - `link` — a URL card (the page is never fetched or embedded without a click);
 * - `remote` — the server describes the file (`GET /accounts/artifacts/<id>/preview/`).
 */
export type PreviewMode = "screenshot" | "image" | "pdf" | "video" | "audio" | "link" | "remote";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "oga"]);

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function classifyArtifact(a: AccountArtifact): PreviewMode {
  if (a.preview_image_url) return "screenshot";
  if (a.artifact_type === "link" || !a.file_url) return "link";
  const mime = (a.mime_type || "").toLowerCase();
  const ext = extensionOf(a.name);
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  return "remote";
}
